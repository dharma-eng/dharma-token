const assert = require("assert");
const { Tester, longer } = require("./test");
const constants = require("./constants.js");

let contractNames = constants.CONTRACT_NAMES;

const tokenSymbols = {
  "Dharma Dai": "dDai",
  "Dharma USD Coin": "dUSDC"
};

const underlyingSymbols = {
  "Dharma Dai": "Dai",
  "Dharma USD Coin": "USDC"
};

const underlyingDecimals = {
  "Dharma Dai": 18,
  "Dharma USD Coin": 6
};

const cTokenSymbols = {
  "Dharma Dai": "cDai",
  "Dharma USD Coin": "cUSDC"
};

const DTokenDecimals = 8;

const validateCTokenInterestAccrualEvents = (
  parsedEvents,
  eventIndex,
  cTokenSymbol
) => {
  if (cTokenSymbol === "cDai") {
    // 'suck' on Vat, 'drip' on Pot, 'accrueInterest' on cDai
    const events = parsedEvents.slice(eventIndex, eventIndex + 3);
    assert.strictEqual(events.length, 3);

    assert.strictEqual(events[0].address, "MKR-VAT");
    assert.strictEqual(events[0].returnValues.caller, "MKR-VOW");

    assert.strictEqual(events[1].address, "MKR-POT");
    assert.strictEqual(events[1].returnValues.caller, "CDAI");

    assert.strictEqual(events[2].address, "CDAI");
    assert.strictEqual(events[2].eventName, "AccrueInterest");
  } else {
    // just 'accrueInterest' on cUSDC
    const events = parsedEvents.slice(eventIndex, eventIndex + 1);
    assert.strictEqual(events.length, 1);

    assert.strictEqual(events[0].address, "CUSDC");
    assert.strictEqual(events[0].eventName, "AccrueInterest");
  }
};

const validateDTokenAccrueEvent = (
  parsedEvents,
  eventIndex,
  contractName,
  web3,
  tester,
  storedDTokenExchangeRate,
  storedCTokenExchangeRate
) => {
  const accrueEvent = parsedEvents[eventIndex];
  assert.strictEqual(
    accrueEvent.address,
    tokenSymbols[contractName].toUpperCase()
  );
  assert.strictEqual(accrueEvent.eventName, "Accrue");
  dTokenExchangeRate = web3.utils.toBN(
    accrueEvent.returnValues.dTokenExchangeRate
  );
  cTokenExchangeRate = web3.utils.toBN(
    accrueEvent.returnValues.cTokenExchangeRate
  );

  cTokenInterest = cTokenExchangeRate
    .mul(tester.SCALING_FACTOR)
    .div(storedCTokenExchangeRate)
    .sub(tester.SCALING_FACTOR);

  dTokenInterest = cTokenInterest.mul(tester.NINE).div(tester.TEN);

  calculatedDTokenExchangeRate = storedDTokenExchangeRate
    .mul(tester.SCALING_FACTOR.add(dTokenInterest))
    .div(tester.SCALING_FACTOR);

  assert.strictEqual(
    dTokenExchangeRate.toString(),
    calculatedDTokenExchangeRate.toString()
  );

  return [dTokenExchangeRate, cTokenExchangeRate];
};

const prepareToValidateAccrual = async (web3, dToken, skipBlock = false) => {
  const slotZero = await web3.eth.getStorageAt(dToken.options.address, 0);
  const slotRaw = slotZero.slice(2).padStart(64, "0");

  // dToken ExchangeRate "checkpoint" is stored at the end of slot zero.
  const storedDTokenExchangeRate = web3.utils.toBN(
    "0x" + slotRaw.slice(36, 64)
  );

  // cToken ExchangeRate "checkpoint" is stored in the middle of slot zero.
  const storedCTokenExchangeRate = web3.utils.toBN("0x" + slotRaw.slice(8, 36));

  let blockNumber = null;
  if (!skipBlock) {
    blockNumber = (await web3.eth.getBlock("latest")).number;
  }

  // last accrual block is stored at the start of slot zero.
  const lastAccrualBlock = parseInt(
    web3.utils.toBN(slotZero.slice(0, 8)).toString(),
    10
  );

  return [
    storedDTokenExchangeRate,
    storedCTokenExchangeRate,
    blockNumber,
    lastAccrualBlock
  ];
};

