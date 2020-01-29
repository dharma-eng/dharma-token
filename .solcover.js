module.exports = {
  skipFiles: [
    'Migrations.sol',
    'test/DharmaUpgradeBeaconController.sol',
    'test/HelperTester.sol',
    'test/NotCompound.sol',
    'test/Scenario0Helper.sol',
    'test/Scenario2Helper.sol',
    'test/Uniswapper.sol',
    'test/UpgradeBeacon.sol',
    'test/UpgradeBeaconProxy.sol'
  ],
  providerOptions: {
    fork: 'https://mainnet.infura.io/v3/4c96c6bab18845dba07ad14cc0c18998',
    default_balance_ether: 10000,
    unlockedAccounts: [
      '0xb5b06a16621616875A6C2637948bF98eA57c58fa',
      '0x8134d518e0CeF5388136c0De43d7E12278701Ac5',
      '0xddb108893104de4e1c6d0e47c42237db4e617acc',
      '0x552F355CCb9b91C8FB47D9c011AbAD5B72EC30e9',
      '0x95Ba4cF87D6723ad9C0Db21737D862bE80e93911',
      '0xA7ff0d561cd15eD525e31bbe0aF3fE34ac2059F6',
      '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
      '0x76B03EB651153a81fA1f212f2f59329B4180A46F',
      '0x035e742A7E62253C606b9028eeB65178B44F1e7E'
    ]
  }
}