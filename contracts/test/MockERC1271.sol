pragma solidity 0.5.11;

import "../../interfaces/ERC1271Interface.sol";


contract MockERC1271 {
  bool public active = true;
  bool public throwMe = false;

  function deactivate() external {
    active = false;
  }

  function superDeactivate() external {
    throwMe = true;
  }

  function isValidSignature(bytes calldata, bytes calldata) external view returns (bytes4) {
    if (!active) {
      if (throwMe) {
        revert("Nope!");
      } else {
        return bytes4(0x0b0b0b0b);
      }
    } else {
      return bytes4(0x20c13b0b);
    }
  }
}