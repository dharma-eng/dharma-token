pragma solidity 0.5.11;

import "../token/DharmaDaiImplementationV1.sol";


contract ManticoreTest is DharmaDaiImplementationV1 {

  function fromUnderlying(
    uint256 underlying, uint256 exchangeRate, bool roundUp
  ) external pure returns (uint256 amount) {
    amount = _fromUnderlying(underlying, exchangeRate, roundUp);
  }

}

