pragma solidity 0.5.11;


contract NotCompound {
  function mint(uint256) external pure returns (uint256) {
    revert("This is not Compound, buddy!");
  }

  function redeem(uint256) external pure returns (uint256) {
    return 1;
  }

  function redeemUnderlying(uint256) external pure returns (uint256) {
    assembly { revert(0, 0) }
  }

  function accrueInterest() external pure returns (uint256) {
    revert("I thought I told you not to call me!");
  }

  function notACompoundFunction() external pure returns (uint256) {
    revert("For real though, this ain't gonna work...");
  }
}