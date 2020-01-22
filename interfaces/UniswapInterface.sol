pragma solidity 0.5.11;


interface UniswapInterface {
  function ethToTokenSwapOutput(
  	uint256 tokensBought, uint256 deadline
  ) external payable returns (uint256 ethSold);

  function getEthToTokenOutputPrice(
  	uint256 tokensBought
  ) external view returns (uint256 ethSold);
}