pragma solidity 0.5.11;


/**
 * @title DharmaTokenOverrides
 * @author 0age
 * @notice A collection of internal view and pure functions that should be
 * overridden by the ultimate Dharma Token implementation.
 */
contract DharmaTokenOverrides {
  /**
   * @notice Internal view function to get the current cToken exchange rate and
   * supply rate per block. This function is meant to be overridden by the
   * dToken that inherits this contract.
   * @return The current cToken exchange rate, or amount of underlying tokens
   * that are redeemable for each cToken, and the cToken supply rate per block
   * (with 18 decimal places added to each returned rate).
   */
  function _getCurrentCTokenRates() internal view returns (
    uint256 exchangeRate, uint256 supplyRate
  );

  /**
   * @notice Internal pure function to supply the name of the underlying token.
   * @return The name of the underlying token.
   */
  function _getUnderlyingName() internal pure returns (string memory underlyingName);

  /**
   * @notice Internal pure function to supply the address of the underlying
   * token.
   * @return The address of the underlying token.
   */
  function _getUnderlying() internal pure returns (address underlying);

  /**
   * @notice Internal pure function to supply the symbol of the backing cToken.
   * @return The symbol of the backing cToken.
   */
  function _getCTokenSymbol() internal pure returns (string memory cTokenSymbol);

  /**
   * @notice Internal pure function to supply the address of the backing cToken.
   * @return The address of the backing cToken.
   */
  function _getCToken() internal pure returns (address cToken);

  /**
   * @notice Internal pure function to supply the name of the dToken.
   * @return The name of the dToken.
   */
  function _getDTokenName() internal pure returns (string memory dTokenName);

  /**
   * @notice Internal pure function to supply the symbol of the dToken.
   * @return The symbol of the dToken.
   */
  function _getDTokenSymbol() internal pure returns (string memory dTokenSymbol);

  /**
   * @notice Internal pure function to supply the address of the vault that
   * receives surplus cTokens whenever the surplus is pulled.
   * @return The address of the vault.
   */
  function _getVault() internal pure returns (address vault);
}