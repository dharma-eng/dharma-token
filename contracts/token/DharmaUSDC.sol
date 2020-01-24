pragma solidity 0.5.11;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./DharmaTokenHelpers.sol";
import "../../interfaces/CTokenInterface.sol";
import "../../interfaces/DTokenInterface.sol";
import "../../interfaces/ERC20Interface.sol";
import "../../interfaces/CUSDCInterestRateModelInterface.sol";


/**
 * @title DharmaUSDC
 * @author 0age (dToken mechanics derived from Compound cTokens, ERC20 methods
 * derived from Open Zeppelin's ERC20 contract)
 * @notice Initial prototype for a cUSDC wrapper token. This version is not
 * upgradeable, and serves as an initial test of the eventual dUSDC mechanics.
 * The dUSDC exchange rate will grow at 90% the rate of the cUSDC exchange rate.
 */
contract DharmaUSDC is ERC20Interface, DTokenInterface, DharmaTokenHelpers {
  using SafeMath for uint256;

  uint256 internal constant _DHARMA_USDC_VERSION = 0;
  string internal constant _NAME = "Dharma USDC";
  string internal constant _SYMBOL = "dUSDC";
  string internal constant _CTOKEN_SYMBOL = "cUSDC";

  CTokenInterface internal constant _CUSDC = CTokenInterface(
    0x39AA39c021dfbaE8faC545936693aC917d5E7563 // mainnet
  );

  ERC20Interface internal constant _USDC = ERC20Interface(
    0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 // mainnet
  );

  // Note: this is just an EOA for the initial prototype.
  address internal constant _VAULT = 0x7e4A8391C728fEd9069B2962699AB416628B19Fa;

  uint256 internal constant _SCALING_FACTOR_SQUARED = 1e36;

  // Slot zero tracks block number and dUSDC + cUSDC exchange rates on accruals.
  AccrualIndex private _accrualIndex;

  // Slot one tracks the total issued dUSDC tokens.
  uint256 private _totalSupply;

  // Slots two and three are entrypoints into balance and allowance mappings.
  mapping (address => uint256) private _balances;
  mapping (address => mapping (address => uint256)) private _allowances;

  constructor() public {
    // Approve cUSDC to transfer USDC on behalf of this contract in order to mint.
    require(_USDC.approve(address(_CUSDC), uint256(-1)));

    // Initial dUSDC exchange rate is 1-to-1 (USDC has 6 decimals, dDSDC has 8).
    uint256 dUSDCExchangeRate = 1e16;

    // Get initial cUSDC exchange rate, accruing cUSDC interest in the process.
    uint256 cUSDCExchangeRate = _CUSDC.exchangeRateCurrent();

    // Initialize accrual index with current block number and exchange rates.
    AccrualIndex storage accrualIndex = _accrualIndex;
    accrualIndex.dTokenExchangeRate = uint112(dUSDCExchangeRate);
    accrualIndex.cTokenExchangeRate = _safeUint112(cUSDCExchangeRate);
    accrualIndex.block = uint32(block.number);
    emit Accrue(dUSDCExchangeRate, cUSDCExchangeRate);
  }

  /**
   * @notice Transfer `amount` USDC from `msg.sender` to this contract, use them
   * to mint cUSDC, and mint dTokens with `msg.sender` as the beneficiary. Ensure
   * that this contract has been approved to transfer the USDC on behalf of the
   * caller.
   * @param usdcToSupply uint256 The amount of USDC to provide as part of minting.
   * @return The amount of dUSDC received in return for the supplied USDC.
   */
  function mint(
    uint256 usdcToSupply
  ) external returns (uint256 dUSDCMinted) {
    // Pull in USDC - ensure that this contract has sufficient allowance.
    require(
      _USDC.transferFrom(msg.sender, address(this), usdcToSupply),
      "USDC transfer failed."
    );

    // Use the USDC to mint cUSDC and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.mint.selector, usdcToSupply
    ));

    _checkCompoundInteraction(_CUSDC.mint.selector, ok, data, _CTOKEN_SYMBOL);

    // Accrue after the Compound mint to avoid duplicating calculations.
    (uint256 dUSDCExchangeRate, ) = _accrue();

    // Determine the dUSDC to mint using the exchange rate.
    dUSDCMinted = (usdcToSupply.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate);

    // Mint dUSDC to the caller.
    _mint(msg.sender, usdcToSupply, dUSDCMinted);
  }

  /**
   * @notice Transfer `amount` cUSDC from `msg.sender` to this contract and mint
   * dTokens with `msg.sender` as the beneficiary. Ensure that this contract has
   * been approved to transfer the cUSDC on behalf of the caller.
   * @param cUSDCToSupply uint256 The amount of cUSDC to provide as part of
   * minting.
   * @return The amount of dUSDC received in return for the supplied cUSDC.
   */
  function mintViaCToken(
    uint256 cUSDCToSupply
  ) external returns (uint256 dUSDCMinted) {
    // Pull in cUSDC - ensure that this contract has sufficient allowance.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.transferFrom.selector, msg.sender, address(this), cUSDCToSupply
    ));

    _checkCompoundInteraction(
      _CUSDC.transferFrom.selector, ok, data, _CTOKEN_SYMBOL
    );

    // Accrue interest and retrieve the current exchange rates.
    (uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate) = _accrue();

    // Determine the USDC equivalent of the supplied cUSDC amount.
    uint256 usdcEquivalent = cUSDCToSupply.mul(cUSDCExchangeRate) / _SCALING_FACTOR;

    // Determine the dUSDC to mint using the exchange rate.
    dUSDCMinted = (usdcEquivalent.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate);

    // Mint dUSDC to the caller.
    _mint(msg.sender, usdcEquivalent, dUSDCMinted);
  }

  /**
   * @notice Redeem `dUSDCToBurn` dUSDC from `msg.sender`, use the corresponding
   * cUSDC to redeem USDC, and transfer the USDC to `msg.sender`.
   * @param dUSDCToBurn uint256 The amount of dUSDC to provide for USDC.
   * @return The amount of USDC received in return for the provided cUSDC.
   */
  function redeem(
    uint256 dUSDCToBurn
  ) external returns (uint256 usdcReceived) {
    // Accrue interest and retrieve the current dUSDC exchange rate.
    (uint256 dUSDCExchangeRate, ) = _accrue();

    // Determine the underlying USDC value of the dUSDC to be burned.
    usdcReceived = dUSDCToBurn.mul(dUSDCExchangeRate) / _SCALING_FACTOR;

    // Burn the dUSDC.
    _burn(msg.sender, usdcReceived, dUSDCToBurn);

    // Use the cUSDC to redeem USDC and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.redeemUnderlying.selector, usdcReceived
    ));

    _checkCompoundInteraction(
      _CUSDC.redeemUnderlying.selector, ok, data, _CTOKEN_SYMBOL
    );

    // Send the USDC to the redeemer.
    require(_USDC.transfer(msg.sender, usdcReceived), "USDC transfer failed.");
  }

  /**
   * @notice Redeem `dUSDCToBurn` dUSDC from `msg.sender` and transfer the
   * corresponding amount of cUSDC to `msg.sender`.
   * @param dUSDCToBurn uint256 The amount of dUSDC to provide for USDC.
   * @return The amount of cUSDC received in return for the provided dUSDC.
   */
  function redeemToCToken(
    uint256 dUSDCToBurn
  ) external returns (uint256 cUSDCReceived) {
    // Accrue interest and retrieve the current exchange rates.
    (uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate) = _accrue();

    // Determine the underlying USDC value of the dUSDC to be burned.
    uint256 usdcEquivalent = dUSDCToBurn.mul(dUSDCExchangeRate) / _SCALING_FACTOR;

    // Determine the amount of cUSDC corresponding to the redeemed USDC value.
    cUSDCReceived = (usdcEquivalent.mul(_SCALING_FACTOR)).div(cUSDCExchangeRate);

    // Burn the dUSDC.
    _burn(msg.sender, usdcEquivalent, dUSDCToBurn);

    // Transfer the cUSDC to the caller and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.transfer.selector, msg.sender, cUSDCReceived
    ));

    _checkCompoundInteraction(_CUSDC.transfer.selector, ok, data, _CTOKEN_SYMBOL);
  }

  /**
   * @notice Redeem the dUSDC equivalent value of USDC amount `usdcToReceive` from
   * `msg.sender`, use the corresponding cUSDC to redeem USDC, and transfer the
   * USDC to `msg.sender`.
   * @param usdcToReceive uint256 The amount, denominated in USDC, of the cUSDC to
   * provide for USDC.
   * @return The amount of dUSDC burned in exchange for the returned USDC.
   */
  function redeemUnderlying(
    uint256 usdcToReceive
  ) external returns (uint256 dUSDCBurned) {
    // Use the cUSDC to redeem USDC and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.redeemUnderlying.selector, usdcToReceive
    ));

    _checkCompoundInteraction(
      _CUSDC.redeemUnderlying.selector, ok, data, _CTOKEN_SYMBOL
    );

    // Accrue after the Compound redeem to avoid duplicating calculations.
    (uint256 dUSDCExchangeRate, ) = _accrue();

    // Determine the dUSDC to redeem using the exchange rate.
    dUSDCBurned = (
      (usdcToReceive.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate)
    ).add(1);

    // Burn the dUSDC.
    _burn(msg.sender, usdcToReceive, dUSDCBurned);

    // Send the USDC to the redeemer.
    require(_USDC.transfer(msg.sender, usdcToReceive), "USDC transfer failed.");
  }

  /**
   * @notice Redeem the dUSDC equivalent value of USDC amount `usdcToReceive` from
   * `msg.sender` and transfer the corresponding amount of cUSDC to `msg.sender`.
   * @param usdcToReceive uint256 The amount, denominated in USDC, of the cUSDC to
   * provide for USDC.
   * @return The amount of dUSDC burned in exchange for the returned cUSDC.
   */
  function redeemUnderlyingToCToken(
    uint256 usdcToReceive
  ) external returns (uint256 dUSDCBurned) {
    // Accrue interest and retrieve the current exchange rates.
    (uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate) = _accrue();

    // Determine the dUSDC to redeem using the exchange rate.
    dUSDCBurned = (
      (usdcToReceive.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate)
    ).add(1);

    // Burn the dUSDC.
    _burn(msg.sender, usdcToReceive, dUSDCBurned);

    // Determine the amount of cUSDC corresponding to the redeemed USDC value.
    uint256 cUSDCToReceive = (
      usdcToReceive.mul(_SCALING_FACTOR)
    ).div(cUSDCExchangeRate);

    // Transfer the cUSDC to the caller and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.transfer.selector, msg.sender, cUSDCToReceive
    ));

    _checkCompoundInteraction(_CUSDC.transfer.selector, ok, data, _CTOKEN_SYMBOL);
  }

  /**
   * @notice Transfer cUSDC in excess of the total dUSDC balance to a dedicated
   * "vault" account. A "hard" accrual will first be performed, triggering an
   * accrual on both cUSDC and dUSDC.
   * @return The amount of cUSDC transferred to the vault account.
   */
  function pullSurplus() external returns (uint256 cUSDCSurplus) {
    // Accrue interest on cUSDC.
    (bool ok, bytes memory data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.accrueInterest.selector
    ));

    _checkCompoundInteraction(_CUSDC.accrueInterest.selector, ok, data, _CTOKEN_SYMBOL);

    // Accrue interest on dUSDC.
    _accrue();

    // Determine cUSDC surplus (difference between total dUSDC and total cUSDC).
    uint256 usdcSurplus;
    (usdcSurplus, cUSDCSurplus) = _getSurplus();

    // Transfer the cUSDC to the vault and ensure that the operation succeeds.
    (ok, data) = address(_CUSDC).call(abi.encodeWithSelector(
      _CUSDC.transfer.selector, _VAULT, cUSDCSurplus
    ));

    _checkCompoundInteraction(_CUSDC.transfer.selector, ok, data, _CTOKEN_SYMBOL);

    emit CollectSurplus(usdcSurplus, cUSDCSurplus);
  }

  /**
   * @notice Manually advance the dUSDC exchange rate and update the cUSDC
   * exchange rate to that of the current block.
   */
  function accrueInterest() external {
    // Accrue interest on dUSDC.
    _accrue();
  }

  /**
   * @notice Transfer `amount` tokens from `msg.sender` to `recipient`.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transfer(
    address recipient, uint256 amount
  ) external returns (bool success) {
    _transfer(msg.sender, recipient, amount);
    success = true;
  }

  /**
   * @notice Transfer dUSDC equal to `amount` USDC from `msg.sender` to =
   * `recipient`.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transferUnderlying(
    address recipient, uint256 amount
  ) external returns (bool success) {
    // Accrue interest and retrieve the current dUSDC exchange rate.
    (uint256 dUSDCExchangeRate, ) = _accrue();

    // Determine the dUSDC to transfer using the exchange rate
    uint256 dUSDCAmount = (amount.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate);

    _transfer(msg.sender, recipient, dUSDCAmount);
    success = true;
  }

  /**
   * @notice Approve `spender` to transfer up to `value` tokens on behalf of
   * `msg.sender`.
   * @param spender address The account to grant the allowance.
   * @param value uint256 The size of the allowance to grant.
   * @return A boolean indicating whether the approval was successful.
   */
  function approve(
    address spender, uint256 value
  ) external returns (bool success) {
    _approve(msg.sender, spender, value);
    success = true;
  }

  /**
   * @notice Transfer `amount` tokens from `sender` to `recipient` as long as
   * `msg.sender` has sufficient allowance.
   * @param sender address The account to transfer tokens from.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transferFrom(
    address sender, address recipient, uint256 amount
  ) external returns (bool success) {
    _transfer(sender, recipient, amount);
    uint256 allowance = _allowances[sender][msg.sender];
    if (allowance != uint256(-1)) {
      _approve(sender, msg.sender, allowance.sub(amount));
    }
    success = true;
  }

  /**
   * @notice Transfer dUSDC equal to `amount` USDC from `sender` to `recipient` as
   * long as `msg.sender` has sufficient allowance.
   * @param sender address The account to transfer tokens from.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transferUnderlyingFrom(
    address sender, address recipient, uint256 amount
  ) external returns (bool success) {
    // Accrue interest and retrieve the current dUSDC exchange rate.
    (uint256 dUSDCExchangeRate, ) = _accrue();

    // Determine the dUSDC to transfer using the exchange rate.
    uint256 dUSDCAmount = (amount.mul(_SCALING_FACTOR)).div(dUSDCExchangeRate);

    _transfer(sender, recipient, dUSDCAmount);
    uint256 allowance = _allowances[sender][msg.sender];
    if (allowance != uint256(-1)) {
      _approve(sender, msg.sender, allowance.sub(dUSDCAmount));
    }
    success = true;
  }

  /**
   * @notice Increase the current allowance of `spender` by `value` tokens.
   * @param spender address The account to grant the additional allowance.
   * @param addedValue uint256 The amount to increase the allowance by.
   * @return A boolean indicating whether the modification was successful.
   */
  function increaseAllowance(
    address spender, uint256 addedValue
  ) external returns (bool success) {
    _approve(
      msg.sender, spender, _allowances[msg.sender][spender].add(addedValue)
    );
    success = true;
  }

  /**
   * @notice Decrease the current allowance of `spender` by `value` tokens.
   * @param spender address The account to decrease the allowance for.
   * @param subtractedValue uint256 The amount to subtract from the allowance.
   * @return A boolean indicating whether the modification was successful.
   */
  function decreaseAllowance(
    address spender, uint256 subtractedValue
  ) external returns (bool success) {
    _approve(
      msg.sender, spender, _allowances[msg.sender][spender].sub(subtractedValue)
    );
    success = true;
  }

  /**
   * @notice View function to get the total surplus, or cUSDC balance that
   * exceeds the total dUSDC balance.
   * @return The total surplus in cUSDC.
   */
  function getSurplus() external view returns (uint256 cUSDCSurplus) {
    // Determine the USDC surplus (difference between total dUSDC and total USDC)
    (, cUSDCSurplus) = _getSurplus();
  }

  /**
   * @notice View function to get the total surplus, or USDC equivalent of the
   * cUSDC balance that exceeds the total dUSDC balance.
   * @return The total surplus in USDC.
   */
  function getSurplusUnderlying() external view returns (uint256 usdcSurplus) {
    // Determine the USDC surplus (difference between total dUSDC and total USDC)
    (usdcSurplus, ) = _getSurplus();
  }

  /**
   * @notice View function to get the current dUSDC exchange rate (multiplied by
   * 10^18).
   * @return The current exchange rate.
   */
  function exchangeRateCurrent() external view returns (uint256 dUSDCExchangeRate) {
    // Get most recent dUSDC exchange rate by determining accrued interest
    (dUSDCExchangeRate,,) = _getAccruedInterest();
  }

  /**
   * @notice View function to get the current dUSDC interest earned per block
   * (multiplied by 10^18).
   * @return The current interest rate.
   */
  function supplyRatePerBlock() external view returns (uint256 dUSDCInterestRate) {
    (dUSDCInterestRate,) = _getRatePerBlock();
  }

  /**
   * @notice View function to get the block number where accrual was last
   * performed.
   * @return The block number where accrual was last performed.
   */
  function accrualBlockNumber() external view returns (uint256 blockNumber) {
    blockNumber = _accrualIndex.block;
  }

  /**
   * @notice View function to get the current cUSDC interest spread over dUSDC per
   * block (multiplied by 10^18).
   * @return The current interest rate spread.
   */
  function getSpreadPerBlock() external view returns (uint256 rateSpread) {
    (uint256 dUSDCInterestRate, uint256 cUSDCInterestRate) = _getRatePerBlock();
    rateSpread = cUSDCInterestRate - dUSDCInterestRate;
  }

  /**
   * @notice View function to get the total dUSDC supply.
   * @return The total supply.
   */
  function totalSupply() external view returns (uint256 dUSDCTotalSupply) {
    dUSDCTotalSupply = _totalSupply;
  }

  /**
   * @notice View function to get the total dUSDC supply, denominated in USDC.
   * @return The total supply.
   */
  function totalSupplyUnderlying() external view returns (
    uint256 dUSDCTotalSupplyInUSDC
  ) {
    (uint256 dUSDCExchangeRate,,) = _getAccruedInterest();

    // Determine the total value of all issued dUSDC in USDC.
    dUSDCTotalSupplyInUSDC = (
      _totalSupply.mul(dUSDCExchangeRate) / _SCALING_FACTOR
    );
  }

  /**
   * @notice View function to get the total dUSDC balance of an account.
   * @param account address The account to check the dUSDC balance for.
   * @return The balance of the given account.
   */
  function balanceOf(address account) external view returns (uint256 dUSDC) {
    dUSDC = _balances[account];
  }

  /**
   * @notice View function to get the dUSDC balance of an account, denominated in
   * its USDC equivalent value.
   * @param account address The account to check the balance for.
   * @return The total USDC-equivalent cUSDC balance.
   */
  function balanceOfUnderlying(
    address account
  ) external view returns (uint256 usdcBalance) {
    // Get most recent dUSDC exchange rate by determining accrued interest
    (uint256 dUSDCExchangeRate,,) = _getAccruedInterest();

    // Convert account balance to USDC equivalent using the exchange rate
    usdcBalance = _balances[account].mul(dUSDCExchangeRate) / _SCALING_FACTOR;
  }

  /**
   * @notice View function to get the total allowance that `spender` has to
   * transfer funds from the `owner` account using `transferFrom`.
   * @param owner address The account that is granting the allowance.
   * @param spender address The account that has been granted the allowance.
   * @return The allowance of the given spender for the given owner.
   */
  function allowance(address owner, address spender) external view returns (uint256 dUSDCAllowance) {
    dUSDCAllowance = _allowances[owner][spender];
  }

  /**
   * @notice Pure function to get the name of the token.
   * @return The name of the token.
   */
  function name() external pure returns (string memory dUSDCName) {
    dUSDCName = _NAME;
  }

  /**
   * @notice Pure function to get the symbol of the token.
   * @return The symbol of the token.
   */
  function symbol() external pure returns (string memory dUSDCSymbol) {
    dUSDCSymbol = _SYMBOL;
  }

  /**
   * @notice Pure function to get the number of decimals of the token.
   * @return The number of decimals of the token.
   */
  function decimals() external pure returns (uint8 dUSDCDecimals) {
    dUSDCDecimals = _DECIMALS;
  }

  /**
   * @notice Pure function for getting the current Dharma USDC version.
   * @return The current Dharma USDC version.
   */
  function getVersion() external pure returns (uint256 version) {
    version = _DHARMA_USDC_VERSION;
  }

  /**
   * @notice Internal function to trigger accrual and to update the dUSDC and
   * cUSDC exchange rates in storage if necessary.
   * @return The current dUSDC and cUSDC exchange rates.
   */
  function _accrue() internal returns (
    uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate
  ){
    bool accrued;
    (dUSDCExchangeRate, cUSDCExchangeRate, accrued) = _getAccruedInterest();

    if (!accrued) {
      // Update storage with dUSDC + cUSDC exchange rates as of current block.
      AccrualIndex storage accrualIndex = _accrualIndex;
      accrualIndex.dTokenExchangeRate = _safeUint112(dUSDCExchangeRate);
      accrualIndex.cTokenExchangeRate = _safeUint112(cUSDCExchangeRate);
      accrualIndex.block = uint32(block.number);
      emit Accrue(dUSDCExchangeRate, cUSDCExchangeRate);
    }
  }

  /**
   * @notice Internal function to mint `amount` tokens by exchanging `exchanged`
   * tokens to `account` and emit corresponding `Mint` & `Transfer` events.
   * @param account address The account to mint tokens to.
   * @param exchanged uint256 The amount of underlying tokens used to mint.
   * @param amount uint256 The amount of tokens to mint.
   */
  function _mint(address account, uint256 exchanged, uint256 amount) internal {
    _totalSupply = _totalSupply.add(amount);
    _balances[account] = _balances[account].add(amount);

    emit Mint(account, exchanged, amount);
    emit Transfer(address(0), account, amount);
  }

  /**
   * @notice Internal function to burn `amount` tokens by exchanging `exchanged`
   * tokens from `account` and emit corresponding `Redeeem` & `Transfer` events.
   * @param account address The account to burn tokens from.
   * @param exchanged uint256 The amount of underlying tokens given for burning.
   * @param amount uint256 The amount of tokens to burn.
   */
  function _burn(address account, uint256 exchanged, uint256 amount) internal {
    uint256 balancePriorToBurn = _balances[account];
    require(
      balancePriorToBurn >= amount, "Supplied amount exceeds account balance."
    );

    _totalSupply = _totalSupply.sub(amount);
    _balances[account] = balancePriorToBurn - amount; // overflow checked above

    emit Transfer(account, address(0), amount);
    emit Redeem(account, exchanged, amount);
  }

  /**
   * @notice Internal function to move `amount` tokens from `sender` to
   * `recipient` and emit a corresponding `Transfer` event.
   * @param sender address The account to transfer tokens from.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   */
  function _transfer(address sender, address recipient, uint256 amount) internal {
    require(sender != address(0), "ERC20: transfer from the zero address");
    require(recipient != address(0), "ERC20: transfer to the zero address");

    _balances[sender] = _balances[sender].sub(amount);
    _balances[recipient] = _balances[recipient].add(amount);
    emit Transfer(sender, recipient, amount);
  }

  /**
   * @notice Internal function to set the allowance for `spender` to transfer up
   * to `value` tokens on behalf of `owner`.
   * @param owner address The account that has granted the allowance.
   * @param spender address The account to grant the allowance.
   * @param value uint256 The size of the allowance to grant.
   */
  function _approve(address owner, address spender, uint256 value) internal {
    require(owner != address(0), "ERC20: approve from the zero address");
    require(spender != address(0), "ERC20: approve to the zero address");

    _allowances[owner][spender] = value;
    emit Approval(owner, spender, value);
  }

  /**
   * @notice Internal view function to get the latest dUSDC and cUSDC exchange
   * rates for USDC and provide the value for each.
   * @return The dUSDC and cUSDC exchange rate, as well as a boolean indicating
   * if interest accrual has been processed already or needs to be calculated
   * and placed in storage.
   */
  function _getAccruedInterest() internal view returns (
    uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate, bool fullyAccrued
  ) {
    // Get the stored accrual block and dUSDC + cUSDC exhange rates.
    AccrualIndex memory accrualIndex = _accrualIndex;
    uint256 storedDUSDCExchangeRate = uint256(accrualIndex.dTokenExchangeRate);
    uint256 storedCUSDCExchangeRate = uint256(accrualIndex.cTokenExchangeRate);
    uint256 accrualBlock = uint256(accrualIndex.block);

    // Get the current cUSDC exchange rate.
    (cUSDCExchangeRate,) = _getCurrentCUSDCRates();

    // Only recompute dUSDC exchange rate if accrual has not already occurred.
    fullyAccrued = (accrualBlock == block.number);
    if (fullyAccrued) {
      dUSDCExchangeRate = storedDUSDCExchangeRate;
    } else {
      // Determine the cUSDC interest earned during the period.
      uint256 cUSDCInterest = (
        (cUSDCExchangeRate.mul(_SCALING_FACTOR)).div(storedCUSDCExchangeRate)
      ).sub(_SCALING_FACTOR);

      // Calculate dUSDC exchange rate by applying 90% of the cUSDC interest.
      dUSDCExchangeRate = storedDUSDCExchangeRate.mul(
        _SCALING_FACTOR.add(cUSDCInterest.mul(9) / 10)
      ) / _SCALING_FACTOR;
    }
  }

  /**
   * @notice Internal view function to get the current cUSDC exchange rate and
   * supply rate per block.
   * @return The current cUSDC exchange rate, or amount of USDC that is
   * redeemable for each cUSDC, and the cUSDC supply rate per block (with 18
   * decimal places added to each returned rate).
   */
  function _getCurrentCUSDCRates() internal view returns (
    uint256 exchangeRate, uint256 supplyRate
  ) {
    // Determine number of blocks that have elapsed since last cUSDC accrual.
    uint256 blockDelta = block.number.sub(_CUSDC.accrualBlockNumber());

    // Return stored values if accrual has already been performed this block.
    if (blockDelta == 0) return (
      _CUSDC.exchangeRateStored(), _CUSDC.supplyRatePerBlock()
    );
    
    // Determine total "cash" held by cUSDC contract.
    uint256 cash = _USDC.balanceOf(address(_CUSDC));

    // Get the latest interest rate model from the cUSDC contract.
    CUSDCInterestRateModelInterface interestRateModel = CUSDCInterestRateModelInterface(
      _CUSDC.interestRateModel()
    );

    // Get the current stored total borrows, reserves, and reserve factor.
    uint256 borrows = _CUSDC.totalBorrows();
    uint256 reserves = _CUSDC.totalReserves();
    uint256 reserveFactor = _CUSDC.reserveFactorMantissa();

    // Get accumulated borrow interest via interest rate model and block delta.
    (uint256 err, uint256 borrowRate) = interestRateModel.getBorrowRate(
      cash, borrows, reserves
    );

    require(
      err == _COMPOUND_SUCCESS, "Interest Rate Model borrow rate check failed."
    );

    uint256 interest = borrowRate.mul(blockDelta).mul(borrows) / _SCALING_FACTOR;

    // Update total borrows and reserves using calculated accumulated interest.
    borrows = borrows.add(interest);
    reserves = reserves.add(reserveFactor.mul(interest) / _SCALING_FACTOR);

    // Get "underlying": (cash + borrows - reserves)
    uint256 underlying = (cash.add(borrows)).sub(reserves);

    // Determine cUSDC exchange rate: underlying / total supply
    exchangeRate = (underlying.mul(_SCALING_FACTOR)).div(_CUSDC.totalSupply());

    // Get "borrows per" by dividing total borrows by underlying and scaling up.
    uint256 borrowsPer = (
      borrows.mul(_SCALING_FACTOR_SQUARED)
    ).div(underlying);

    // Supply rate is borrow interest * (1 - reserveFactor) * borrowsPer
    supplyRate = (
      interest.mul(_SCALING_FACTOR.sub(reserveFactor)).mul(borrowsPer)
    ) / _SCALING_FACTOR_SQUARED;
  }

  /**
   * @notice Internal view function to get the total surplus, or cUSDC
   * balance that exceeds the total dUSDC balance.
   * @return The total surplus, denominated in both USDC and in cUSDC.
   */
  function _getSurplus() internal view returns (
    uint256 usdcSurplus, uint256 cUSDCSurplus
  ) {
    (uint256 dUSDCExchangeRate, uint256 cUSDCExchangeRate,) = _getAccruedInterest();

    // Determine the total value of all issued dUSDC in USDC, rounded up.
    uint256 dUSDCUnderlying = (
      _totalSupply.mul(dUSDCExchangeRate) / _SCALING_FACTOR
    ).add(1);

    // Determine the total value of all retained cUSDC in USDC, rounded down.
    uint256 cUSDCUnderlying = (
      _CUSDC.balanceOf(address(this)).mul(cUSDCExchangeRate) / _SCALING_FACTOR
    );

    // Determine the size of the surplus in terms of underlying amount.
    usdcSurplus = (
      cUSDCUnderlying > dUSDCUnderlying ? cUSDCUnderlying - dUSDCUnderlying : 0
    );

    // Determine the cUSDC equivalent of this surplus amount.
    cUSDCSurplus = (
      usdcSurplus == 0 ? 0 : (usdcSurplus.mul(_SCALING_FACTOR)).div(cUSDCExchangeRate)
    );
  }

  /**
   * @notice View function to get the current dUSDC and cUSDC interest supply rate
   * per block (multiplied by 10^18).
   * @return The current dUSDC and cUSDC interest rates.
   */
  function _getRatePerBlock() internal view returns (
    uint256 dUSDCSupplyRate, uint256 cUSDCSupplyRate
  ) {
    (, cUSDCSupplyRate) = _getCurrentCUSDCRates();
    dUSDCSupplyRate = cUSDCSupplyRate.mul(9) / 10;
  }
}