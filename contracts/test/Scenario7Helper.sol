pragma solidity 0.5.11;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../interfaces/CTokenInterface.sol";
import "../../interfaces/DTokenInterface.sol";
import "../../interfaces/ERC20Interface.sol";


// Send in cTokens, receive dTokens, immediately redeem dTokens to underlying in
// the same block
contract Scenario7Helper {
  using SafeMath for uint256;

  uint256 public cTokensMinted;
  uint256 public underlyingEquivalentOfCTokensUsedToMint;
  uint256 public dTokensMinted;
  uint256 public underlyingReturnedFromDTokens;

  uint256 private constant _SCALING_FACTOR = 1e18;

  // First approve this contract to transfer underlying for the caller.
  function phaseOne(
    CTokenInterface cToken,
    DTokenInterface dToken,
    ERC20Interface underlying
  ) external {
    ERC20Interface dTokenBalance = ERC20Interface(address(dToken));

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

    // approve dToken to transfer cToken on behalf of this contract.
    require(
      cToken.approve(address(dToken), uint256(-1)),
      "dToken Approval on cToken failed."
    );

    // get the underlying balance of the caller.
    uint256 underlyingBalance = underlying.balanceOf(msg.sender);

    // ensure that it is at least 1 million.
    require(
      underlyingBalance >= 1000000,
      "Underlying balance is not at least 1 million of lowest-precision units."
    );

    // pull in underlying from caller in multiples of 1 million.
    uint256 underlyingUsedToMintCTokens = (
    underlyingBalance / 1000000
    ) * 1000000;
    require(
      underlying.transferFrom(
        msg.sender, address(this), underlyingUsedToMintCTokens
      ),
      "Underlying transfer in failed."
    );

    // mint cTokens using underlying.
    require(
      cToken.mint(underlyingUsedToMintCTokens) == 0, "cToken mint failed."
    );

    // get the number of cTokens minted.
    cTokensMinted = cToken.balanceOf(address(this));

    // get the underlying equivalent value of the minted cTokens.
    underlyingEquivalentOfCTokensUsedToMint = (
    cTokensMinted.mul(cToken.exchangeRateCurrent())
    ).div(_SCALING_FACTOR);

    // mint dTokens using cTokens.
    dTokensMinted = dToken.mintViaCToken(cTokensMinted);
    require(
      dTokensMinted == dTokenBalance.balanceOf(address(this)),
      "dTokens minted do not match returned value."
    );

    // ensure that this address doesn't have any cTokens left.
    require(
      cToken.balanceOf(address(this)) == 0,
      "cToken balance must end at 0."
    );

    // ensure that this address doesn't have any underlying tokens left.
    require(
      underlying.balanceOf(address(this)) == 0,
      "underlying balance in this contract must be 0 after minting."
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

    // ensure that this address doesn't have any underlying tokens left.
    require(
      underlying.balanceOf(address(this)) == 0,
      "underlying balance must end at 0."
    );

    // ensure that this address doesn't have any dTokens left.
    require(
      dTokenBalance.balanceOf(address(this)) == 0,
      "dToken balance must end at 0."
    );

    // ensure that underlying returned does not exceed underlying supplied.
    require(
      underlyingEquivalentOfCTokensUsedToMint >= underlyingReturnedFromDTokens,
      "Underlying received exceeds underlying equivalent cTokens supplied."
    );

    // ensure that underlying returned is at least 99.99999% of that supplied.
    require(
      (
      underlyingReturnedFromDTokens.mul(_SCALING_FACTOR)
      ).div(underlyingEquivalentOfCTokensUsedToMint) >= _SCALING_FACTOR.sub(1e11),
      "Underlying received < 99.99999% of underlying equivalent cTokens supplied."
    );
  }
}