async function runAllTests(web3, context, contractName, contract) {
  let storedDTokenExchangeRate;
  let storedCTokenExchangeRate;
  let blockNumber;

  const tester = new Tester(web3, context);
  await tester.init();

  const DTokenImplementation = await getOrDeployDTokenContract(
    contract,
    tester,
    contractName
  );

  const {
    options: { address: dTokenImplementationAddress }
  } = DTokenImplementation;

  const InitializerDeployer =
    contractName === "Dharma Dai"
      ? tester.DharmaDaiInitializerDeployer
      : tester.DharmaUSDCInitializerDeployer;

  const DTokenInitializerImplementation = await tester.runTest(
    `Initializer implementation contract deployment for ${contractName}`,
    InitializerDeployer,
    "",
    "deploy"
  );

  const UpgradeBeaconController = await tester.runTest(
    `Mock UpgradeBeaconController contract deployment for ${contractName}`,
    tester.UpgradeBeaconControllerDeployer,
    "",
    "deploy"
  );

  const UpgradeBeacon = await tester.runTest(
    `Mock UpgradeBeacon contract deployment for ${contractName}`,
    tester.UpgradeBeaconDeployer,
    "",
    "deploy",
    [UpgradeBeaconController.options.address]
  );

  const UpgradeBeaconProxy = await tester.runTest(
    `Mock UpgradeBeaconProxy contract deployment for ${contractName}`,
    tester.UpgradeBeaconProxyDeployer,
    "",
    "deploy",
    [UpgradeBeacon.options.address]
  );

  await tester.runTest(
    `Set ${contractName} initializer implementation`,
    UpgradeBeaconController,
    "upgrade",
    "send",
    [
      UpgradeBeacon.options.address,
      DTokenInitializerImplementation.options.address
    ]
  );

  const DTokenInitializer = new web3.eth.Contract(
    DTokenInitializerImplementation.options.jsonInterface,
    UpgradeBeaconProxy.options.address
  );

  await tester.runTest(
    `Initialize ${contractName}`,
    DTokenInitializer,
    "initialize",
    "send",
    [],
    true,
    receipt => {
      // TODO: validate events
    }
  );

  const initialExchangeRates = getExchangeRates(web3);

  let dTokenExchangeRate = initialExchangeRates[contractName];

  [storedDTokenExchangeRate] = await prepareToValidateAccrual(
    web3,
    DTokenInitializer
  );
  assert.strictEqual(
    storedDTokenExchangeRate.toString(),
    dTokenExchangeRate.rate.toString()
  );

  await tester.runTest(
    `Set ${contractName} implementation V0`,
    UpgradeBeaconController,
    "upgrade",
    "send",
    [UpgradeBeacon.options.address, dTokenImplementationAddress]
  );

  const DToken = new web3.eth.Contract(
    DTokenImplementation.options.jsonInterface,
    UpgradeBeaconProxy.options.address
  );

  const CToken = contractName === "Dharma Dai" ? tester.CDAI : tester.CUSDC;

  const Underlying = contractName === "Dharma Dai" ? tester.DAI : tester.USDC;

  const Uniswap =
    contractName === "Dharma Dai" ? tester.UNISWAP_DAI : tester.UNISWAP_USDC;

  const {
    options: { address: dTokenAddress }
  } = DToken;

  contractNames = Object.assign(contractNames, {
    [dTokenAddress]: contractName === "Dharma Dai" ? "DDAI" : "DUSDC"
  });

  async function testPureFunctions() {
    await tester.runTest(
      `${contractName} gets the initial version correctly`,
      DToken,
      "getVersion",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, "1");
      }
    );

    await tester.runTest(
      `${contractName} gets name correctly`,
      DToken,
      "name",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, contractName);
      }
    );

    await tester.runTest(
      `${contractName} gets symbol correctly`,
      DToken,
      "symbol",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, tokenSymbols[contractName]);
      }
    );

    await tester.runTest(
      `${contractName} gets decimals correctly`,
      DToken,
      "decimals",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, DTokenDecimals.toString());
      }
    );

    await tester.runTest(
      `${contractName} gets cToken address correctly`,
      DToken,
      "getCToken",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, CToken.options.address);
      }
    );

    await tester.runTest(
      `${contractName} gets underlying address correctly`,
      DToken,
      "getUnderlying",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, Underlying.options.address);
      }
    );
  }

  async function testAccrueInterest() {
    await tester.runTest(
      `Accrue ${cTokenSymbols[contractName]} interest`,
      CToken,
      "accrueInterest",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );
      }
    );
  }

  async function testSupplyRatePerBlock() {
    let cTokenSupplyRate;
    await tester.runTest(
      `${cTokenSymbols[contractName]} supply rate can be retrieved`,
      CToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        cTokenSupplyRate = web3.utils.toBN(value);
      }
    );

    let dTokenSupplyRate = cTokenSupplyRate.mul(tester.NINE).div(tester.TEN);
    await tester.runTest(
      `${contractName} supply rate starts at 90% of ${
        cTokenSymbols[contractName]
      } supply rate`,
      DToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, dTokenSupplyRate.toString());
      }
    );
  }

  async function testExchangeRate() {
    let cTokenExchangeRate;
    await tester.runTest(
      `${cTokenSymbols[contractName]} exchange rate can be retrieved`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        cTokenExchangeRate = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${contractName} exchange rate can be retrieved`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        dTokenExchangeRate = web3.utils.toBN(value);
      }
    );
  }

  async function testAccrueInterestFromAnyAccount() {
    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    let cTokenSupplyRate;
    await tester.runTest(
      `${cTokenSymbols[contractName]} supply rate can be retrieved`,
      CToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        cTokenSupplyRate = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${contractName} accrueInterest can be triggered correctly from any account`,
      DToken,
      "accrueInterest",
      "send",
      [],
      true,
      receipt => {
        assert.strictEqual(receipt.blockNumber, blockNumber + 1);
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 1);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );
      },
      tester.originalAddress
    );

    await tester.runTest(
      `${contractName} exchange rate is updated correctly`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, dTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${contractName} supply rate is updated after an accrual`,
      DToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        dTokenSupplyRate = value;
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} exchange rate is updated correctly`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, cTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} supply rate is unchanged after ${
        tokenSymbols[contractName]
      } accrual (as it did not accrue)`,
      CToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, cTokenSupplyRate.toString());
      }
    );
  }

  async function testPullSurplusBeforeMints() {
    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    await tester.runTest(
      `${contractName} can pull surplus of 0 before any tokens are minted`,
      DToken,
      "pullSurplus",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        const extraEvents = contractName === "Dharma Dai" ? 2 : 0;

        assert.strictEqual(events.length, 4 + extraEvents);

        const transferEvent = events[2 + extraEvents];
        const collectSurplusEvent = events[3 + extraEvents];

        // Ensure that cToken accrual is performed correctly
        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );

        // Ensure that dToken accrual is performed correctly
        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          1 + extraEvents,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        // Ensure that cToken transfer of 0 tokens is performed correctly
        assert.strictEqual(
          transferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(transferEvent.eventName, "Transfer");
        assert.strictEqual(
          transferEvent.returnValues.from,
          DToken.options.address
        );
        assert.strictEqual(
          transferEvent.returnValues.to,
          constants.VAULT_MAINNET_ADDRESS
        );
        assert.strictEqual(transferEvent.returnValues.value, "0");

        // Ensure that CollectSurplus of 0, 0 is performed correctly
        assert.strictEqual(
          collectSurplusEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(collectSurplusEvent.eventName, "CollectSurplus");
        assert.strictEqual(collectSurplusEvent.returnValues.surplusAmount, "0");
        assert.strictEqual(
          collectSurplusEvent.returnValues.surplusCTokens,
          "0"
        );
      }
    );
  }

  async function getUnderlyingTokens() {
    // Get some underlying tokens from Uniswap
    let priceOfOneHundredUnderlying;
    await tester.runTest(
      `Get the price of 100 ${underlyingSymbols[contractName]} from Uniswap`,
      Uniswap,
      "getEthToTokenOutputPrice",
      "call",
      ["1".padEnd(underlyingDecimals[contractName] + 3, "0")],
      true,
      value => {
        priceOfOneHundredUnderlying = value;
      }
    );

    await tester.runTest(
      `Get 100 ${underlyingSymbols[contractName]} from Uniswap`,
      Uniswap,
      "ethToTokenSwapOutput",
      "send",
      ["1".padEnd(underlyingDecimals[contractName] + 3, "0"), "9999999999"],
      true,
      receipt => {},
      tester.address,
      priceOfOneHundredUnderlying
    );

    await tester.runTest(
      `Check that we now have 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );
  }

  async function testCannotMintBeforeApproval() {
    await tester.runTest(
      `${contractName} cannot mint dTokens without prior approval`,
      DToken,
      "mint",
      "send",
      ["1".padEnd(underlyingDecimals[contractName] + 1, "0")],
      false
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [DToken.options.address, constants.FULL_APPROVAL]
    );
  }

  async function testMint() {
    let totalDTokensMinted;

    await tester.runTest(
      `${tokenSymbols[contractName]} total supply is 0 before mint`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.runTest(
      `${tokenSymbols[contractName]} total underlying supply is 0 before mint`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const underlyingToSupply = web3.utils.toBN(
      "1".padEnd(underlyingDecimals[contractName] + 2, "0")
    );

    await tester.runTest(
      `${contractName} can mint dTokens`,
      DToken,
      "mint",
      "send",
      [underlyingToSupply.toString()],
      true,
      receipt => {
        const extraEvents = contractName === "Dharma Dai" ? 7 : 0;

        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 8 + extraEvents);

        // important events - validate in full after the ancillary ones
        const underlyingTransferInEvent = events[0];
        // note: cUSDC & cDai emit transfer / mint events in opposite order
        const cTokenMintEvent = events[3 + extraEvents];
        const cTokenTransferEvent = events[4 + extraEvents];
        const dTokenAccrueEvent = events[5 + extraEvents];
        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          5 + extraEvents,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const dTokenMintEvent = events[6 + extraEvents];
        const dTokenTransferEvent = events[7 + extraEvents];

        validateCTokenInterestAccrualEvents(
          events,
          1,
          cTokenSymbols[contractName]
        );

        // ancillary events - partial validation ok (mostly cDai-specific)
        if (contractName === "Dharma Dai") {
          // (transfer from dDai to DSR)
          assert.strictEqual(events[4].address, "DAI");
          assert.strictEqual(events[4].eventName, "Transfer");
          assert.strictEqual(
            events[4].returnValues.from,
            DToken.options.address
          );
          // to -> Dai Join
          assert.strictEqual(
            events[4].returnValues.value,
            "1".padEnd(underlyingDecimals[contractName] + 2, "0")
          );

          assert.strictEqual(events[5].address, "MKR-VAT");
          assert.strictEqual(events[5].returnValues.caller, "MKR-DAI-JOIN");

          // (burned by DSR)
          assert.strictEqual(events[6].address, "DAI");
          assert.strictEqual(events[6].eventName, "Transfer");
          assert.strictEqual(events[6].returnValues.to, constants.NULL_ADDRESS);
          assert.strictEqual(
            events[6].returnValues.value,
            "1".padEnd(underlyingDecimals[contractName] + 2, "0")
          );

          assert.strictEqual(events[7].address, "MKR-DAI-JOIN");
          assert.strictEqual(events[7].returnValues.caller, "CDAI");

          assert.strictEqual(events[8].address, "MKR-VAT");
          assert.strictEqual(events[8].returnValues.caller, "CDAI");

          assert.strictEqual(events[9].address, "MKR-POT");
          assert.strictEqual(events[9].returnValues.caller, "CDAI");
        } else {
          // (transfer from dUSDC to cUSDC)
          assert.strictEqual(events[2].address, "USDC");
          assert.strictEqual(events[2].eventName, "Transfer");
          assert.strictEqual(
            events[2].returnValues.from,
            DToken.options.address
          );
          assert.strictEqual(events[2].returnValues.to, CToken.options.address);
          assert.strictEqual(
            events[2].returnValues.value,
            "1".padEnd(underlyingDecimals[contractName] + 2, "0")
          );
        }

        // Validate initial transfer in to dToken of 10 underlying
        assert.strictEqual(
          underlyingTransferInEvent.address,
          underlyingSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(underlyingTransferInEvent.eventName, "Transfer");
        assert.strictEqual(
          underlyingTransferInEvent.returnValues.from,
          tester.address
        );
        assert.strictEqual(
          underlyingTransferInEvent.returnValues.to,
          DToken.options.address
        );
        assert.strictEqual(
          underlyingTransferInEvent.returnValues.value,
          "1".padEnd(underlyingDecimals[contractName] + 2, "0")
        );

        // Validate cToken mint to dToken
        assert.strictEqual(
          cTokenMintEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenMintEvent.eventName, "Mint");
        assert.strictEqual(
          cTokenMintEvent.returnValues.minter,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenMintEvent.returnValues.mintTokens,
          "1".padEnd(underlyingDecimals[contractName] + 2, "0")
        );
        // note: mint amount is checked after parsing dToken accrual event

        // Validate cToken transfer to dToken
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          cTokenTransferEvent.returnValues.from,
          CToken.options.address
        );
        assert.strictEqual(
          cTokenTransferEvent.returnValues.to,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenTransferEvent.returnValues.value,
          cTokenMintEvent.returnValues.mintAmount
        );

        // Validate dToken accrue event
        assert.strictEqual(
          dTokenAccrueEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenAccrueEvent.eventName, "Accrue");
        dTokenExchangeRate = web3.utils.toBN(
          dTokenAccrueEvent.returnValues.dTokenExchangeRate
        );
        cTokenExchangeRate = web3.utils.toBN(
          dTokenAccrueEvent.returnValues.cTokenExchangeRate
        );

        cTokenInterest = cTokenExchangeRate
          .mul(tester.SCALING_FACTOR)
          .div(storedCTokenExchangeRate)
          .sub(tester.SCALING_FACTOR);

        dTokenInterest = cTokenInterest.mul(tester.NINE).div(tester.TEN);

        calculatedDTokenExchangeRate = storedDTokenExchangeRate
          .mul(tester.SCALING_FACTOR.add(dTokenInterest))
          .div(tester.SCALING_FACTOR);

        assert.strictEqual(
          dTokenExchangeRate.toString(),
          calculatedDTokenExchangeRate.toString()
        );

        // Validate dToken mint to caller
        const cTokenEquivalent = web3.utils
          .toBN(dTokenMintEvent.returnValues.mintTokens)
          .mul(tester.SCALING_FACTOR)
          .div(cTokenExchangeRate);

        const underlyingEquivalent = cTokenEquivalent
          .mul(cTokenExchangeRate)
          .div(tester.SCALING_FACTOR);

        const dTokensMinted = underlyingEquivalent
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate);

        assert.strictEqual(
          cTokenMintEvent.returnValues.mintAmount,
          web3.utils
            .toBN(cTokenMintEvent.returnValues.mintTokens)
            .mul(tester.SCALING_FACTOR)
            .div(cTokenExchangeRate)
            .toString()
        );

        assert.strictEqual(
          dTokenMintEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenMintEvent.eventName, "Mint");
        assert.strictEqual(dTokenMintEvent.returnValues.minter, tester.address);
        assert.strictEqual(
          dTokenMintEvent.returnValues.mintTokens,
          cTokenMintEvent.returnValues.mintTokens
        );
        assert.strictEqual(
          dTokenMintEvent.returnValues.mintAmount,
          dTokensMinted.toString()
        );

        totalDTokensMinted = dTokenMintEvent.returnValues.mintAmount;

        // Validate dToken transfer to caller
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          dTokenTransferEvent.returnValues.from,
          constants.NULL_ADDRESS
        );
        assert.strictEqual(dTokenTransferEvent.returnValues.to, tester.address);
        assert.strictEqual(
          dTokenTransferEvent.returnValues.value,
          dTokenMintEvent.returnValues.mintAmount
        );
      }
    );

    await tester.runTest(
      `${contractName} exchange rate is updated correctly`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, dTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} exchange rate is updated correctly`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, cTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${tokenSymbols[contractName]} total supply is correct after mint`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, totalDTokensMinted);
      }
    );

    const totalSupply = web3.utils.toBN(totalDTokensMinted);
    const exchangeRate = web3.utils.toBN(dTokenExchangeRate);
    const expectedTotalSupplyUnderlying = totalSupply
      .mul(exchangeRate)
      .div(tester.SCALING_FACTOR);
    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total underlying supply is correct after mint`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, expectedTotalSupplyUnderlying.toString());
      }
    );
  }

  async function testPullSurplusAfterMint() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let dTokenSupply;
    let cTokenBalance;

    let dTokenUnderlying;
    let cTokenUnderlying;

    let cTokenExchangeRate;
    let dTokenExchangeRate;

    let currentSurplus;

    await tester.runTest(
      `${tokenSymbols[contractName]} get current exchange rate`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        dTokenExchangeRate = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${tokenSymbols[contractName]} get total supply`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        dTokenSupply = web3.utils.toBN(value);
      }
    );

    dTokenUnderlying = dTokenSupply
      .mul(dTokenExchangeRate)
      .div(tester.SCALING_FACTOR)
      .add(tester.ONE);

    await tester.runTest(
      `${cTokenSymbols[contractName]} get balance of DToken contract`,
      CToken,
      "balanceOf",
      "call",
      [DToken.options.address],
      true,
      value => {
        cTokenBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} get current exchange rate`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        cTokenExchangeRate = web3.utils.toBN(value);
      }
    );

    cTokenUnderlying = cTokenBalance
      .mul(cTokenExchangeRate)
      .div(tester.SCALING_FACTOR);

    const underlyingSurplus = cTokenUnderlying.gt(dTokenUnderlying)
      ? cTokenUnderlying.sub(dTokenUnderlying)
      : tester.ZERO;

    dTokenSurplus = underlyingSurplus
      .mul(tester.SCALING_FACTOR)
      .div(cTokenExchangeRate);

    await tester.runTest(
      `${tokenSymbols[contractName]} get current surplus`,
      DToken,
      "getSurplus",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, dTokenSurplus.toString());
        currentSurplus = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${tokenSymbols[contractName]} get current surplus in underlying`,
      DToken,
      "getSurplusUnderlying",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, underlyingSurplus.toString());
      }
    );

    let storedDTokenExchangeRate;
    let storedCTokenExchangeRate;
    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    await tester.runTest(
      `${cTokenSymbols[contractName]} pull surplus`,
      DToken,
      "pullSurplus",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );

        let dTokenAccrueInterestEventIndex =
          contractName === "Dharma Dai" ? 3 : 1;
        let cTokenTransferEventIndex = contractName === "Dharma Dai" ? 4 : 2;
        let dTokenCollectSurplusEventIndex =
          contractName === "Dharma Dai" ? 5 : 3;

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          dTokenAccrueInterestEventIndex,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const cTokenTransferEvent = events[cTokenTransferEventIndex];
        const dTokenCollectSurplusEvent =
          events[dTokenCollectSurplusEventIndex];

        const VaultAddress = "0x7e4A8391C728fEd9069B2962699AB416628B19Fa";

        const cTokenEquivalent = currentSurplus
          .mul(cTokenExchangeRate)
          .div(storedCTokenExchangeRate);

        const {
          returnValues: cTokenTransferReturnValues
        } = cTokenTransferEvent;

        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          cTokenTransferReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(cTokenTransferReturnValues.to, VaultAddress);
        // assert.strictEqual(
        //     cTokenTransferReturnValues.value,
        //     cTokenEquivalent.toString()
        // );

        const {
          returnValues: dTokenCollectSurplusReturnValues
        } = dTokenCollectSurplusEvent;

        assert.strictEqual(
          dTokenCollectSurplusEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(
          dTokenCollectSurplusEvent.eventName,
          "CollectSurplus"
        );
        // assert.strictEqual(
        //     dTokenCollectSurplusReturnValues.surplusAmount, ?
        // );
        assert.strictEqual(
          dTokenCollectSurplusReturnValues.surplusCTokens,
          cTokenTransferReturnValues.value
        );
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } current surplus is zero after pull surplus`,
      DToken,
      "getSurplus",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testRedeem() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let currentTotalDTokens;
    let currentDTokenAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        currentTotalDTokens = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const dTokensToBurn = currentDTokenAccountBalance.div(web3.utils.toBN("2"));

    let dTokenExchangeRate;
    let cTokenExchangeRate;
    let cTokenToReceive;
    await tester.runTest(
      `${contractName} can redeem dTokens for underlying`,
      DToken,
      "redeem",
      "send",
      [dTokensToBurn.toString()],
      true,
      receipt => {
        const extraEvents = contractName === "Dharma Dai" ? 6 : 0;

        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 8 + extraEvents);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const dTokenTransferEvent = events[1];
        const dTokenRedeemEvent = events[2];

        const {
          returnValues: dTokenTransferReturnValues
        } = dTokenTransferEvent;

        // Validate dToken "burn" transfer to null address
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(dTokenTransferReturnValues.from, tester.address);
        assert.strictEqual(
          dTokenTransferReturnValues.to,
          constants.NULL_ADDRESS
        );
        assert.strictEqual(
          dTokenTransferReturnValues.value,
          dTokensToBurn.toString()
        );

        const { returnValues: dTokenRedeemReturnValues } = dTokenRedeemEvent;

        const underlyingEquivalent = dTokensToBurn
          .mul(dTokenExchangeRate)
          .div(tester.SCALING_FACTOR);

        cTokenToReceive = underlyingEquivalent
          .mul(tester.SCALING_FACTOR)
          .div(cTokenExchangeRate);

        const underlyingReceived = cTokenToReceive
          .mul(cTokenExchangeRate)
          .div(tester.SCALING_FACTOR);

        // Validate dToken redeem (emits underlying equivalent tokens)
        assert.strictEqual(
          dTokenRedeemEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenRedeemEvent.eventName, "Redeem");
        assert.strictEqual(dTokenRedeemReturnValues.redeemer, tester.address);
        assert.strictEqual(
          dTokenRedeemReturnValues.redeemTokens,
          underlyingReceived.toString()
        );
        assert.strictEqual(
          dTokenRedeemReturnValues.redeemAmount,
          dTokensToBurn.toString()
        );

        // TODO: Validate extra events
        validateCTokenInterestAccrualEvents(
          events,
          3,
          cTokenSymbols[contractName]
        );

        const cTokenTransferEvent = events[5 + extraEvents];
        const cTokenRedeemEvent = events[6 + extraEvents];
        const underlyingTransferEvent = events[7 + extraEvents];

        const {
          returnValues: cTokenTransferReturnValues
        } = cTokenTransferEvent;

        // Validate cToken transfer to caller
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          cTokenTransferReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenTransferReturnValues.to,
          CToken.options.address
        );
        assert.strictEqual(
          cTokenTransferReturnValues.value,
          cTokenToReceive.toString()
        );

        const { returnValues: cTokenRedeemReturnValues } = cTokenRedeemEvent;

        // Validate cToken redeem
        assert.strictEqual(
          cTokenRedeemEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenRedeemEvent.eventName, "Redeem");

        assert.strictEqual(
          cTokenRedeemReturnValues.redeemer,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenRedeemReturnValues.redeemTokens,
          underlyingReceived.toString()
        );
        assert.strictEqual(
          cTokenRedeemReturnValues.redeemAmount,
          cTokenToReceive.toString()
        );

        const {
          returnValues: underlyingTransferReturnValues
        } = underlyingTransferEvent;

        // Validate cToken transfer to caller
        assert.strictEqual(
          underlyingTransferEvent.address,
          underlyingSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(underlyingTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          underlyingTransferReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(underlyingTransferReturnValues.to, tester.address);
        assert.strictEqual(
          underlyingTransferReturnValues.value,
          underlyingReceived.toString()
        );
      }
    );
    await tester.revertToSnapShot(snapshotId);
  }

  async function testRedeemTooMuch() {
    let currentDTokenAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    const dTokensToBurn = currentDTokenAccountBalance.mul(web3.utils.toBN("2"));

    await tester.runTest(
      `${contractName} reverts if we redeem more dTokens than the balance`,
      DToken,
      "redeem",
      "send",
      [dTokensToBurn.toString()],
      false
    );
  }

  async function testRedeemUnderlying() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let currentTotalUnderlying;
    let currentUnderlyingAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total underlying supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        currentTotalUnderlying = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } underlying account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        currentUnderlyingAccountBalance = web3.utils.toBN(value);
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const underlyingToReceive = currentUnderlyingAccountBalance.div(
      web3.utils.toBN("2")
    );

    let dTokenExchangeRate;
    let cTokenExchangeRate;
    let dTokenToBurn;
    let redeemAmount;
    await tester.runTest(
      `${contractName} can redeem dTokens for underlying using redeemUnderlying`,
      DToken,
      "redeemUnderlying",
      "send",
      [underlyingToReceive.toString()],
      true,
      receipt => {
        const extraEvents = contractName === "Dharma Dai" ? 6 : 0;

        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 8 + extraEvents);

        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );

        if (contractName === "Dharma Dai") {
          assert.strictEqual(events[3].address, "MKR-VAT");
          assert.strictEqual(events[3].returnValues.caller, "MKR-POT");

          assert.strictEqual(events[4].address, "MKR-POT");
          assert.strictEqual(events[4].returnValues.caller, "CDAI");

          assert.strictEqual(events[5].address, "MKR-VAT");
          assert.strictEqual(events[5].returnValues.caller, "CDAI");

          // Dai redeemed from cDai is "minted" to the dDai contract
          assert.strictEqual(events[6].address, "DAI");
          assert.strictEqual(events[6].eventName, "Transfer");
          assert.strictEqual(
            events[6].returnValues.from,
            constants.NULL_ADDRESS
          );
          assert.strictEqual(events[6].returnValues.to, DToken.options.address);
          assert.strictEqual(
            events[6].returnValues.value,
            underlyingToReceive.toString()
          );

          assert.strictEqual(events[7].address, "MKR-DAI-JOIN");
          assert.strictEqual(events[7].returnValues.caller, "CDAI");
        } else {
          // USDC redeemed from cUSDC is sent from cUSDC to dUSDC
          assert.strictEqual(events[1].address, "USDC");
          assert.strictEqual(events[1].eventName, "Transfer");
          assert.strictEqual(
            events[1].returnValues.from,
            CToken.options.address
          );
          assert.strictEqual(events[1].returnValues.to, DToken.options.address);
          assert.strictEqual(
            events[1].returnValues.value,
            underlyingToReceive.toString()
          );
        }

        // cTokens are sent from dToken to cToken (TODO: validate)
        const cTokenTransferEvent = events[2 + extraEvents];
        const {
          returnValues: cTokenTransferEventReturnValues
        } = cTokenTransferEvent;
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          cTokenTransferEventReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenTransferEventReturnValues.to,
          CToken.options.address
        );

        // validate dToken Accrue event
        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          4 + extraEvents,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        redeemAmount = underlyingToReceive
          .mul(tester.SCALING_FACTOR)
          .div(cTokenExchangeRate);

        const underlyingEquivalent = redeemAmount
          .add(tester.ONE)
          .mul(cTokenExchangeRate)
          .div(tester.SCALING_FACTOR)
          .add(tester.ONE);

        dTokenToBurn = underlyingEquivalent
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate)
          .add(tester.ONE);

        assert.strictEqual(
          cTokenTransferEventReturnValues.value,
          redeemAmount.toString()
        );

        // cToken Redeem event (TODO: validate)
        const cTokenRedeemEvent = events[3 + extraEvents];
        const {
          returnValues: cTokenRedeemEventReturnValues
        } = cTokenRedeemEvent;
        assert.strictEqual(
          cTokenRedeemEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenRedeemEvent.eventName, "Redeem");
        assert.strictEqual(
          cTokenRedeemEventReturnValues.redeemer,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenRedeemEventReturnValues.redeemTokens,
          underlyingToReceive.toString()
        );

        assert.strictEqual(
          cTokenRedeemEventReturnValues.redeemAmount,
          redeemAmount.toString()
        );

        // dToken "burn" transfer to null address (TODO: validate)
        const dTokenTransferEvent = events[5 + extraEvents];
        const {
          returnValues: dTokenTransferEventReturnValues
        } = dTokenTransferEvent;
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          dTokenTransferEventReturnValues.from,
          tester.address
        );
        assert.strictEqual(
          dTokenTransferEventReturnValues.to,
          constants.NULL_ADDRESS
        );

        assert.strictEqual(
          dTokenTransferEventReturnValues.value,
          dTokenToBurn.toString()
        );

        // dToken Redeem event (TODO: validate)
        const dTokenRedeemEvent = events[6 + extraEvents];
        const {
          returnValues: dTokenRedeemEventReturnValues
        } = dTokenRedeemEvent;
        assert.strictEqual(
          dTokenRedeemEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenRedeemEvent.eventName, "Redeem");
        assert.strictEqual(
          dTokenRedeemEventReturnValues.redeemer,
          tester.address
        );
        assert.strictEqual(
          dTokenRedeemEventReturnValues.redeemTokens,
          underlyingToReceive.toString()
        );

        assert.strictEqual(
          dTokenRedeemEventReturnValues.redeemAmount,
          dTokenToBurn.toString()
        );

        // last event: underlying transfer from dToken to caller
        const underlyingTransferEvent = events[7 + extraEvents];
        const {
          returnValues: underlyingTransferReturnValues
        } = underlyingTransferEvent;
        assert.strictEqual(
          underlyingTransferEvent.address,
          underlyingSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(underlyingTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          underlyingTransferReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(underlyingTransferReturnValues.to, tester.address);
        assert.strictEqual(
          underlyingTransferReturnValues.value,
          underlyingToReceive.toString()
        );
      }
    );
    await tester.revertToSnapShot(snapshotId);
  }

  async function testRedeemToCToken() {
    let currentTotalDTokens;
    let currentTotalUnderlying;
    let currentDTokenAccountBalance;
    let currentUnderlyingAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        currentTotalDTokens = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total underlying supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        currentTotalUnderlying = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } underlying account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        currentUnderlyingAccountBalance = web3.utils.toBN(value);
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const dTokensToBurn = currentDTokenAccountBalance.div(web3.utils.toBN("2"));

    await tester.runTest(
      `${contractName} can redeem dTokens for cTokens`,
      DToken,
      "redeemToCToken",
      "send",
      [dTokensToBurn.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 4);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const dTokenTransferEvent = events[1];
        const dTokenRedeemEvent = events[2];
        const cTokenTransferEvent = events[3];

        const underlyingEquivalent = dTokensToBurn
          .mul(dTokenExchangeRate)
          .div(tester.SCALING_FACTOR);

        const cTokenEquivalent = underlyingEquivalent
          .mul(tester.SCALING_FACTOR)
          .div(cTokenExchangeRate);

        // Validate dToken "burn" transfer to null address
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          dTokenTransferEvent.returnValues.from,
          tester.address
        );
        assert.strictEqual(
          dTokenTransferEvent.returnValues.to,
          constants.NULL_ADDRESS
        );
        assert.strictEqual(
          dTokenTransferEvent.returnValues.value,
          dTokensToBurn.toString()
        );

        // Validate dToken redeem (emits underlying equivalent tokens)
        assert.strictEqual(
          dTokenRedeemEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenRedeemEvent.eventName, "Redeem");
        assert.strictEqual(
          dTokenRedeemEvent.returnValues.redeemer,
          tester.address
        );
        assert.strictEqual(
          dTokenRedeemEvent.returnValues.redeemTokens,
          underlyingEquivalent.toString()
        );
        assert.strictEqual(
          dTokenRedeemEvent.returnValues.redeemAmount,
          dTokenTransferEvent.returnValues.value // also dTokensToBurn
        );

        // Validate cToken transfer to caller
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");
        assert.strictEqual(
          cTokenTransferEvent.returnValues.from,
          DToken.options.address
        );
        assert.strictEqual(cTokenTransferEvent.returnValues.to, tester.address);
        assert.strictEqual(
          cTokenTransferEvent.returnValues.value,
          cTokenEquivalent.toString()
        );
      }
    );

    await tester.runTest(
      `${contractName} exchange rate is updated correctly`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, dTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} exchange rate is updated correctly`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, cTokenExchangeRate.toString());
      }
    );

    // TODO: total supply and account balance, dToken and underlying
  }

  async function testRedeemUnderlyingToCToken() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let currentTotalDTokens;
    let currentTotalUnderlying;
    let currentDTokenAccountBalance;
    let currentCTokenAccountBalance;
    let currentUnderlyingAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        currentTotalDTokens = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total underlying supply can be retrieved prior to redeeming`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        currentTotalUnderlying = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } underlying account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        currentUnderlyingAccountBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `Retrieve ${tokenSymbols[contractName]} account balance`,
      CToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentCTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const tokensToReceive = currentUnderlyingAccountBalance.div(
      web3.utils.toBN("2")
    );

    let dTokenExchangeRate;
    let cTokenExchangeRate;
    let dTokenToBurn;
    let cTokenToReceive;
    await tester.runTest(
      `${contractName} can redeem underlying for cTokens`,
      DToken,
      "redeemUnderlyingToCToken",
      "send",
      [tokensToReceive.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 4);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const dTokenTransferEvent = events[1];
        const dTokenRedeemEvent = events[2];
        const cTokenTransferEvent = events[3];

        // Validate dToken transfer
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const {
          returnValues: dTokenTransferReturnValues
        } = dTokenTransferEvent;

        dTokenToBurn = tokensToReceive
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate)
          .add(tester.ONE);

        assert.strictEqual(dTokenTransferReturnValues.from, tester.address);
        assert.strictEqual(
          dTokenTransferReturnValues.to,
          constants.NULL_ADDRESS
        );
        assert.strictEqual(
          dTokenTransferReturnValues.value,
          dTokenToBurn.toString()
        );

        // Validate dToken redeem
        assert.strictEqual(
          dTokenRedeemEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenRedeemEvent.eventName, "Redeem");

        const { returnValues: dTokenRedeemReturnValues } = dTokenRedeemEvent;

        assert.strictEqual(dTokenRedeemReturnValues.redeemer, tester.address);
        assert.strictEqual(
          dTokenRedeemReturnValues.redeemTokens,
          tokensToReceive.toString()
        );
        assert.strictEqual(
          dTokenRedeemReturnValues.redeemAmount,
          dTokenToBurn.toString()
        );

        // Validate cToken transfer
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");

        const {
          returnValues: cTokenTransferReturnValues
        } = cTokenTransferEvent;

        cTokenToReceive = tokensToReceive
          .mul(tester.SCALING_FACTOR)
          .div(cTokenExchangeRate);

        assert.strictEqual(
          cTokenTransferReturnValues.from,
          DToken.options.address
        );
        assert.strictEqual(cTokenTransferReturnValues.to, tester.address);
        assert.strictEqual(
          cTokenTransferReturnValues.value,
          cTokenToReceive.toString()
        );
      }
    );

    const newTotalSupply = currentTotalDTokens.sub(dTokenToBurn);

    await tester.runTest(
      `${tokenSymbols[contractName]} total supply is updated correctly`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, newTotalSupply.toString());
      }
    );

    const newTotalDTokenBalance = currentDTokenAccountBalance.sub(dTokenToBurn);

    await tester.runTest(
      `${tokenSymbols[contractName]} balance is updated correctly`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, newTotalDTokenBalance.toString());
      }
    );

    const newUnderlyingBalance = newTotalDTokenBalance
      .mul(dTokenExchangeRate)
      .div(tester.SCALING_FACTOR);

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } underlying account balance is updated correctly `,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, newUnderlyingBalance.toString());
      }
    );

    const newTotalCTokenBalance = currentCTokenAccountBalance.add(
      cTokenToReceive
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} balance is updated correctly`,
      CToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, newTotalCTokenBalance.toString());
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testMintViaCToken() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let currentCTokenAccountBalance;
    let currentDTokenAccountBalance;
    let currentUnderlyingAccountBalance;
    let currentDTokenTotalSupply;
    let currentDTokenTotalSupplyUnderlying;
    let currentDTokenSupplyRatePerBlock;
    let cTokenExchangeRate;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to minting`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account underlying balance can be retrieved prior to minting`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        currentUnderlyingAccountBalance = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total supply can be retrieved prior to minting`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        currentDTokenTotalSupply = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total underlying supply can be retrieved prior to minting`,
      DToken,
      "totalSupplyUnderlying",
      "call",
      [],
      true,
      value => {
        currentDTokenTotalSupplyUnderlying = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        cTokenSymbols[contractName]
      } account balance can be retrieved prior to minting`,
      CToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentCTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    const cTokenToSupply = currentCTokenAccountBalance.div(
      web3.utils.toBN("2")
    );

    await tester.runTest(
      `${contractName} cannot mint dTokens via cTokens without prior approval`,
      DToken,
      "mintViaCToken",
      "send",
      [cTokenToSupply.toString()],
      false
    );

    await tester.runTest(
      `${
        cTokenSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      CToken,
      "approve",
      "send",
      [DToken.options.address, constants.FULL_APPROVAL]
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    let mintTokens;
    let mintAmount;
    await tester.runTest(
      `${contractName} can mint dTokens with cTokens`,
      DToken,
      "mintViaCToken",
      "send",
      [cTokenToSupply.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 4);

        const cTokenTransferEvent = events[0];

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          1,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        const dTokenMintEvent = events[2];
        const dTokenTransferEvent = events[3];

        // Validate cToken transfer
        assert.strictEqual(
          cTokenTransferEvent.address,
          cTokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(cTokenTransferEvent.eventName, "Transfer");

        const {
          returnValues: cTokenTransferReturnValues
        } = cTokenTransferEvent;

        assert.strictEqual(cTokenTransferReturnValues.from, tester.address);
        assert.strictEqual(
          cTokenTransferReturnValues.to,
          DToken.options.address
        );
        assert.strictEqual(
          cTokenTransferReturnValues.value,
          cTokenToSupply.toString()
        );

        // Validate dToken mint
        assert.strictEqual(
          dTokenMintEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenMintEvent.eventName, "Mint");

        const { returnValues: dTokenMintReturnValues } = dTokenMintEvent;

        mintTokens = cTokenToSupply
          .mul(cTokenExchangeRate)
          .div(tester.SCALING_FACTOR);

        mintAmount = mintTokens
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate);

        assert.strictEqual(dTokenMintReturnValues.minter, tester.address);
        assert.strictEqual(
          dTokenMintReturnValues.mintTokens,
          mintTokens.toString()
        );
        assert.strictEqual(
          dTokenMintReturnValues.mintAmount,
          mintAmount.toString()
        );

        // Validate dToken transfer
        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const {
          returnValues: dTokenTransferReturnValues
        } = dTokenTransferEvent;

        assert.strictEqual(
          dTokenTransferReturnValues.value,
          mintAmount.toString()
        );
        assert.strictEqual(
          dTokenTransferReturnValues.from,
          constants.NULL_ADDRESS
        );
        assert.strictEqual(dTokenTransferReturnValues.to, tester.address);
      }
    );

    await tester.runTest(
      `${cTokenSymbols[contractName]} exchange rate matches that from dToken`,
      CToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, cTokenExchangeRate.toString());
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } supply rate used during minting can be retrieved`,
      DToken,
      "supplyRatePerBlock",
      "call",
      [],
      true,
      value => {
        currentDTokenSupplyRatePerBlock = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance is correctly increased after minting`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(
          value,
          currentDTokenAccountBalance.add(mintAmount).toString()
        );
      }
    );

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } total supply is correctly increased after minting`,
      DToken,
      "totalSupply",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(
          value,
          currentDTokenTotalSupply.add(mintAmount).toString()
        );
      }
    );

    /* TODO: still working this one out
        const interestEarnedOnPriorBalance = (
        	currentUnderlyingAccountBalance.mul(currentDTokenSupplyRatePerBlock)
        ).div(tester.SCALING_FACTOR);

        const interestEarnedOnPriorSupply = (
        	currentDTokenTotalSupplyUnderlying.mul(currentDTokenSupplyRatePerBlock)
        ).div(tester.SCALING_FACTOR);

        await tester.runTest(
            `${tokenSymbols[contractName]} underlying account balance is correctly increased after minting`,
            DToken,
            'balanceOfUnderlying',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(
                	value,
                	currentUnderlyingAccountBalance.add(
                		mintTokens
                	).add(
                		interestEarnedOnPriorBalance
                	).toString()
                )
            }
        );

        await tester.runTest(
            `${tokenSymbols[contractName]} total underlying supply is correctly increased after minting`,
            DToken,
            'totalSupplyUnderlying',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(
                	value,
                	currentDTokenTotalSupplyUnderlying.add(
                		mintTokens
                	).add(
                		interestEarnedOnPriorSupply
                	).toString())
            }
        );
        */
    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransfer() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let transferAmount;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance for transfer`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        transferAmount = value.toString();
      }
    );

    await tester.runTest(
      `${contractName} can transfer dTokens`,
      DToken,
      "transfer",
      "send",
      [tester.addressTwo, transferAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        const dTokenTransferEvent = events[0];

        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = dTokenTransferEvent;

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(transferReturnValues.value, transferAmount);
      }
    );

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, transferAmount);
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransferFrom() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let transferAmount;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance for transfer`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        transferAmount = value.toString();
      }
    );

    await tester.runTest(
      `${contractName} can increase dTokens allowance`,
      DToken,
      "increaseAllowance",
      "send",
      [tester.addressTwo, transferAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, transferAmount);
      }
    );

    await tester.runTest(
      `${contractName} can transferFrom dTokens`,
      DToken,
      "transferFrom",
      "send",
      [tester.address, tester.addressTwo, transferAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 2);

        // Transfer Event
        const dTokenTransferEvent = events[0];

        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = dTokenTransferEvent;

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(transferReturnValues.value, transferAmount);

        // Approval Event
        const approvalEvent = events[1];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, "0");
      },
      tester.addressTwo
    );

    await tester.runTest(
      `Check transfer sender sent correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, transferAmount);
      }
    );

    await tester.runTest(
      `Check transfer recipient has correct allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransferFromFullAllowance() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let transferAmount;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance for transfer`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        transferAmount = value.toString();
      }
    );

    await tester.runTest(
      `${contractName} approve full allowance`,
      DToken,
      "approve",
      "send",
      [tester.addressTwo, constants.FULL_APPROVAL],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, constants.FULL_APPROVAL);
      }
    );

    await tester.runTest(
      `${contractName} can transferFrom dTokens with full allowance, no "Approve" event`,
      DToken,
      "transferFrom",
      "send",
      [tester.address, tester.addressTwo, transferAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 1);

        // Transfer Event
        const dTokenTransferEvent = events[0];

        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = dTokenTransferEvent;

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(transferReturnValues.value, transferAmount);
      },
      tester.addressTwo
    );

    await tester.runTest(
      `Check transfer sender sent correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, transferAmount);
      }
    );

    await tester.runTest(
      `Check transfer recipient still has full allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, constants.FULL_APPROVAL);
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransferUnderlying() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let balance;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance for transfer`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        balance = web3.utils.toBN(value.toString());
      }
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const expectedUnderlyingAmount = balance
      .mul(storedDTokenExchangeRate)
      .div(tester.SCALING_FACTOR);

    let initialUnderlyingAmount;
    await tester.runTest(
      `Get total underlying ${underlyingSymbols[contractName]} balance`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, expectedUnderlyingAmount.toString());
        initialUnderlyingAmount = web3.utils.toBN(value.toString());
      }
    );

    let dTokenExchangeRate;
    let leftOverBalance;
    let dTokentransferAmount;
    await tester.runTest(
      `${contractName} can transfer underlying`,
      DToken,
      "transferUnderlying",
      "send",
      [tester.addressTwo, initialUnderlyingAmount.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 2);

        [dTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        dTokentransferAmount = initialUnderlyingAmount
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate)
          .add(tester.ONE);

        leftOverBalance = balance.sub(dTokentransferAmount);

        const tokenTransferEvent = events[1];
        assert.strictEqual(
          tokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(tokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = tokenTransferEvent;

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(
          transferReturnValues.value,
          dTokentransferAmount.toString()
        );
      }
    );

    await tester.runTest(
      `${contractName} balance is reduced by expected amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, leftOverBalance.toString());
      }
    );

    const underlyingAmountTransfered = dTokentransferAmount
      .mul(dTokenExchangeRate)
      .div(tester.SCALING_FACTOR);

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, underlyingAmountTransfered.toString());
      }
    );

    const leftOverUnderlying = leftOverBalance
      .mul(dTokenExchangeRate)
      .div(tester.SCALING_FACTOR);

    await tester.runTest(
      `Check transfer sender has correct balance`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        assert.strictEqual(value, leftOverUnderlying.toString());
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransferUnderlyingFrom() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let balanceAmount;
    await tester.runTest(
      `Get a ${tokenSymbols[contractName]} account balance`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        balanceAmount = web3.utils.toBN(value);
      }
    );

    let transferUnderlyingAmount;
    await tester.runTest(
      `Get an underlying ${underlyingSymbols[contractName]} account balance`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        transferUnderlyingAmount = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${contractName} exchange rate can be retrieved`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        dTokenExchangeRate = web3.utils.toBN(value);
      }
    );

    assert.strictEqual(
      transferUnderlyingAmount.toString(),
      balanceAmount
        .mul(dTokenExchangeRate)
        .div(tester.SCALING_FACTOR)
        .toString()
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    const dTokenAllowance = balanceAmount;

    await tester.runTest(
      `${contractName} can increase dTokens allowance`,
      DToken,
      "increaseAllowance",
      "send",
      [tester.addressTwo, dTokenAllowance.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(
          approvalReturnValues.value,
          dTokenAllowance.toString()
        );
      }
    );

    let approvedAllowance;
    let calculatedTransferAmount;
    await tester.runTest(
      `${contractName} can transferUnderlyingFrom dTokens`,
      DToken,
      "transferUnderlyingFrom",
      "send",
      [tester.address, tester.addressTwo, transferUnderlyingAmount.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 3);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        // Transfer Event
        const dTokenTransferEvent = events[1];

        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = dTokenTransferEvent;

        calculatedTransferAmount = transferUnderlyingAmount
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate)
          .add(tester.ONE);

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(
          transferReturnValues.value,
          calculatedTransferAmount.toString()
        );

        // Approval Event
        const approvalEvent = events[2];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        approvedAllowance = dTokenAllowance.sub(calculatedTransferAmount);

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(
          approvalReturnValues.value,
          approvedAllowance.toString()
        );
      },
      tester.addressTwo
    );

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, calculatedTransferAmount.toString());
      }
    );

    await tester.runTest(
      `Check transfer recipient has correct allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, approvedAllowance.toString());
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testTransferUnderlyingFromFullAllowance() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let balanceAmount;
    await tester.runTest(
      `Get a ${tokenSymbols[contractName]} account balance`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        balanceAmount = web3.utils.toBN(value);
      }
    );

    let transferUnderlyingAmount;
    await tester.runTest(
      `Get an underlying ${underlyingSymbols[contractName]} account balance`,
      DToken,
      "balanceOfUnderlying",
      "call",
      [tester.address],
      true,
      value => {
        transferUnderlyingAmount = web3.utils.toBN(value);
      }
    );

    await tester.runTest(
      `${contractName} exchange rate can be retrieved`,
      DToken,
      "exchangeRateCurrent",
      "call",
      [],
      true,
      value => {
        dTokenExchangeRate = web3.utils.toBN(value);
      }
    );

    assert.strictEqual(
      transferUnderlyingAmount.toString(),
      balanceAmount
        .mul(dTokenExchangeRate)
        .div(tester.SCALING_FACTOR)
        .toString()
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate,
      blockNumber
    ] = await prepareToValidateAccrual(web3, DToken);

    await tester.runTest(
      `${contractName} approve full allowance`,
      DToken,
      "approve",
      "send",
      [tester.addressTwo, constants.FULL_APPROVAL],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, constants.FULL_APPROVAL);
      }
    );

    let calculatedTransferAmount;
    await tester.runTest(
      `${contractName} can transferUnderlyingFrom dTokens`,
      DToken,
      "transferUnderlyingFrom",
      "send",
      [tester.address, tester.addressTwo, transferUnderlyingAmount.toString()],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 2);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );

        // Transfer Event
        const dTokenTransferEvent = events[1];

        assert.strictEqual(
          dTokenTransferEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(dTokenTransferEvent.eventName, "Transfer");

        const { returnValues: transferReturnValues } = dTokenTransferEvent;

        calculatedTransferAmount = transferUnderlyingAmount
          .mul(tester.SCALING_FACTOR)
          .div(dTokenExchangeRate)
          .add(tester.ONE);

        assert.strictEqual(transferReturnValues.from, tester.address);
        assert.strictEqual(transferReturnValues.to, tester.addressTwo);
        assert.strictEqual(
          transferReturnValues.value,
          calculatedTransferAmount.toString()
        );
      },
      tester.addressTwo
    );

    await tester.runTest(
      `Check transfer recipient received correct amount`,
      DToken,
      "balanceOf",
      "call",
      [tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, calculatedTransferAmount.toString());
      }
    );

    await tester.runTest(
      `Check transfer recipient still has full allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, constants.FULL_APPROVAL);
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testAllowance() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    await tester.runTest(
      `Get ${tokenSymbols[contractName]} allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    let allowanceAmount;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        allowanceAmount = value.toString();
      }
    );

    await tester.runTest(
      `${contractName} can increase dTokens allowance`,
      DToken,
      "increaseAllowance",
      "send",
      [tester.addressTwo, allowanceAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, allowanceAmount);
      }
    );

    await tester.runTest(
      `Get ${tokenSymbols[contractName]} allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, allowanceAmount);
      }
    );

    await tester.runTest(
      `${contractName} can decrease dTokens allowance`,
      DToken,
      "decreaseAllowance",
      "send",
      [tester.addressTwo, allowanceAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, "0");
      }
    );

    await tester.runTest(
      `Get ${tokenSymbols[contractName]} allowance`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, "0");
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testApprove() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let approveAmount;
    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        approveAmount = value.toString();
      }
    );

    await tester.runTest(
      `${contractName} can approve dToken allowance`,
      DToken,
      "approve",
      "send",
      [tester.addressTwo, approveAmount],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, approveAmount);
      }
    );

    await tester.runTest(
      `Check ${
        tokenSymbols[contractName]
      } allowance is set correctly after approve`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, approveAmount);
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testModifyAllowanceViaMetaTransaction() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    let approveAmount;
    let messageHash;

    await tester.runTest(
      `Get total ${tokenSymbols[contractName]} balance`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        approveAmount = value.toString();
      }
    );

    await tester.runTest(
      `Get message hash for meta-transaction approval`,
      DToken,
      "getMetaTransactionMessageHash",
      "call",
      [
        "0x2d657fa5", // `modifyAllowanceViaMetaTransaction`
        web3.eth.abi.encodeParameters(
          ["address", "address", "uint256", "bool"],
          [tester.address, tester.addressTwo, approveAmount, true]
        ),
        0, // No expiration
        constants.NULL_BYTES_32 // no salt
      ],
      true,
      values => {
        assert.ok(values.valid);
        messageHash = values.messageHash;
      }
    );

    const signature = tester.signHashedPrefixedHexString(
      messageHash,
      tester.address
    );

    await tester.runTest(
      `${contractName} can modify dToken allowance via meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        approveAmount,
        true,
        0,
        constants.NULL_BYTES_32,
        signature
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(approvalReturnValues.owner, tester.address);
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, approveAmount);
      }
    );

    await tester.runTest(
      `Message hash for meta-transaction approval is no longer valid`,
      DToken,
      "getMetaTransactionMessageHash",
      "call",
      [
        "0x2d657fa5", // `modifyAllowanceViaMetaTransaction`
        web3.eth.abi.encodeParameters(
          ["address", "address", "uint256", "bool"],
          [tester.address, tester.addressTwo, approveAmount, true]
        ),
        0, // No expiration
        constants.NULL_BYTES_32 // no salt
      ],
      true,
      values => {
        assert.ok(!values.valid);
        assert.strictEqual(values.messageHash, messageHash);
      }
    );

    await tester.runTest(
      `Check ${
        tokenSymbols[contractName]
      } allowance is set correctly after approve`,
      DToken,
      "allowance",
      "call",
      [tester.address, tester.addressTwo],
      true,
      value => {
        assert.strictEqual(value, approveAmount);
      }
    );

    await tester.runTest(
      `${contractName} cannot reuse a meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        approveAmount,
        true,
        0,
        constants.NULL_BYTES_32,
        signature
      ],
      false
    );

    await tester.runTest(
      `${contractName} cannot use an expired meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        approveAmount,
        true,
        1,
        constants.NULL_BYTES_32,
        signature
      ],
      false
    );

    const MockERC1271 = await tester.runTest(
      `Mock ERC1271 contract deployment`,
      tester.MockERC1271Deployer,
      "",
      "deploy"
    );

    await tester.runTest(
      `Get message hash for meta-transaction approval of ERC1271 contract`,
      DToken,
      "getMetaTransactionMessageHash",
      "call",
      [
        "0x2d657fa5", // `modifyAllowanceViaMetaTransaction`
        web3.eth.abi.encodeParameters(
          ["address", "address", "uint256", "bool"],
          [MockERC1271.options.address, tester.addressTwo, 1, true]
        ),
        0, // No expiration
        constants.NULL_BYTES_32 // no salt
      ],
      true,
      values => {
        assert.ok(values.valid);
        messageHash = values.messageHash;
      }
    );

    await tester.runTest(
      `Mock ERC1271 will initially signal any arguments as valid`,
      MockERC1271,
      "isValidSignature",
      "call",
      ["0x", "0x"],
      true,
      value => {
        assert.strictEqual(value, "0x20c13b0b");
      }
    );

    await tester.runTest(
      `${contractName} can modify dToken allowance for ERC1271 via meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        MockERC1271.options.address,
        tester.addressTwo,
        1,
        true,
        0,
        constants.NULL_BYTES_32,
        signature
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        assert.strictEqual(events.length, 1);

        // Approval Event
        const approvalEvent = events[0];
        assert.strictEqual(
          approvalEvent.address,
          tokenSymbols[contractName].toUpperCase()
        );
        assert.strictEqual(approvalEvent.eventName, "Approval");

        const { returnValues: approvalReturnValues } = approvalEvent;

        assert.strictEqual(
          approvalReturnValues.owner,
          MockERC1271.options.address
        );
        assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
        assert.strictEqual(approvalReturnValues.value, "1");
      }
    );

    await tester.runTest(
      `Mock ERC1271 contract deactivation`,
      MockERC1271,
      "deactivate",
      "send"
    );

    await tester.runTest(
      `Mock ERC1271 will now signal any arguments as invalid`,
      MockERC1271,
      "isValidSignature",
      "call",
      ["0x", "0x"],
      true,
      value => {
        assert.ok(value !== "0x20c13b0b");
      }
    );

    await tester.runTest(
      `Get message hash for meta-transaction approval of ERC1271 contract`,
      DToken,
      "getMetaTransactionMessageHash",
      "call",
      [
        "0x2d657fa5", // `modifyAllowanceViaMetaTransaction`
        web3.eth.abi.encodeParameters(
          ["address", "address", "uint256", "bool"],
          [MockERC1271.options.address, tester.addressTwo, 2, true]
        ),
        0, // No expiration
        constants.NULL_BYTES_32 // no salt
      ],
      true,
      values => {
        assert.ok(values.valid);
        messageHash = values.messageHash;
      }
    );

    await tester.runTest(
      `${contractName} cannot modify dToken allowance for ERC1271 if not valid`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        MockERC1271.options.address,
        tester.addressTwo,
        2,
        true,
        0,
        constants.NULL_BYTES_32,
        signature
      ],
      false
    );

    await tester.runTest(
      `Mock ERC1271 contract deactivation`,
      MockERC1271,
      "superDeactivate",
      "send"
    );

    await tester.runTest(
      `Mock ERC1271 will now signal any arguments as throwing`,
      MockERC1271,
      "isValidSignature",
      "call",
      ["0x", "0x"],
      false
    );

    await tester.runTest(
      `Get message hash for meta-transaction approval of ERC1271 contract`,
      DToken,
      "getMetaTransactionMessageHash",
      "call",
      [
        "0x2d657fa5", // `modifyAllowanceViaMetaTransaction`
        web3.eth.abi.encodeParameters(
          ["address", "address", "uint256", "bool"],
          [MockERC1271.options.address, tester.addressTwo, 3, true]
        ),
        0, // No expiration
        constants.NULL_BYTES_32 // no salt
      ],
      true,
      values => {
        assert.ok(values.valid);
        messageHash = values.messageHash;
      }
    );

    await tester.runTest(
      `${contractName} cannot modify dToken allowance for ERC1271 if not valid`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        MockERC1271.options.address,
        tester.addressTwo,
        3,
        true,
        0,
        constants.NULL_BYTES_32,
        signature
      ],
      false
    );

    await tester.runTest(
      `${contractName} cannot use a signature that is too short on meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        1,
        true,
        0,
        constants.NULL_BYTES_32,
        signature.slice(0, 10)
      ],
      false
    );

    await tester.runTest(
      `${contractName} cannot use a signature with too high an s value on a meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        1,
        true,
        0,
        constants.NULL_BYTES_32,
        "0x12345678901234567890123456789012345678901234567890123456" +
          "78901234ffffffffffffffffffffffffffffffffffffffffffffffffff" +
          "ffffffffffffff1b"
      ],
      false
    );

    await tester.runTest(
      `${contractName} cannot use a signature with an unsupported v value on a meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        1,
        true,
        0,
        constants.NULL_BYTES_32,
        "0x12345678901234567890123456789012345678901234567890123456" +
          "7890123412345678901234567890123456789012345678901234567890" +
          "1234567890123401"
      ],
      false
    );

    await tester.runTest(
      `${contractName} cannot use bad signature on a meta-transaction`,
      DToken,
      "modifyAllowanceViaMetaTransaction",
      "send",
      [
        tester.address,
        tester.addressTwo,
        1,
        true,
        0,
        constants.NULL_BYTES_32,
        "0x12345678901234567890123456789012345678901234567890123456" +
          "7890123412345678901234567890123456789012345678901234567890" +
          "123456789012341b"
      ],
      false
    );

    await tester.revertToSnapShot(snapshotId);
  }

  async function testSpreadPerBlock() {
    await tester.runTest(
      `Accrue ${cTokenSymbols[contractName]} interest`,
      CToken,
      "accrueInterest",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );
      }
    );

    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;
    await tester.runTest(
      `${contractName} spread per block is 10% of ${
        cTokenSymbols[contractName]
      } supply rate per block`,
      DToken,
      "getSpreadPerBlock",
      "call",
      [],
      true,
      async value => {
        await tester.revertToSnapShot(snapshotId);

        let cTokenSupplyRate;
        await tester.runTest(
          `${cTokenSymbols[contractName]} supply rate can be retrieved`,
          CToken,
          "supplyRatePerBlock",
          "call",
          [],
          true,
          value => {
            cTokenSupplyRate = web3.utils.toBN(value);
          }
        );

        let dTokenSpreadPerBlock = cTokenSupplyRate.div(tester.TEN);
        // assert.strictEqual(value, dTokenSpreadPerBlock.toString()) ?
      }
    );
    await tester.revertToSnapShot(snapshotId);
  }

  async function testRequireNonNull() {
    await tester.runTest(
      `${contractName} transfer reverts if recipient is null address`,
      DToken,
      "transfer",
      "send",
      [constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} transferUnderlying reverts if recipient is null address`,
      DToken,
      "transferUnderlying",
      "send",
      [constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} transferFrom reverts if sender is null address`,
      DToken,
      "transferFrom",
      "send",
      [constants.NULL_ADDRESS, tester.address, "0"],
      false
    );

    await tester.runTest(
      `${contractName} transferFrom reverts if recipient is null address`,
      DToken,
      "transferFrom",
      "send",
      [tester.address, constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} transferUnderlyingFrom reverts if sender is null address`,
      DToken,
      "transferUnderlyingFrom",
      "send",
      [constants.NULL_ADDRESS, tester.address, "0"],
      false
    );

    await tester.runTest(
      `${contractName} transferUnderlyingFrom reverts if recipient is null address`,
      DToken,
      "transferUnderlyingFrom",
      "send",
      [tester.address, constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} approve reverts if spender is null address`,
      DToken,
      "approve",
      "send",
      [constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} increaseAllowance reverts if spender is null address`,
      DToken,
      "increaseAllowance",
      "send",
      [constants.NULL_ADDRESS, "0"],
      false
    );

    await tester.runTest(
      `${contractName} decreaseAllowance reverts if spender is null address`,
      DToken,
      "decreaseAllowance",
      "send",
      [constants.NULL_ADDRESS, "0"],
      false
    );
  }

  async function testEdgeCases() {
    await tester.runTest(
      `${contractName} cannot call redeemUnderlying and supply a huge amount`,
      DToken,
      "redeemUnderlying",
      "send",
      [constants.FULL_APPROVAL],
      false
    );

    await tester.runTest(
      `${contractName} call to transfer with huge amount fails`,
      DToken,
      "transfer",
      "send",
      [tester.address, constants.FULL_APPROVAL],
      false
    );

    if (contractName === "Dharma Dai") {
      await tester.runTest(
        `${contractName} cannot call mint and supply a tiny amount`,
        DToken,
        "mint",
        "send",
        ["1"],
        false
      );

      await tester.runTest(
        `${contractName} cannot call mintViaCToken and supply a tiny amount`,
        DToken,
        "mintViaCToken",
        "send",
        ["1"],
        false
      );

      await tester.runTest(
        `${contractName} cannot call redeemUnderlying and supply a tiny amount`,
        DToken,
        "redeemUnderlying",
        "send",
        ["1"],
        false
      );

      await tester.runTest(
        `${contractName} cannot call redeemUnderlyingToCToken and supply a tiny amount`,
        DToken,
        "redeemUnderlyingToCToken",
        "send",
        ["1"],
        false
      );

      await tester.runTest(
        `${contractName} call to transferUnderlying with tiny amount rounds up to 1 dToken`,
        DToken,
        "transfer",
        "send",
        [tester.address, "1"],
        true,
        receipt => {
          const events = tester.getEvents(receipt, contractNames);
          assert.strictEqual(events.length, 1);
          assert.strictEqual(events[0].returnValues.from, tester.address);
          assert.strictEqual(events[0].returnValues.to, tester.address);
          assert.strictEqual(events[0].returnValues.value, "1");
        }
      );
    } else {
      await tester.runTest(
        `${contractName} cannot call redeem and supply a tiny amount`,
        DToken,
        "redeem",
        "send",
        ["1"],
        false
      );

      await tester.runTest(
        `${contractName} cannot call redeemToCToken and supply a tiny amount`,
        DToken,
        "redeemToCToken",
        "send",
        ["1"],
        false
      );
    }
  }

  async function testBlockAccrual() {
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const currentBlockNumber = (await web3.eth.getBlock("latest")).number;

    let currentDTokenAccountBalance;

    await tester.runTest(
      `${
        tokenSymbols[contractName]
      } account balance can be retrieved prior to redeeming`,
      DToken,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        currentDTokenAccountBalance = web3.utils.toBN(value);
      }
    );

    const dTokensToBurn = currentDTokenAccountBalance.div(web3.utils.toBN("2"));

    await tester.runTest(
      `${contractName} redeem to trigger accrual`,
      DToken,
      "redeem",
      "send",
      [dTokensToBurn.toString()],
      true
    );

    const latestAccrualBlock = currentBlockNumber + 1;

    await tester.runTest(
      `${contractName} accrualBlockNumber is set correctly`,
      DToken,
      "accrualBlockNumber",
      "call",
      [],
      true,
      value => {
        assert.strictEqual(value, latestAccrualBlock.toString());
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send/mint in underlying, receive dTokens, wait for `t` blocks, redeem dTokens
   *  - [ ] account receives original underlying + 90% of total compound interest
   *  - [ ] surplus underlying contains 10% of total compound interest
   *  - [x] account's balance of dTokens / underlying is 0 -- checked on test-scenario contract
   *  - [ ] quoted supply rate at `t0` is correct
   *  - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events, and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario0() {
    console.log("Scenario 0 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario0Helper = await tester.runTest(
      `Mock Scenario0Helper contract deployment for ${contractName}`,
      tester.Scenario0HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario0Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 0, Phase 1`,
      Scenario0Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
      }
    );

    // Advance blocks
    let block = await web3.eth.getBlock("latest");
    const { number: blockNumber } = block;

    let accountNonce;
    let blocksToAdvance;
    if (context !== "coverage") {
      accountNonce = (await web3.eth.getTransactionCount(tester.address)) + 1;
      blocksToAdvance = 5000000; // a few years
      block = await tester.advanceTimeAndBlocks(blocksToAdvance);
    } else {
      blocksToAdvance = 1000; // a few hours
      await advanceByBlocks(blocksToAdvance, tester);
      block = await web3.eth.getBlock("latest");
    }

    const { number: currentBlockNumber } = block;

    assert.strictEqual(currentBlockNumber, blockNumber + blocksToAdvance);

    let underlyingBalanceFromCToken;
    let underlyingBalanceFromDToken;
    // Phase 2
    await tester.runTest(
      `${contractName} Scenario 0, Phase 2`,
      Scenario0Helper,
      "phaseTwo",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        let underlyingTransferFromCTokenEvent;
        let underlyingTransferFromDTokenEvent;

        if (contractName === "Dharma Dai") {
          underlyingTransferFromCTokenEvent = events[10];
          underlyingTransferFromDTokenEvent = events[25];
        } else {
          underlyingTransferFromCTokenEvent = events[4];
          underlyingTransferFromDTokenEvent = events[13];
        }

        const {
          returnValues: underlyingTransferFromCToken
        } = underlyingTransferFromCTokenEvent;
        const {
          returnValues: underlyingTransferFromDToken
        } = underlyingTransferFromDTokenEvent;

        underlyingBalanceFromCToken = web3.utils.toBN(
          underlyingTransferFromCToken.value
        );
        underlyingBalanceFromDToken = web3.utils.toBN(
          underlyingTransferFromDToken.value
        );
      },
      tester.account,
      0,
      undefined,
      accountNonce
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Mint underlying, receive dTokens, immediately redeem dTokens in the same block
   * - [x] user receives full original underlying less dust (no interest)
   * - [ ] surplus contains 0 cTokens
   * - [x] user's balance of dTokens / underlying is 0
   * - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events, and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario2() {
    console.log("Scenario 2 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario2Helper = await tester.runTest(
      `Mock Scenario2Helper contract deployment for ${contractName}`,
      tester.Scenario2HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario2Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 2, Phase 1`,
      Scenario2Helper,
      "phaseOne",
      "send",
      [DToken.options.address, Underlying.options.address],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
        // console.log(JSON.stringify(events, null, 2));
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in underlying, receive dTokens, wait for t blocks, redeem dTokens,
   * .
   *  - [X] user receives original underlying + 90% of total compound interest
   *  - [ ] vault receives 10% of total compound interest represented as cTokens
   *  - [X] surplus contains 0 cTokens
   *  - [X] user's balance of dTokens / underlying 0
   *  - [ ] quoted supply rate at `t0` is correct
   *  - [ ] quoted spread rate at `t0` is correct
   *  - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` + `Transfer` events, dToken `Accrue` + `Mint` + `Redeem`+ `CollectSurplus` + `Transfer` events, and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario5() {
    console.log("Scenario 5 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario5Helper = await tester.runTest(
      `Mock Scenario5Helper contract deployment for ${contractName}`,
      tester.Scenario5HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario5Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 5, Phase 1`,
      Scenario5Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
      }
    );

    // Advance blocks
    let block = await web3.eth.getBlock("latest");
    const { number: blockNumber } = block;

    let accountNonce;
    let blocksToAdvance;
    if (context !== "coverage") {
      accountNonce = (await web3.eth.getTransactionCount(tester.address)) + 1;
      blocksToAdvance = 50000000; // ~20 years
      block = await tester.advanceTimeAndBlocks(blocksToAdvance);
    } else {
      blocksToAdvance = 1000; // a few hours
      await advanceByBlocks(blocksToAdvance, tester);
      block = await web3.eth.getBlock("latest");
    }

    const { number: currentBlockNumber } = block;

    assert.strictEqual(currentBlockNumber, blockNumber + blocksToAdvance);

    let underlyingBalanceFromCToken;
    let underlyingBalanceFromDToken;
    // Phase 2
    await tester.runTest(
      `${contractName} Scenario 5, Phase 2`,
      Scenario5Helper,
      "phaseTwo",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
      },
      tester.account,
      0,
      undefined,
      accountNonce
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in underlying, receive dTokens, wait for t blocks, redeem dTokens,
   * immediately pull surplus. Interaction with dToken at time t occurs prior
   * to interaction with the cToken.
   *  - [X] user receives original underlying + 90% of total compound interest
   *  - [ ] vault receives 10% of total compound interest represented as cTokens
   *  - [X] surplus contains 0 cTokens
   *  - [X] user's balance of dTokens / underlying 0
   *  - [ ] quoted supply rate at `t0` is correct
   *  - [ ] quoted spread rate at `t0` is correct
   *  - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` + `Transfer` events, dToken `Accrue` + `Mint` + `Redeem`+ `CollectSurplus` + `Transfer` events, and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario6() {
    console.log("Scenario 6 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario6Helper = await tester.runTest(
      `Mock Scenario6Helper contract deployment for ${contractName}`,
      tester.Scenario6HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario6Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 6, Phase 1`,
      Scenario6Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
      }
    );

    // Advance blocks
    let block = await web3.eth.getBlock("latest");
    const { number: blockNumberOne } = block;

    let accountNonce;
    let blocksToAdvance;
    if (context !== "coverage") {
      accountNonce = (await web3.eth.getTransactionCount(tester.address)) + 1;
      blocksToAdvance = 50000000; // ~20 years
      block = await tester.advanceTimeAndBlocks(blocksToAdvance);
    } else {
      blocksToAdvance = 100; // a little bit
      await advanceByBlocks(blocksToAdvance, tester);
      block = await web3.eth.getBlock("latest");
    }

    const { number: currentBlockNumberOne } = block;

    assert.strictEqual(currentBlockNumberOne, blockNumberOne + blocksToAdvance);

    await tester.runTest(
      `Accrue ${cTokenSymbols[contractName]} interest`,
      CToken,
      "accrueInterest",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        validateCTokenInterestAccrualEvents(
          events,
          0,
          cTokenSymbols[contractName]
        );
      },
      tester.account,
      0,
      undefined,
      accountNonce
    );

    if (context !== "coverage") {
      blocksToAdvance = 50000000; // ~20 years
      block = await tester.advanceTimeAndBlocks(
        blocksToAdvance,
        accountNonce + 1
      );
    } else {
      blocksToAdvance = 100; // a little bit
      await advanceByBlocks(blocksToAdvance, tester);
      block = await web3.eth.getBlock("latest");
    }

    const { number: currentBlockNumberTwo } = block;

    assert.strictEqual(
      currentBlockNumberTwo,
      currentBlockNumberOne + blocksToAdvance + 1
    );

    [
      storedDTokenExchangeRate,
      storedCTokenExchangeRate
    ] = await prepareToValidateAccrual(web3, DToken, true);

    await tester.runTest(
      `Accrue ${contractName} interest `,
      DToken,
      "accrueInterest",
      "send",
      [],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);

        assert.strictEqual(events.length, 1);

        [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
          events,
          0,
          contractName,
          web3,
          tester,
          storedDTokenExchangeRate,
          storedCTokenExchangeRate
        );
      },
      tester.account,
      0,
      undefined,
      accountNonce + 2
    );

    if (context !== "coverage") {
      blocksToAdvance = 50000000; // ~20 years
      block = await tester.advanceTimeAndBlocks(
        blocksToAdvance,
        accountNonce + 3
      );
    } else {
      blocksToAdvance = 100; // a little bit
      await advanceByBlocks(blocksToAdvance, tester);
      block = await web3.eth.getBlock("latest");
    }

    const { number: currentBlockNumberThree } = block;

    assert.strictEqual(
      currentBlockNumberThree,
      currentBlockNumberTwo + blocksToAdvance + 1
    );

    let underlyingBalanceFromCToken;
    let underlyingBalanceFromDToken;
    // Phase 2
    await tester.runTest(
      `${contractName} Scenario 6, Phase 2`,
      Scenario6Helper,
      "phaseTwo",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
      },
      tester.account,
      0,
      undefined,
      accountNonce + 4
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in cTokens, receive dTokens, immediately redeem dTokens to underlying
   * in the same block
   * - [x] user receives full original underlying less dust (no interest)
   * - [ ] surplus contains 0 cTokens
   * - [x] user's balance of dTokens / underlying is 0
   * - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events, and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario7() {
    console.log("Scenario 7 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario7Helper = await tester.runTest(
      `Mock Scenario7Helper contract deployment for ${contractName}`,
      tester.Scenario7HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario7Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 7, Phase 1`,
      Scenario7Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
        // console.log(JSON.stringify(events, null, 2));
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in cTokens, receive dTokens, immediately redeem dTokens to underlying
   * in the same block
   * - [x] user receives full original underlying less dust (no interest)
   * - [ ] surplus contains 0 cTokens
   * - [x] user's balance of dTokens / underlying is 0
   * - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events and cToken and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario7() {
    console.log("Scenario 7 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario7Helper = await tester.runTest(
      `Mock Scenario7Helper contract deployment for ${contractName}`,
      tester.Scenario7HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario7Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 7, Phase 1`,
      Scenario7Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
        // console.log(JSON.stringify(events, null, 2));
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in underlying, receive dTokens, immediately redeem dTokens to
   * cTokens in the same block
   * - [x] user receives full original underlying equivalent in cTokens less dust (no interest)
   * - [ ] surplus contains 0 cTokens
   * - [x] user's balance of dTokens / underlying is 0
   * - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events and cToken and underlying `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario9() {
    console.log("Scenario 9 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario9Helper = await tester.runTest(
      `Mock Scenario9Helper contract deployment for ${contractName}`,
      tester.Scenario9HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario9Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 9, Phase 1`,
      Scenario9Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
        // console.log(JSON.stringify(events, null, 2));
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  /**
   * Send in cTokens, receive dTokens, immediately redeem dTokens to cTokens
   * in the same block
   * - [x] user receives original cTokens less dust (no interest)
   * - [ ] surplus contains 0 cTokens
   * - [x] user's balance of dTokens / underlying is 0
   * - [ ] cToken `AccrueInterest` + `Mint` + `Redeem` events, dToken `Accrue` + `Mint` + `Redeem` + `Transfer` events and cToken `Transfer` events are all present & correct
   *
   *  Account starts with 100 DAI/USDC tokens.
   */
  async function testScenario11() {
    console.log("Scenario 11 ");
    const snapshot = await tester.takeSnapshot();
    const { result: snapshotId } = snapshot;

    const Scenario11Helper = await tester.runTest(
      `Mock Scenario11Helper contract deployment for ${contractName}`,
      tester.Scenario11HelperDeployer,
      "",
      "deploy"
    );

    let underlyingBalance;
    await tester.runTest(
      `Check that we start with 100 ${underlyingSymbols[contractName]}`,
      Underlying,
      "balanceOf",
      "call",
      [tester.address],
      true,
      value => {
        underlyingBalance = web3.utils.toBN(value);
        assert.strictEqual(
          value,
          "1".padEnd(underlyingDecimals[contractName] + 3, "0")
        );
      }
    );

    await tester.runTest(
      `${
        underlyingSymbols[contractName]
      } can approve ${contractName} in order to mint dTokens`,
      Underlying,
      "approve",
      "send",
      [Scenario11Helper.options.address, constants.FULL_APPROVAL]
    );

    // Phase 1
    await tester.runTest(
      `${contractName} Scenario 11, Phase 1`,
      Scenario11Helper,
      "phaseOne",
      "send",
      [
        CToken.options.address,
        DToken.options.address,
        Underlying.options.address
      ],
      true,
      receipt => {
        const events = tester.getEvents(receipt, contractNames);
        // TODO: validate?
        // console.log(JSON.stringify(events, null, 2));
      }
    );

    await tester.revertToSnapShot(snapshotId);
  }

  // // Test snapshot and advance (time/block) functions
  await testSnapshot(web3, tester);
  await testAdvanceTimeAndBlockInDays(web3, tester, context);
  //
  // // Take initial snapshot to run function tests, and revert before starting scenarios.
  const initialSnapshot = await tester.takeSnapshot();
  const { result: initialSnapshotId } = initialSnapshot;

  await testPureFunctions();
  await testAccrueInterest();
  await testSupplyRatePerBlock();
  await testExchangeRate();
  await testAccrueInterestFromAnyAccount();
  await testPullSurplusBeforeMints();

  await getUnderlyingTokens();

  // Start testing scenarios
  // Note: scenarios require getUnderlyingTokens()
  await testScenario0();
  await testScenario2();
  await testScenario5();
  await testScenario6();
  await testScenario7();
  await testScenario9();
  await testScenario11();

  await testCannotMintBeforeApproval();
  await testMint();
  await testPullSurplusAfterMint();
  await testRedeem();
  await testRedeemTooMuch();
  await testRedeemUnderlying();
  await testRedeemToCToken();
  await testRedeemUnderlyingToCToken();
  await testMintViaCToken();
  await testTransfer();
  await testTransferFrom();
  await testTransferFromFullAllowance();
  await testAllowance();
  await testModifyAllowanceViaMetaTransaction();
  await testTransferUnderlying();
  await testTransferUnderlyingFrom();
  await testTransferUnderlyingFromFullAllowance();
  await testApprove();
  await testSpreadPerBlock();
  await testRequireNonNull();
  await testBlockAccrual();
  // await testEdgeCases();

  await tester.revertToSnapShot(initialSnapshotId);

  console.log(
    `completed ${tester.passed + tester.failed} test${
      tester.passed + tester.failed === 1 ? "" : "s"
    } ` +
      `on the ${tokenSymbols[contractName]} contract with ${
        tester.failed
      } failure${tester.failed === 1 ? "" : "s"}.`
  );

  await longer();

  if (tester.failed > 0) {
    console.log("warning - some tests failed!");
    if (context !== "coverage") {
      process.exit(1);
    }
  }

  // exit.
  return 0;
}

async function getOrDeployDTokenContract(contract, tester, contractName) {
  if (contract) {
    return contract;
  }
  return await tester.runTest(
    `${contractName} contract deployment`,
    contractName === "Dharma Dai"
      ? tester.DharmaDaiDeployer
      : tester.DharmaUSDCDeployer,
    "",
    "deploy"
  );
}

function getExchangeRates(web3) {
  const dDAIExchangeRate = web3.utils.toBN("10000000000000000000000000000");
  const dUSDCExchangeRate = web3.utils.toBN("10000000000000000");
  return {
    "Dharma Dai": {
      notation: "1e28",
      rate: dDAIExchangeRate
    },
    "Dharma USD Coin": {
      notation: "1e16",
      rate: dUSDCExchangeRate
    }
  };
}

async function testSnapshot(web3, tester) {
  // test takeSnapshot and revertToSnapshot
  const beforeSnapshotBlockNumber = (await web3.eth.getBlock("latest")).number;

  const snapshot = await tester.takeSnapshot();

  const { result: snapshotId } = snapshot;

  await tester.advanceBlock();

  const newBlockNumber = (await web3.eth.getBlock("latest")).number;

  assert.strictEqual(beforeSnapshotBlockNumber + 1, newBlockNumber);

  await tester.revertToSnapShot(snapshotId);

  const blockNumber = (await web3.eth.getBlock("latest")).number;

  assert.strictEqual(beforeSnapshotBlockNumber, blockNumber);
}

async function testAdvanceTimeAndBlockInDays(web3, tester, context) {
  const blocksToAdvance = 100;

  const blockBeforeSnapshot = await web3.eth.getBlock("latest");
  const {
    timestamp: timeBeforeSnapshot,
    number: blockNumberBeforeSnapshot
  } = blockBeforeSnapshot;

  const snapshot = await tester.takeSnapshot();
  const { result: snapshotId } = snapshot;

  const before = Math.floor(new Date().getTime() / 1000);

  let newBlock;
  if (context !== "coverage") {
    newBlock = await tester.advanceTimeAndBlocks(blocksToAdvance);
  } else {
    await advanceByBlocks(blocksToAdvance, tester);
    newBlock = await web3.eth.getBlock("latest");
  }

  const after = Math.floor(new Date().getTime() / 1000);

  const { timestamp: currentTime, number: currentBlockNumber } = newBlock;

  assert.strictEqual(
    currentBlockNumber,
    blockNumberBeforeSnapshot + blocksToAdvance
  );

  const timeDifference = currentTime - timeBeforeSnapshot;

  assert.ok(
    Math.abs(timeDifference - (blocksToAdvance * 15 + (after - before))) <= 1
  );

  await tester.revertToSnapShot(snapshotId);
}

async function advanceByBlocks(blocksToAdvance, tester) {
  const timeToAdvance = blocksToAdvance * 15;

  await tester.advanceTime(timeToAdvance);

  for (let i = 0; i < blocksToAdvance; i++) {
    await tester.advanceBlock();
  }
}

module.exports = {
  runAllTests
};
