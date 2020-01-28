pragma solidity 0.5.11;

import "../../interfaces/CTokenInterface.sol";
import "../../interfaces/DTokenInterface.sol";
import "../../interfaces/ERC20Interface.sol";


contract Scenario0Helper {
  uint256 public timeZero;
  uint256 public blockZero;
  uint256 public underlyingUsedToMintEachToken;
  uint256 public cTokensMinted;
  uint256 public dTokensMinted;

  uint256 public timeOne;
  uint256 public blockOne;
  uint256 public underlyingReturnedFromCTokens;
  uint256 public underlyingReturnedFromDTokens;

  // First approve this contract to transfer underlying for the caller.
  function phaseOne(
  	CTokenInterface cToken,
  	DTokenInterface dToken,
  	ERC20Interface underlying
  ) external {
  	timeZero = now;
  	blockZero = block.number;

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
  	  underlyingReturnedFromDTokens == dTokenBalance.balanceOf(address(this)),
  	  "underlying redeemed from dTokens do not match returned value."
  	);

    // return the underlying balance to the caller.
  	require(
  	  underlying.transfer(msg.sender, underlyingReturnedFromDTokens),
  	  "Underlying transfer out after dToken redeem failed."
  	);
  }
}