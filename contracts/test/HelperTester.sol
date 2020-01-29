pragma solidity 0.5.11;

import "../token/DharmaTokenHelpers.sol";
import "./NotCompound.sol";


contract HelperTester is DharmaTokenHelpers {
  NotCompound private cToken;

  constructor() public {
    cToken = new NotCompound();
  }

  function test() external {
    bool ok;
    bytes memory data;
    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.mintTest.selector
    ));

    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.redeemTest.selector
    ));

    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.redeemUnderlyingTest.selector
    ));

    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.accrueInterestTest.selector
    ));

    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.notACompoundFunctionTest.selector
    ));

    (ok, data) = address(this).call(abi.encodeWithSelector(
      this.unsafeUint112Test.selector
    ));
  }

  function mintTest() external returns (
    bool ok, bytes memory data
  ) {
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.mint.selector, 0
    ));
    _checkCompoundInteraction(cToken.mint.selector, ok, data);
  }

  function redeemTest() external returns (
    bool ok, bytes memory data
  ) {
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.redeem.selector, 0
    ));
    _checkCompoundInteraction(cToken.redeem.selector, ok, data);
  }

  function redeemUnderlyingTest() external returns (
    bool ok, bytes memory data
  ) {
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.redeemUnderlying.selector, 0
    ));
    _checkCompoundInteraction(
      cToken.redeemUnderlying.selector, ok, data
    );
  }

  function accrueInterestTest() external returns (
    bool ok, bytes memory data
  ) {
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.accrueInterest.selector, 0
    ));
    _checkCompoundInteraction(
      cToken.accrueInterest.selector, ok, data
    );
  }

  function notACompoundFunctionTest() external returns (
    bool ok, bytes memory data
  ) {
    (ok, data) = address(cToken).call(abi.encodeWithSelector(
      cToken.notACompoundFunction.selector, 0
    ));
    _checkCompoundInteraction(
      cToken.notACompoundFunction.selector, ok, data
    );
  }

  function unsafeUint112Test() external pure returns (
    uint112 breaks
  ) {
    breaks = _safeUint112(1e76);
  }

  function _getCurrentCTokenRates() internal view returns (
    uint256, uint256
  ) {
    return (0, 0);
  }

  function _getUnderlyingName() internal pure returns (string memory) {
    return "";
  }

  function _getUnderlying() internal pure returns (address) {
    return address(0);
  }

  function _getCTokenSymbol() internal pure returns (string memory) {
    return "";
  }

  function _getCToken() internal pure returns (address) {
    return address(0);
  }

  function _getDTokenName() internal pure returns (string memory) {
    return "";
  }

  function _getDTokenSymbol() internal pure returns (string memory) {
    return "";
  }

  function _getVault() internal pure returns (address) {
    return address(0);
  }
}