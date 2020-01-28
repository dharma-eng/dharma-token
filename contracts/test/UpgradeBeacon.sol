pragma solidity 0.5.11;


/**
 * @title UpgradeBeacon
 * @author 0age
 * @notice Upgrade beacon for testing.
 */
contract UpgradeBeacon {
  // The implementation address is held in storage slot zero.
  address private _implementation;

  // The controller can update the implementation.
  address private _CONTROLLER;

  constructor(address controller) public {
    _CONTROLLER = controller;
  }

  /**
   * @notice In the fallback function, allow only the controller to update the
   * implementation address - for all other callers, return the current address.
   * Note that this requires inline assembly, as Solidity fallback functions do
   * not natively take arguments or return values.
   */
  function () external {
    // Return implementation address for all callers other than the controller.
    if (msg.sender != _CONTROLLER) {
      // Load implementation from storage slot zero into memory and return it.
      assembly {
        mstore(0, sload(0))
        return(0, 32)
      }
    } else {
      // Set implementation - put first word in calldata in storage slot zero.
      assembly { sstore(0, calldataload(0)) }
    }
  }
}