# Dharma Token (dharma-token)

![HeaderImg](https://i.ibb.co/bHQ9VCX/d-Tokens-Git-Hub.png)

> Implementation and testing for core Dharma Token (dToken) contracts, including Dharma Dai and Dharma USD Coin.

[![Dharma Dai Version](https://img.shields.io/badge/Dharma%20Dai%20Version-1-orange)](https://etherscan.io/address/0x00000000001876eB1444c986fD502e618c587430#readProxyContract)
[![Dharma USD Coin Version](https://img.shields.io/badge/Dharma%20USD%20Coin%20Version-1-blue)](https://etherscan.io/address/0x00000000008943c65cAf789FFFCF953bE156f6f8#readProxyContract)
[![License](https://img.shields.io/github/license/dharma-eng/dharma-token.svg)](https://github.com/dharma-eng/dharma-token/blob/master/LICENSE.md)
[![Dharma Token CI](https://github.com/dharma-eng/dharma-token/workflows/Dharma%20Token%20CI/badge.svg?branch=master)](https://github.com/dharma-eng/dharma-token/actions?query=workflow%3A%22Dharma+Token+CI%22)
[![Coverage](https://img.shields.io/coveralls/github/dharma-eng/dharma-token)](https://coveralls.io/github/dharma-eng/dharma-token)
[![Community](https://img.shields.io/badge/community-Discord-blueviolet)](https://discordapp.com/invite/qvKTDgR)

## Summary

A **Dharma Token** (or dToken) is an upgradeable ERC20 token with support for meta-transactions that earns interest with respect to a given stablecoin, and is backed by that stablecoin's respective Compound cToken. Interacting with dTokens using the underlying stablecoin is similar to interacting with cTokens, sans borrowing mechanics. In addition, dTokens can be minted and redeemed using the backing cTokens directly.

Interest on dTokens can be accrued at any point, but is automatically accrued whenever new tokens are minted or redeemed, when transfers denominated in underlying tokens are performed, or when the surplus (or excess backing cTokens) is pulled. On accrual, the new exchange rate of the backing cToken is calculated and the dToken exchange rate increases by 9/10ths of the amount of that of the cToken - in other words, the exchange rate of a dToken appreciates at 90% the rate of that of its backing cToken.

Two Dharma Tokens are currently deployed to mainnet: [Dharma Dai](https://etherscan.io/token/0x00000000001876eb1444c986fd502e618c587430) (dDai) and [Dharma USD Coin](https://etherscan.io/token/0x00000000008943c65caf789fffcf953be156f6f8) (dUSDC).

These contracts were reviewed by Trail of Bits for four days in January 2020, including a general security review, a deeper review of internal math and accounting, and a review of meta-transaction functionality. Their findings and recommendations were immediately incorporated into the code, and Manticore test cases were developed and are included in this repository. No audit report is currently available.

## Table of Contents

- [Contract Deployment Addresses and Verified Source Code](#contract-deployment-addresses-and-verified-source-code)
- [Overview](#overview)
- [Install](#install)
- [Usage](#usage)
- [Notable Transactions](#notable-transactions)
- [Additional Information](#additional-information)

## Contract Deployment Addresses and Verified Source Code

### Dharma Dai

- [Dharma Dai](https://etherscan.io/address/0x00000000001876eB1444c986fD502e618c587430#readProxyContract)
- [Dharma Dai Upgrade Beacon](https://etherscan.io/address/0x0000000000ccCf289727C20269911159a7bf9eBd#code)
- [Dharma Dai Upgrade Beacon Controller](https://etherscan.io/address/0x00000000001E980d286bE7f5f978f4Cc33128202#code)
- [Dharma Dai Initializer Implementation](https://etherscan.io/address/0x772954310D202A92519F14db92623D5eDe78164c#code)
- [Dharma Dai Implementation V1](https://etherscan.io/address/0x00000000580090B7b5B593AB408000b1AbB5f78d#code)

### Dharma USD Coin

- [Dharma USD Coin](https://etherscan.io/address/0x00000000008943c65cAf789FFFCF953bE156f6f8#readProxyContract)
- [Dharma USD Coin Upgrade Beacon](https://etherscan.io/address/0x00000000000274bE4365Aa18CfDC9A22A947f67D)
- [Dharma USD Coin Upgrade Beacon Controller](https://etherscan.io/address/0x0000000000796dC3aA12EB9FE3B6e8F4D92cc966#code)
- [Dharma USD Coin Initializer Implementation](https://etherscan.io/address/0xa3262589b86cA2C847132fbD470EeB9387899D2b#code)
- [Dharma USD Coin Implementation V1](https://etherscan.io/address/0x00000000de26576A3700bb87d61BFbEE335C8b56#code)

## Overview

Interaction with Dharma Dai and Dharma USD Coin will mostly be mediated by the [Dharma Smart Wallet](https://github.com/dharma-eng/dharma-smart-wallet) - to interact with either one directly, use the ABI for the current implementation along with the address of the respective token.

The complete dToken interface, including ERC20 methods, is as follows:

```Solidity
interface DTokenInterface {
  // Events bear similarity to Compound's supply-related events.
  event Mint(address minter, uint256 mintAmount, uint256 mintDTokens);
  event Redeem(address redeemer, uint256 redeemAmount, uint256 redeemDTokens);
  event Accrue(uint256 dTokenExchangeRate, uint256 cTokenExchangeRate);
  event CollectSurplus(uint256 surplusAmount, uint256 surplusCTokens);

  // These external functions trigger accrual on the dToken and backing cToken.
  function mint(uint256 underlyingToSupply) external returns (uint256 dTokensMinted);
  function redeem(uint256 dTokensToBurn) external returns (uint256 underlyingReceived);
  function redeemUnderlying(uint256 underlyingToReceive) external returns (uint256 dTokensBurned);
  function pullSurplus() external returns (uint256 cTokenSurplus);

  // These external functions only trigger accrual on the dToken.
  function mintViaCToken(uint256 cTokensToSupply) external returns (uint256 dTokensMinted);
  function redeemToCToken(uint256 dTokensToBurn) external returns (uint256 cTokensReceived);
  function redeemUnderlyingToCToken(uint256 underlyingToReceive) external returns (uint256 dTokensBurned);
  function accrueInterest() external;
  function transferUnderlying(address recipient, uint256 underlyingEquivalentAmount) external returns (bool success);
  function transferUnderlyingFrom(address sender, address recipient, uint256 underlyingEquivalentAmount) external returns (bool success);

  // This function provides basic meta-tx support and does not trigger accrual.
  function modifyAllowanceViaMetaTransaction(
    address owner,
    address spender,
    uint256 value,
    bool increase,
    uint256 expiration,
    bytes32 salt,
    bytes calldata signatures
  ) external returns (bool success);

  // View and pure functions do not trigger accrual on the dToken or the cToken.
  function getMetaTransactionMessageHash(
    bytes4 functionSelector, bytes calldata arguments, uint256 expiration, bytes32 salt
  ) external view returns (bytes32 digest, bool valid);
  function totalSupplyUnderlying() external view returns (uint256);
  function balanceOfUnderlying(address account) external view returns (uint256 underlyingBalance);
  function exchangeRateCurrent() external view returns (uint256 dTokenExchangeRate);
  function supplyRatePerBlock() external view returns (uint256 dTokenInterestRate);
  function accrualBlockNumber() external view returns (uint256 blockNumber);
  function getSurplus() external view returns (uint256 cTokenSurplus);
  function getSurplusUnderlying() external view returns (uint256 underlyingSurplus);
  function getSpreadPerBlock() external view returns (uint256 rateSpread);
  function getVersion() external pure returns (uint256 version);
  function getCToken() external pure returns (address cToken);
  function getUnderlying() external pure returns (address underlying);

  // ERC20 events and methods (these do not trigger accrual).
  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  function transfer(address recipient, uint256 amount) external returns (bool);
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

  function totalSupply() external view returns (uint256);
  function balanceOf(address account) external view returns (uint256);
  function allowance(address owner, address spender) external view returns (uint256);
}
```

### Minting

There are two methods to mint new dTokens:

- `mint(uint256 underlyingToSupply)` will transfer the specified amount of underlying from the caller to the dToken, which requires that sufficient allowance first be set by calling `approve` on the underlying and supplying the dToken as the spender, or by using `permit` if applicable. The underlying will be used to mint the backing cTokens, and dTokens will be given to the caller in proportion to the current exchange rate.
- `mintViaCToken(uint256 cTokensToSupply)` will transfer the specified amount of _cTokens_ from the caller to the dToken, which requires that sufficient allowance first be set by calling `approve` on the cToken and supplying the dToken as the spender. The cTokens will be retained as backing collateral, and dTokens will be given to the caller in proportion to the current exchange rate.

Whenever calling `mint`, interest accrual will be performed on both the cToken _and_ the dToken - this operation adds quite a bit of additional overhead (and even more so on Dharma Dai, since cDai itself interacts with the Dai Savings Rate contract family). In contrast, calling `mintViaCToken` only accrues interest on the dToken, and simply calculates what the cToken exchange rate _would_ be if accrual was to be performed at that time. This, along with the avoidance of needing to mint new cTokens, results in significant gas savings over `mint`.

### Redeeming

There are four methods to redeem existing dTokens:

- `redeem(uint256 dTokensToBurn)` will take the specified amount of dTokens from the caller, then transfer underlying to them in proportion to the current exchange rate.
- `redeemUnderlying(uint256 underlyingToReceive)` is equivalent to `redeem`, except that the _underlying received_ is passed as the argument instead of the dTokens burned. Note that this method should not be used to "redeem all", since the dTokens will likely appreciate in value between the time the underlying equivalent is supplied and the time the transaction is mined.
- `redeemToCToken(uint256 dTokensToBurn)` will take the specified amount of dTokens from the caller, then transfer _cTokens_ to them in proportion to the current exchange rate.
- `redeemUnderlyingToCToken(uint256 underlyingToReceive)` is equivalent to `redeemToCToken`, except that the _underlying received_ is passed as the argument instead of the dTokens burned. Same caveat applies as in `redeemUnderlying`.

Interest accrual is performed on the both the cToken _and_ the dToken when calling `redeem` or `redeemUnderlying`, but only on the dToken when calling `redeemToCToken` or `redeemUnderlyingToCToken`. In general, the direct dToken arguments are also slightly more efficient, both in gas usage and in avoidance of rounding errors when redeeming very small amounts.

### Transferring

There are a handful of different approaches to transferring dTokens:

- `transfer(address recipient, uint256 amount)` will simply send dTokens from the caller to the recipient.
- `approve(address spender, uint256 amount)` followed by `transferFrom(address sender, address recipient, uint256 amount)` will allow the caller to designate a "sender" which will then be able to send dTokens on their behalf.
- `transferUnderlying(address recipient, uint256 underlyingEquivalentAmount)` is equivalent to `transfer`, except that the _underlying equivalent value to transfer_ is passed as the argument, and the amount of dTokens to transfer will be determined using the current exchange rate. Note that the amount of dTokens transferred will be rounded up, meaning that _slightly more_ than the specified underlying equivalent value may be transferred.
- `approve(address spender, uint256 amount)` followed by `transferUnderlyingFrom(address sender, address recipient, uint256 underlyingEquivalentAmount)` is equivalent to `transferFrom`, except that the _underlying equivalent value to transfer_ is passed as the argument. Note that the argument to `approve` still needs to be denominated in dTokens.

In addition to the standard ERC20 `approve` (which is susceptible to a well-known race condition), allowance can be modified via `increaseAllowance`, `decreaseAllowance`, and `modifyAllowanceViaMetaTransaction`.

### Meta-transactions

In order to provide basic meta-transaction support, dToken allowances can be set by providing signatures that are then supplied by arbitrary callers as part of calls to `modifyAllowanceViaMetaTransaction(address owner, address spender, uint256 value, bool increase, uint256 expiration, bytes32 salt, bytes calldata signatures)`, either to _increase_ allowance (when `increase = true`) or to _decrease_ allowance (when `increase = false`) The `getMetaTransactionMessageHash(bytes4 functionSelector, bytes calldata arguments, uint256 expiration, bytes32 salt)` view function can be used to get the message hash that needs to be signed (as a "personal message") in order to generate the signature, with function selector `0x2d657fa5` and arguments `abi.encode(owner, spender, value, increase)` for `modifyAllowanceViaMetaTransaction`.

These meta-transactions are **unordered**, meaning that they are based on a unique message hash rather than on an incrementing nonce per account. This hash is generated from the dToken address, the caller, the function called, and the arguments to the function, including an optional expiration and an arbitrary salt value. Once a specific set of arguments has been used, it cannot be used again. (The Dharma Smart Wallet implements meta-transactions using an incrementing nonce, and is used in place of the native dToken meta-transactions when strict transaction ordering is preferred.)

> **IMPORTANT NOTE**: meta-transactions can be front-run by a griefer in an attempt to disrupt conditional logic on the caller that is predicated on success of the call - to protect against this, calling contracts can perform an allowance check against `allowance` or a message hash validity check against `getMetaTransactionMessageHash` prior to performing the call, or can catch reverts originating from the call and perform either of these two checks on failure.

They also utilize ERC-1271 in cases where the owner is a contract address - this means that the dToken will call into a `isValidSignature(bytes calldata data, bytes calldata signatures)` view function on the contract at the owner account, and that contract will then determine whether or not to allow the meta-transaction to proceed or not. The `data` parameter is comprised of a 32-byte hash digest, followed by a "context" bytes array that contains the arguments used to generate the hash digest (to be precise, the context is hashed to generate the "message hash", then that message hash is prefixed according to EIP-191 0x45, or eth*Sign, and hashed again to generate the hash digest). In cases where the owner is \_not* a contract address (i.e. there is no runtime code at the account), `ecrecover` will be used instead.

> **IMPORTANT NOTE**: dTokens can be stolen from contracts that implement ERC-1271 in an insecure fashion - do not return the ERC-1271 magic value from an `isValidSignature` call on your contract unless you're sure that you've properly implemented your desired signature validation scheme!

### View functions

Dharma Tokens have a whole host of view functions and pure functions - many are direct analogues of the equivalents on Compound (though they are all _actually_ view functions) and are mostly self-explanatory. That being said, it is important to note that `exchangeRateCurrent`, `supplyRatePerBlock`, and `getSpreadPerBlock` all return values that have been "scaled up" by `10^18`, meaning the returned values should be _divided_ by that scaling factor in order to derive the actual value.

## Install

To install locally, you'll need Node.js 10 through 12 and Yarn _(or npm)_. To get everything set up:

```sh
$ git clone https://github.com/dharma-eng/dharma-token.git
$ cd dharma-token
$ yarn install
$ yarn build
```

## Usage

Tests are performed against a fork of the latest block on mainnet. To run, start the testRPC, trigger the tests, run the linter, and tear down the testRPC _(you can do all of this at once via_ `yarn all` _if you prefer)_:

```sh
$ yarn start
$ yarn test
$ yarn lint
$ yarn stop
```

You can also run code coverage if you like:

```sh
$ yarn build
$ yarn coverage
```

To run Manticore tests, follow the [installation instructions](https://github.com/trailofbits/manticore#installation) (note that Manticore is only officially supported on Linux) and run:

```sh
$ yarn manticoreTest
```

## Notable Transactions

- [Dharma Dai Deployment](https://etherscan.io/tx/0x5bd46bdeaa043f824355a11a57b6cde8a5c00892e09f55306a0b42e7d15ff551)
- [Dharma USD Coin Deployment](https://etherscan.io/tx/0x57a01b82011228bb8283e0e6a1dce8e34178fc4bf1fafc856324eaa8166c844a)
- [Dharma Dai upgraded to DharmaDaiInitializer](https://etherscan.io/tx/0x31551ab3c5b3119528565aab111eb0b1672bbfd7e90d72fc25a2fddd9305cdd6#eventlog)
- [Dharma USD Coin upgraded to DharmaUSDCInitializer](https://etherscan.io/tx/0xc12ff9e44cd86fc5d6be957901532a6c6da8f7ac5a6625daff6bfe98202c927a#eventlog)
- [Dharma Dai initialized](https://etherscan.io/tx/0x23147b9d2189884f29780141295b911f8d9203764b7ffe131b15c2e130aebd26)
- [Dharma USD Coin initialized](https://etherscan.io/tx/0x1004aa5aa1cfe841583f865fd648aea60e903a14f3493eaadfcfbc077765db76)
- [Dharma Dai upgraded to DharmaDaiImplementationV1](https://etherscan.io/tx/0xbd05feea7836504e79c0f7b3eda12800f96f88bfa18fbb4605bf8bfacf188ff2#eventlog)
- [Dharma USD Coin upgraded to DharmaUSDCImplementationV1](https://etherscan.io/tx/0xb8ad3fbf423e3b213c2bf6fd0952063a0bb5b8dcccba7ce18d1748dac5ee835c#eventlog)
- [First Dharma Dai minted](https://etherscan.io/tx/0x449a91152f4aee8886b0b0395188244e6f7cdf84e35256d537ab0095621f56f8)
- [First Dharma USD Coin minted](https://etherscan.io/tx/0xaeb18f014a93be51ce23a1d9a6677943423a842fa6c5685b298bd0d384da48d0)

## Additional Information

This repository is maintained by @0age and @carlosflrs.

Have any questions or feedback? Join the conversation in the <a href="https://discordapp.com/invite/qvKTDgR" target="_blank">Dharma_HQ Discord server</a>.
