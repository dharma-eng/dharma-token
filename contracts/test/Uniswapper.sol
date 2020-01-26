pragma solidity 0.5.11;

import "../../interfaces/UniswapInterface.sol";


contract Uniswapper {
  UniswapInterface public uniswap = UniswapInterface(
    0x0000000000000000000000000000000000000000
  );

  function checkSwap() public view {
    uniswap.getEthToTokenOutputPrice(0);
  }
}