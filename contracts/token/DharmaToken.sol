pragma solidity 0.5.11;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./DharmaTokenHelpers.sol";
import "../../interfaces/CTokenInterface.sol";
import "../../interfaces/DTokenInterface.sol";
import "../../interfaces/ERC20Interface.sol";


/**
 * @title DharmaToken
 * @author 0age (dToken mechanics derived from Compound cTokens, ERC20 mechanics
 * derived from Open Zeppelin's ERC20 contract)
 * @notice Initial prototype for a cToken wrapper token. This version is not
 * upgradeable, and serves as an initial test of the eventual dToken mechanics.
 * The dToken exchange rate will grow at 90% the rate of the cToken exchange
 * rate.
 */
contract DharmaToken is ERC20Interface, DTokenInterface, DharmaTokenHelpers {
  using SafeMath for uint256;

  uint256 private constant _DTOKEN_VERSION = 0;

  // Set block number and dToken + cToken exchange rate in slot zero on accrual.
  AccrualIndex private _accrualIndex;

  // Slot one tracks the total issued dTokens.
  uint256 private _totalSupply;

  // Slots two and three are entrypoints into balance and allowance mappings.
  mapping (address => uint256) private _balances;
  mapping (address => mapping (address => uint256)) private _allowances;

  // TEMPORARY - replace with initializer for upgradeable contracts.
  constructor() public {
    // Instantiate interfaces for the underlying token and the backing cToken.
    ERC20Interface underlying = ERC20Interface(_getUnderlying());
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Approve cToken to transfer underlying for this contract in order to mint.
    require(
      underlying.approve(address(cToken), uint256(-1)), "Approval failed."
    );

    // Initial dToken exchange rate is 1-to-1 (dTokens have 8 decimals).
    uint256 dTokenExchangeRate = 10 ** (
      uint256(10).add(uint256(_getUnderlyingDecimals()))
    );

    // Accrue cToken interest and retrieve the current cToken exchange rate.
    uint256 cTokenExchangeRate = cToken.exchangeRateCurrent();

    // Initialize accrual index with current block number and exchange rates.
    AccrualIndex storage accrualIndex = _accrualIndex;
    accrualIndex.dTokenExchangeRate = _safeUint112(dTokenExchangeRate);
    accrualIndex.cTokenExchangeRate = _safeUint112(cTokenExchangeRate);
    accrualIndex.block = uint32(block.number);
    emit Accrue(dTokenExchangeRate, cTokenExchangeRate);
  }

  /**
   * @notice Transfer `underlyingToSupply` underlying tokens from `msg.sender`
   * to this contract, use them to mint cTokens as backing, and mint dTokens to
   * `msg.sender`. Ensure that this contract has been approved to transfer the
   * underlying on behalf of the caller before calling this function.
   * @param underlyingToSupply uint256 The amount of underlying to provide as
   * part of minting.
   * @return The amount of dTokens received in return for the supplied
   * underlying tokens.
   */
  function mint(
    uint256 underlyingToSupply
  ) external returns (uint256 dTokensMinted) {
    // Instantiate interfaces for the underlying token and the backing cToken.
    ERC20Interface underlying = ERC20Interface(_getUnderlying());
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Pull in underlying - ensure that this contract has sufficient allowance.
    require(
      underlying.transferFrom(msg.sender, address(this), underlyingToSupply),
      _getTransferFailureMessage()
    );

    // Use underlying to mint cTokens and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.mint.selector, underlyingToSupply
    ));
    _checkCompoundInteraction(cToken.mint.selector, ok, data);

    // Accrue after the Compound mint to avoid duplicating accrual calculations.
    (uint256 dTokenExchangeRate, ) = _accrue();

    // Determine the dTokens to mint for the underlying using the exchange rate.
    dTokensMinted = (
      underlyingToSupply.mul(_SCALING_FACTOR)
    ).div(dTokenExchangeRate);

    // Mint dTokens to the caller.
    _mint(msg.sender, underlyingToSupply, dTokensMinted);
  }

  /**
   * @notice Transfer `cTokensToSupply` cTokens from `msg.sender` to this
   * contract and mint dTokens to `msg.sender`. Ensure that this contract has
   * been approved to transfer the cTokens on behalf of the caller before
   * calling this function.
   * @param cTokensToSupply uint256 The amount of cTokens to provide as part of
   * minting.
   * @return The amount of dTokens received in return for the supplied cTokens.
   */
  function mintViaCToken(
    uint256 cTokensToSupply
  ) external returns (uint256 dTokensMinted) {
    // Instantiate the interface for the backing cToken.
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Pull in cTokens - ensure that this contract has sufficient allowance.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.transferFrom.selector, msg.sender, address(this), cTokensToSupply
    ));
    _checkCompoundInteraction(cToken.transferFrom.selector, ok, data);

    // Accrue interest and retrieve current cToken and dToken exchange rates.
    (uint256 dTokenExchangeRate, uint256 cTokenExchangeRate) = _accrue();

    // Determine the underlying equivalent of the supplied cToken amount.
    uint256 underlyingEquivalent = cTokensToSupply.mul(
      cTokenExchangeRate
    ) / _SCALING_FACTOR;

    // Determine dTokens to mint using underlying equivalent and exchange rate.
    dTokensMinted = (
      underlyingEquivalent.mul(_SCALING_FACTOR)
    ).div(dTokenExchangeRate);

    // Mint dTokens to the caller.
    _mint(msg.sender, underlyingEquivalent, dTokensMinted);
  }

  /**
   * @notice Redeem `dTokensToBurn` dTokens from `msg.sender`, use the
   * corresponding cTokens to redeem the required underlying, and transfer the
   * redeemed underlying tokens to `msg.sender`.
   * @param dTokensToBurn uint256 The amount of dTokens to provide in exchange
   * for underlying tokens.
   * @return The amount of underlying received in return for the provided
   * dTokens.
   */
  function redeem(
    uint256 dTokensToBurn
  ) external returns (uint256 underlyingReceived) {
    // Instantiate interfaces for the underlying token and the backing cToken.
    ERC20Interface underlying = ERC20Interface(_getUnderlying());
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Accrue interest and retrieve the current dToken exchange rate.
    (uint256 dTokenExchangeRate, ) = _accrue();

    // Determine the underlying token value of the dTokens to be burned.
    underlyingReceived = dTokensToBurn.mul(
      dTokenExchangeRate
    ) / _SCALING_FACTOR;

    // Burn the dTokens.
    _burn(msg.sender, underlyingReceived, dTokensToBurn);

    // Use cTokens to redeem underlying and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.redeemUnderlying.selector, underlyingReceived
    ));
    _checkCompoundInteraction(cToken.redeemUnderlying.selector, ok, data);

    // Send the redeemed underlying tokens to the caller.
    require(
      underlying.transfer(msg.sender, underlyingReceived),
      _getTransferFailureMessage()
    );
  }

  /**
   * @notice Redeem `dTokensToBurn` dTokens from `msg.sender` and transfer the
   * corresponding amount of cTokens to `msg.sender`.
   * @param dTokensToBurn uint256 The amount of dTokens to provide in exchange
   * for the cTokens.
   * @return The amount of cTokens received in return for the provided dTokens.
   */
  function redeemToCToken(
    uint256 dTokensToBurn
  ) external returns (uint256 cTokensReceived) {
    // Instantiate the interface for the backing cToken.
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Accrue interest and retrieve current cToken and dToken exchange rates.
    (uint256 dTokenExchangeRate, uint256 cTokenExchangeRate) = _accrue();

    // Determine the underlying token value of the dTokens to be burned.
    uint256 underlyingEquivalent = dTokensToBurn.mul(
      dTokenExchangeRate
    ) / _SCALING_FACTOR;

    // Determine amount of cTokens corresponding to underlying equivalent value.
    cTokensReceived = (
      underlyingEquivalent.mul(_SCALING_FACTOR)
    ).div(cTokenExchangeRate);

    // Burn the dTokens.
    _burn(msg.sender, underlyingEquivalent, dTokensToBurn);

    // Transfer cTokens to the caller and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.transfer.selector, msg.sender, cTokensReceived
    ));
    _checkCompoundInteraction(cToken.transfer.selector, ok, data);
  }

  /**
   * @notice Redeem the dToken equivalent value of the underlying token amount
   * `underlyingToReceive` from `msg.sender`, use the corresponding cTokens to
   * redeem the underlying, and transfer the underlying to `msg.sender`.
   * @param underlyingToReceive uint256 The amount, denominated in the
   * underlying token, of the cToken to redeem in exchange for the received
   * underlying token.
   * @return The amount of dTokens burned in exchange for the returned
   * underlying tokens.
   */
  function redeemUnderlying(
    uint256 underlyingToReceive
  ) external returns (uint256 dTokensBurned) {
    // Instantiate interfaces for the underlying token and the backing cToken.
    ERC20Interface underlying = ERC20Interface(_getUnderlying());
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Use cTokens to redeem underlying and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.redeemUnderlying.selector, underlyingToReceive
    ));
    _checkCompoundInteraction(cToken.redeemUnderlying.selector, ok, data);

    // Accrue after the Compound redeem to avoid duplicating calculations.
    (uint256 dTokenExchangeRate, ) = _accrue();

    // Determine the dTokens to redeem using the exchange rate.
    dTokensBurned = (
      (underlyingToReceive.mul(_SCALING_FACTOR)).div(dTokenExchangeRate)
    ).add(1);

    // Burn the dTokens.
    _burn(msg.sender, underlyingToReceive, dTokensBurned);

    // Send the redeemed underlying tokens to the caller.
    require(
      underlying.transfer(msg.sender, underlyingToReceive),
      _getTransferFailureMessage()
    );
  }

  /**
   * @notice Redeem the dToken equivalent value of the underlying tokens of
   * amount `underlyingToReceive` from `msg.sender` and transfer the
   * corresponding amount of cTokens to `msg.sender`.
   * @param underlyingToReceive uint256 The amount, denominated in the
   * underlying token, of cTokens to receive.
   * @return The amount of dTokens burned in exchange for the returned cTokens.
   */
  function redeemUnderlyingToCToken(
    uint256 underlyingToReceive
  ) external returns (uint256 dTokensBurned) {
    // Instantiate the interface for the backing cToken.
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Accrue interest and retrieve current cToken and dToken exchange rates.
    (uint256 dTokenExchangeRate, uint256 cTokenExchangeRate) = _accrue();

    // Determine the dTokens to redeem using the exchange rate.
    dTokensBurned = (
      (underlyingToReceive.mul(_SCALING_FACTOR)).div(dTokenExchangeRate)
    ).add(1);

    // Burn the dTokens.
    _burn(msg.sender, underlyingToReceive, dTokensBurned);

    // Determine amount of cTokens corresponding to the underlying dToken value.
    uint256 cTokensToReceive = (
      underlyingToReceive.mul(_SCALING_FACTOR)
    ).div(cTokenExchangeRate);

    // Transfer cTokens to the caller and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.transfer.selector, msg.sender, cTokensToReceive
    ));
    _checkCompoundInteraction(cToken.transfer.selector, ok, data);
  }

  /**
   * @notice Transfer cTokens with underlying value in excess of the total
   * underlying dToken value to a dedicated "vault" account. A "hard" accrual
   * will first be performed, triggering an accrual on both the cToken and the
   * dToken.
   * @return The amount of cTokens transferred to the vault account.
   */
  function pullSurplus() external returns (uint256 cTokenSurplus) {
    // Instantiate the interface for the backing cToken.
    CTokenInterface cToken = CTokenInterface(_getCToken());

    // Accrue interest on the cToken and ensure that the operation succeeds.
    (bool ok, bytes memory data) = address(cToken).call(abi.encodeWithSelector(
      cToken.accrueInterest.selector
    ));
    _checkCompoundInteraction(cToken.accrueInterest.selector, ok, data);

    // Accrue interest on the dToken.
    _accrue();

    // Determine cToken surplus in underlying (cToken value - dToken value).
    uint256 underlyingSurplus;
    (underlyingSurplus, cTokenSurplus) = _getSurplus();

    // Transfer cToken surplus to vault and ensure that the operation succeeds.
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.transfer.selector, _getVault(), cTokenSurplus
    ));
    _checkCompoundInteraction(cToken.transfer.selector, ok, data);

    emit CollectSurplus(underlyingSurplus, cTokenSurplus);
  }

  /**
   * @notice Manually advance the dToken exchange rate and cToken exchange rate
   * to that of the current block. Note that dToken accrual does not trigger
   * cToken accrual - instead, the updated exchange rate will be calculated
   * internally.
   */
  function accrueInterest() external {
    // Accrue interest on the dToken.
    _accrue();
  }

  /**
   * @notice Transfer `amount` dTokens from `msg.sender` to `recipient`.
   * @param recipient address The account to transfer the dTokens to.
   * @param amount uint256 The amount of dTokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transfer(
    address recipient, uint256 amount
  ) external returns (bool success) {
    _transfer(msg.sender, recipient, amount);
    success = true;
  }

  /**
   * @notice Transfer dTokens equivalent to `underlyingEquivalentAmount`
   * underlying from `msg.sender` to `recipient`.
   * @param recipient address The account to transfer the dTokens to.
   * @param underlyingEquivalentAmount uint256 The underlying equivalent amount
   * of dTokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transferUnderlying(
    address recipient, uint256 underlyingEquivalentAmount
  ) external returns (bool success) {
    // Accrue interest and retrieve the current dToken exchange rate.
    (uint256 dTokenExchangeRate, ) = _accrue();

    // Determine the dToken amount to transfer using the exchange rate.
    uint256 dTokenAmount = (
      underlyingEquivalentAmount.mul(_SCALING_FACTOR)
    ).div(dTokenExchangeRate);

    // Transfer the dTokens.
    _transfer(msg.sender, recipient, dTokenAmount);
    success = true;
  }

  /**
   * @notice Approve `spender` to transfer up to `value` dTokens on behalf of
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
   * @notice Transfer `amount` dTokens from `sender` to `recipient` as long as
   * `msg.sender` has sufficient allowance.
   * @param sender address The account to transfer the dTokens from.
   * @param recipient address The account to transfer the dTokens to.
   * @param amount uint256 The amount of dTokens to transfer.
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
   * @notice Transfer dTokens eqivalent to `underlyingEquivalentAmount`
   * underlying from `sender` to `recipient` as long as `msg.sender` has
   * sufficient allowance.
   * @param sender address The account to transfer the dTokens from.
   * @param recipient address The account to transfer the dTokens to.
   * @param underlyingEquivalentAmount uint256 The underlying equivalent amount
   * of dTokens to transfer.
   * @return A boolean indicating whether the transfer was successful.
   */
  function transferUnderlyingFrom(
    address sender, address recipient, uint256 underlyingEquivalentAmount
  ) external returns (bool success) {
    // Accrue interest and retrieve the current dToken exchange rate.
    (uint256 dTokenExchangeRate, ) = _accrue();

    // Determine the dTokens to transfer using the exchange rate.
    uint256 dTokenAmount = (
      underlyingEquivalentAmount.mul(_SCALING_FACTOR)
    ).div(dTokenExchangeRate);

    // Transfer the dTokens and adjust allowance accordingly.
    _transfer(sender, recipient, dTokenAmount);
    uint256 allowance = _allowances[sender][msg.sender];
    if (allowance != uint256(-1)) {
      _approve(sender, msg.sender, allowance.sub(dTokenAmount));
    }
    success = true;
  }

  /**
   * @notice Increase the current allowance of `spender` by `value` dTokens.
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
   * @notice Decrease the current allowance of `spender` by `value` dTokens.
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
   * @notice View function to get the total dToken supply.
   * @return The total supply.
   */
  function totalSupply() external view returns (uint256 dTokenTotalSupply) {
    dTokenTotalSupply = _totalSupply;
  }

  /**
   * @notice View function to get the total dToken supply, denominated in the
   * underlying token.
   * @return The total supply.
   */
  function totalSupplyUnderlying() external view returns (
    uint256 dTokenTotalSupplyInUnderlying
  ) {
    (uint256 dTokenExchangeRate, ,) = _getAccruedInterest();

    // Determine total value of all issued dTokens, denominated as underlying.
    dTokenTotalSupplyInUnderlying = (
      _totalSupply.mul(dTokenExchangeRate) / _SCALING_FACTOR
    );
  }

  /**
   * @notice View function to get the total dToken balance of an account.
   * @param account address The account to check the dToken balance for.
   * @return The balance of the given account.
   */
  function balanceOf(address account) external view returns (uint256 dTokens) {
    dTokens = _balances[account];
  }

  /**
   * @notice View function to get the dToken balance of an account, denominated
   * in the underlying equivalent value.
   * @param account address The account to check the balance for.
   * @return The total underlying-equivalent dToken balance.
   */
  function balanceOfUnderlying(
    address account
  ) external view returns (uint256 underlyingBalance) {
    // Get most recent dToken exchange rate by determining accrued interest.
    (uint256 dTokenExchangeRate, ,) = _getAccruedInterest();

    // Convert account balance to underlying equivalent using the exchange rate.
    underlyingBalance = _balances[account].mul(
      dTokenExchangeRate
    ) / _SCALING_FACTOR;
  }

  /**
   * @notice View function to get the total allowance that `spender` has to
   * transfer dTokens from the `owner` account using `transferFrom`.
   * @param owner address The account that is granting the allowance.
   * @param spender address The account that has been granted the allowance.
   * @return The allowance of the given spender for the given owner.
   */
  function allowance(
    address owner, address spender
  ) external view returns (uint256 dTokenAllowance) {
    dTokenAllowance = _allowances[owner][spender];
  }

  /**
   * @notice View function to get the current dToken exchange rate (multiplied
   * by 10^18).
   * @return The current exchange rate.
   */
  function exchangeRateCurrent() external view returns (
    uint256 dTokenExchangeRate
  ) {
    // Get most recent dToken exchange rate by determining accrued interest.
    (dTokenExchangeRate, ,) = _getAccruedInterest();
  }

  /**
   * @notice View function to get the current dToken interest earned per block
   * (multiplied by 10^18).
   * @return The current interest rate.
   */
  function supplyRatePerBlock() external view returns (
    uint256 dTokenInterestRate
  ) {
    (dTokenInterestRate,) = _getRatePerBlock();
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
   * @notice View function to get the total surplus, or the cToken balance that
   * exceeds the aggregate underlying value of the total dToken supply.
   * @return The total surplus in cTokens.
   */
  function getSurplus() external view returns (uint256 cTokenSurplus) {
    // Determine the cToken (cToken underlying value - dToken underlying value).
    (, cTokenSurplus) = _getSurplus();
  }

  /**
   * @notice View function to get the total surplus in the underlying, or the
   * underlying equivalent of the cToken balance that exceeds the aggregate
   * underlying value of the total dToken supply.
   * @return The total surplus, denominated in the underlying.
   */
  function getSurplusUnderlying() external view returns (
    uint256 underlyingSurplus
  ) {
    // Determine cToken surplus in underlying (cToken value - dToken value).
    (underlyingSurplus, ) = _getSurplus();
  }

  /**
   * @notice View function to get the interest rate spread taken by the dToken
   * from the current cToken supply rate per block (multiplied by 10^18).
   * @return The current interest rate spread.
   */
  function getSpreadPerBlock() external view returns (uint256 rateSpread) {
    (
      uint256 dTokenInterestRate, uint256 cTokenInterestRate
    ) = _getRatePerBlock();
    rateSpread = cTokenInterestRate.sub(dTokenInterestRate);
  }

  /**
   * @notice Pure function to get the name of the dToken.
   * @return The name of the dToken.
   */
  function name() external pure returns (string memory dTokenName) {
    dTokenName = _getDTokenName();
  }

  /**
   * @notice Pure function to get the symbol of the dToken.
   * @return The symbol of the dToken.
   */
  function symbol() external pure returns (string memory dTokenSymbol) {
    dTokenSymbol = _getDTokenSymbol();
  }

  /**
   * @notice Pure function to get the number of decimals of the dToken.
   * @return The number of decimals of the dToken.
   */
  function decimals() external pure returns (uint8 dTokenDecimals) {
    dTokenDecimals = _DECIMALS;
  }

  /**
   * @notice Pure function to get the dToken version.
   * @return The version of the dToken.
   */
  function getVersion() external pure returns (uint256 version) {
    version = _DTOKEN_VERSION;
  }

  /**
   * @notice Pure function to get the address of the cToken backing this dToken.
   * @return The address of the cToken backing this dToken.
   */
  function getCToken() external pure returns (address cToken) {
    cToken = _getCToken();
  }

  /**
   * @notice Pure function to get the address of the underlying token of this
   * dToken.
   * @return The address of the underlying token for this dToken.
   */
  function getUnderlying() external pure returns (address underlying) {
    underlying = _getUnderlying();
  }

  /**
   * @notice Private function to trigger accrual and to update the dToken and
   * cToken exchange rates in storage if necessary.
   * @return The current dToken and cToken exchange rates.
   */
  function _accrue() private returns (
    uint256 dTokenExchangeRate, uint256 cTokenExchangeRate
  ) {
    bool accrued;
    (dTokenExchangeRate, cTokenExchangeRate, accrued) = _getAccruedInterest();

    if (!accrued) {
      // Update storage with dToken + cToken exchange rates as of current block.
      AccrualIndex storage accrualIndex = _accrualIndex;
      accrualIndex.dTokenExchangeRate = _safeUint112(dTokenExchangeRate);
      accrualIndex.cTokenExchangeRate = _safeUint112(cTokenExchangeRate);
      accrualIndex.block = uint32(block.number);
      emit Accrue(dTokenExchangeRate, cTokenExchangeRate);
    }
  }

  /**
   * @notice Private function to mint `amount` tokens by exchanging `exchanged`
   * tokens to `account` and emit corresponding `Mint` & `Transfer` events.
   * @param account address The account to mint tokens to.
   * @param exchanged uint256 The amount of underlying tokens used to mint.
   * @param amount uint256 The amount of tokens to mint.
   */
  function _mint(address account, uint256 exchanged, uint256 amount) private {
    _totalSupply = _totalSupply.add(amount);
    _balances[account] = _balances[account].add(amount);

    emit Mint(account, exchanged, amount);
    emit Transfer(address(0), account, amount);
  }

  /**
   * @notice Private function to burn `amount` tokens by exchanging `exchanged`
   * tokens from `account` and emit corresponding `Redeeem` & `Transfer` events.
   * @param account address The account to burn tokens from.
   * @param exchanged uint256 The amount of underlying tokens given for burning.
   * @param amount uint256 The amount of tokens to burn.
   */
  function _burn(address account, uint256 exchanged, uint256 amount) private {
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
   * @notice Private function to move `amount` tokens from `sender` to
   * `recipient` and emit a corresponding `Transfer` event.
   * @param sender address The account to transfer tokens from.
   * @param recipient address The account to transfer tokens to.
   * @param amount uint256 The amount of tokens to transfer.
   */
  function _transfer(address sender, address recipient, uint256 amount) private {
    require(sender != address(0), "ERC20: transfer from the zero address");
    require(recipient != address(0), "ERC20: transfer to the zero address");

    _balances[sender] = _balances[sender].sub(amount);
    _balances[recipient] = _balances[recipient].add(amount);
    emit Transfer(sender, recipient, amount);
  }

  /**
   * @notice Private function to set the allowance for `spender` to transfer up
   * to `value` tokens on behalf of `owner`.
   * @param owner address The account that has granted the allowance.
   * @param spender address The account to grant the allowance.
   * @param value uint256 The size of the allowance to grant.
   */
  function _approve(address owner, address spender, uint256 value) private {
    require(owner != address(0), "ERC20: approve from the zero address");
    require(spender != address(0), "ERC20: approve to the zero address");

    _allowances[owner][spender] = value;
    emit Approval(owner, spender, value);
  }

  /**
   * @notice Private view function to get the latest dToken and cToken exchange
   * rates and provide the value for each.
   * @return The dToken and cToken exchange rate, as well as a boolean
   * indicating if interest accrual has been processed already or needs to be
   * calculated and placed in storage.
   */
  function _getAccruedInterest() private view returns (
    uint256 dTokenExchangeRate, uint256 cTokenExchangeRate, bool fullyAccrued
  ) {
    // Get the stored accrual block and dToken + cToken exhange rates.
    AccrualIndex memory accrualIndex = _accrualIndex;
    uint256 storedDTokenExchangeRate = uint256(accrualIndex.dTokenExchangeRate);
    uint256 storedCTokenExchangeRate = uint256(accrualIndex.cTokenExchangeRate);
    uint256 accrualBlock = uint256(accrualIndex.block);

    // Get current cToken exchange rate - inheriting contract overrides this.
    (cTokenExchangeRate,) = _getCurrentCTokenRates();

    // Only recompute dToken exchange rate if accrual has not already occurred.
    fullyAccrued = (accrualBlock == block.number);
    if (fullyAccrued) {
      dTokenExchangeRate = storedDTokenExchangeRate;
    } else {
      // Determine the cToken interest earned during the period.
      uint256 cTokenInterest = (
        (cTokenExchangeRate.mul(_SCALING_FACTOR)).div(storedCTokenExchangeRate)
      ).sub(_SCALING_FACTOR);

      // Calculate dToken exchange rate by applying 90% of the cToken interest.
      dTokenExchangeRate = storedDTokenExchangeRate.mul(
        _SCALING_FACTOR.add(cTokenInterest.mul(9) / 10)
      ) / _SCALING_FACTOR;
    }
  }

  /**
   * @notice Private view function to get the total surplus, or cToken
   * balance that exceeds the total dToken balance.
   * @return The total surplus, denominated in both the underlying and in the
   * cToken.
   */
  function _getSurplus() private view returns (
    uint256 underlyingSurplus, uint256 cTokenSurplus
  ) {
    // Instantiate the interface for the backing cToken.
    CTokenInterface cToken = CTokenInterface(_getCToken());

    (uint256 dTokenExchangeRate, uint256 cTokenExchangeRate,) = _getAccruedInterest();

    // Determine value of all issued dTokens in the underlying, rounded up.
    uint256 dTokenUnderlying = (
      _totalSupply.mul(dTokenExchangeRate) / _SCALING_FACTOR
    ).add(1);

    // Determine value of all retained cTokens in the underlying, rounded down.
    uint256 cTokenUnderlying = (
      cToken.balanceOf(address(this)).mul(cTokenExchangeRate) / _SCALING_FACTOR
    );

    // Determine the size of the surplus in terms of underlying amount.
    underlyingSurplus = cTokenUnderlying > dTokenUnderlying
      ? cTokenUnderlying - dTokenUnderlying // overflow checked above
      : 0;

    // Determine the cToken equivalent of this surplus amount.
    cTokenSurplus = underlyingSurplus == 0
      ? 0
      : (underlyingSurplus.mul(_SCALING_FACTOR)).div(cTokenExchangeRate);
  }

  /**
   * @notice Private view function to get the current dToken and cToken interest
   * supply rate per block (multiplied by 10^18).
   * @return The current dToken and cToken interest rates.
   */
  function _getRatePerBlock() private view returns (
    uint256 dTokenSupplyRate, uint256 cTokenSupplyRate
  ) {
    (, cTokenSupplyRate) = _getCurrentCTokenRates();
    dTokenSupplyRate = cTokenSupplyRate.mul(9) / 10;
  }
}