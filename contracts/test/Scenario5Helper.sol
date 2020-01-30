pragma solidity 0.5.11;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../interfaces/CTokenInterface.sol";
import "../../interfaces/DTokenInterface.sol";
import "../../interfaces/ERC20Interface.sol";


// Send in underlying, receive dTokens, wait for t blocks, pull surplus,
// immediately redeem dTokens
contract Scenario5Helper {
  using SafeMath for uint256;

  uint256 public timeZero;
  uint256 public blockZero;
  uint256 public underlyingUsedToMintEachToken;
  uint256 public cTokensMinted;
  uint256 public dTokensMinted;
  uint256 public initialSurplus;
  uint256 public initialVaultCTokens;

  uint256 public timeOne;
  uint256 public blockOne;
  uint256 public underlyingReturnedFromCTokens;
  uint256 public underlyingReturnedFromDTokens;
  uint256 public interestEarnedFromCTokens;
  uint256 public interestEarnedFromDTokens;
  uint256 public finalSurplus;
  uint256 public cTokensSentToVault;
  uint256 public interestAccruedToSurplus;
  uint256 public finalVaultCTokens;

  uint256 private constant _SCALING_FACTOR = 1e18;

  address internal constant _VAULT = 0x7e4A8391C728fEd9069B2962699AB416628B19Fa;

  // First approve this contract to transfer underlying for the caller.
  function phaseOne(
    CTokenInterface cToken,
    DTokenInterface dToken,
    ERC20Interface underlying
  ) external {
    timeZero = now;
    blockZero = block.number;

    ERC20Interface dTokenBalance = ERC20Interface(address(dToken));

    // get the initial underlying surplus on the dToken.
    initialSurplus = dToken.getSurplusUnderlying();

    // get the initial cToken balance on the vault.
    initialVaultCTokens = cToken.balanceOf(_VAULT);

    // ensure that this address doesn't have any underlying tokens yet.
    require(
      underlying.balanceOf(address(this)) == 0,
      "underlying balance must start at 0."
    );

    // ensure that this address doesn't have any cTokens yet.
    require(
      cToken.balanceOf(address(this)) == 0,
      "cToken balance must start at 0."
    );

    // ensure that this address doesn't have any dTokens yet.
    require(
      dTokenBalance.balanceOf(address(this)) == 0,
      "dToken balance must start at 0."
    );

    // approve cToken to transfer underlying on behalf of this contract.
    require(
      underlying.approve(address(cToken), uint256(-1)), "cToken Approval failed."
    );

    // approve dToken to transfer underlying on behalf of this contract.
    require(
      underlying.approve(address(dToken), uint256(-1)), "dToken Approval failed."
    );

    // get the underlying balance of the caller.
    uint256 underlyingBalance = underlying.balanceOf(msg.sender);

    // ensure that it is at least 1 million.
    require(
      underlyingBalance >= 1000000,
      "Underlying balance is not at least 1 million of lowest-precision units."
    );

    // pull in underlying from caller in multiples of 1 million.
    uint256 balanceIn = (underlyingBalance / 1000000) * 1000000;
    require(
      underlying.transferFrom(msg.sender, address(this), balanceIn),
      "Underlying transfer in failed."
    );

    // use half of the balance in for both operations.
    underlyingUsedToMintEachToken = balanceIn / 2;

    // mint cTokens using underlying.
    require(
      cToken.mint(underlyingUsedToMintEachToken) == 0, "cToken mint failed."
    );

    // get the number of cTokens minted.
    cTokensMinted = cToken.balanceOf(address(this));

    // mint dTokens using underlying.
    dTokensMinted = dToken.mint(underlyingUsedToMintEachToken);
    require(
      dTokensMinted == dTokenBalance.balanceOf(address(this)),
      "dTokens minted do not match returned value."
    );

    // ensure that this address doesn't have any underlying tokens left.
    require(
      underlying.balanceOf(address(this)) == 0,
      "underlying balance must end at 0."
    );
  }

  function phaseTwo(
    CTokenInterface cToken,
    DTokenInterface dToken,
    ERC20Interface underlying
  ) external {
    timeOne = now;
    blockOne = block.number;

    ERC20Interface dTokenBalance = ERC20Interface(address(dToken));

    // get the final underlying surplus on the dToken.
    finalSurplus = dToken.getSurplusUnderlying();

    // pull the surplus cTokens to the vault.
    cTokensSentToVault = dToken.pullSurplus();

    // get the final cToken balance on the vault.
    finalVaultCTokens = cToken.balanceOf(_VAULT);

    // confirm that cToken balance on the vault increased by expected amount.
    require(
      cTokensSentToVault.add(initialVaultCTokens) == finalVaultCTokens,
      "Returned value of cTokens sent to vault is incorrect."
    );

    // confirm that there is no longer any cToken surplus.
    require(
      dToken.getSurplus() == 0,
      "CToken surplus is not recorded as zero on the dToken."
    );

    // confirm that the dToken contract is still sufficiently collateralized.
    require(
      (
        (cToken.balanceOf(address(dToken))).mul(cToken.exchangeRateCurrent())
      ).div(_SCALING_FACTOR) >= dToken.totalSupplyUnderlying(),
      "DToken is not sufficiently collateralized after pulling surplus."
    );

    // ensure that this address doesn't have any underlying tokens yet.
    require(
      underlying.balanceOf(address(this)) == 0,
      "underlying balance must start at 0."
    );

    // ensure that this address doesn't have any cTokens yet.
    require(
      cToken.balanceOf(address(this)) == cTokensMinted,
      "cToken balance must start at cTokensMinted."
    );

    // ensure that this address doesn't have any dTokens yet.
    require(
      dTokenBalance.balanceOf(address(this)) == dTokensMinted,
      "dToken balance must start at dTokensMinted."
    );

    // redeem cTokens for underlying.
    require(
      cToken.redeem(cTokensMinted) == 0, "cToken redeem failed."
    );

    // get balance of underlying returned.
    underlyingReturnedFromCTokens = underlying.balanceOf(address(this));

    // return the underlying balance to the caller.
    require(
      underlying.transfer(msg.sender, underlyingReturnedFromCTokens),
      "Underlying transfer out after cToken redeem failed."
    );

    // redeem dTokens for underlying.
    underlyingReturnedFromDTokens = dToken.redeem(dTokensMinted);
    require(
      underlyingReturnedFromDTokens == underlying.balanceOf(address(this)),
      "underlying redeemed from dTokens do not match returned value."
    );

    // return the underlying balance to the caller.
    require(
      underlying.transfer(msg.sender, underlyingReturnedFromDTokens),
      "Underlying transfer out after dToken redeem failed."
    );

    // confirm that the dToken contract is still sufficiently collateralized.
    require(
      (
        (cToken.balanceOf(address(dToken))).mul(cToken.exchangeRateCurrent())
      ).div(_SCALING_FACTOR) >= dToken.totalSupplyUnderlying(),
      "DToken is not sufficiently collateralized after redeeming."
    );

    // determine the appreciation of the cToken over the period (scaled up).
    interestEarnedFromCTokens = (
      underlyingReturnedFromCTokens.mul(_SCALING_FACTOR)
    ).div(underlyingUsedToMintEachToken);

    // determine the appreciation of the dToken over the period (scaled up).
    interestEarnedFromDTokens = (
      underlyingReturnedFromDTokens.mul(_SCALING_FACTOR)
    ).div(underlyingUsedToMintEachToken);

    // appreciation of dToken over period should be 90% of cToken appreciation.
    uint256 ninetyPercentOfInterestEarnedFromCTokens = ((
      (interestEarnedFromCTokens.sub(_SCALING_FACTOR)).mul(9)
    ).div(10)).add(_SCALING_FACTOR);

    // ensure that dToken appreciation does not exceed 90% of cToken's.
    require(
      ninetyPercentOfInterestEarnedFromCTokens >= interestEarnedFromDTokens,
      "Interest earned on dTokens exceeds 90% of amount earned on cTokens."
    );

    // ensure dToken appreciation is at least 99.99999% of expected amount.
    require(
      (
        interestEarnedFromDTokens.mul(_SCALING_FACTOR)
      ).div(
        ninetyPercentOfInterestEarnedFromCTokens
      ) >= _SCALING_FACTOR.sub(1e11),
      "Interest earned on dTokens is < 99.99999% of expected."
    );

    // determine difference in underlying surplus and in returned underlying.
    uint256 differenceInSurplus = finalSurplus.sub(initialSurplus);
    uint256 differenceInReturnedUnderlying = underlyingReturnedFromCTokens.sub(
      underlyingReturnedFromDTokens
    );

    // ensure surplus did not accrue faster than cToken - dToken underlying.
    require(
      differenceInReturnedUnderlying >= differenceInSurplus,
      "Surplus amount accrued faster than difference in returned underlying."
    );

    // ensure accrued surplus (if precise) is at least 99% of expected amount.
    if (differenceInSurplus > 100) {
      require(
        (
          differenceInSurplus.mul(_SCALING_FACTOR)
        ).div(differenceInReturnedUnderlying) >= _SCALING_FACTOR.sub(1e16),
        "Difference in accrued surplus is < 99% of expected amount."
      );
    } else {
      require(
        differenceInReturnedUnderlying <= 100,
        "Difference in accrued surplus deviates oddly from expected amount."
      );
    }
  }
}