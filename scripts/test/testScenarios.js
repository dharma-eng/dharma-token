const assert = require('assert');
const { Tester, longer } = require('./test');
const constants = require('./constants.js');

let contractNames = constants.CONTRACT_NAMES;

const tokenSymbols = {
    "Dharma Dai": "dDai",
    "Dharma USDC": "dUSDC"
};

const DTokenDecimals = 8;

async function runAllTests(web3, context, contractName, contract) {

    const tester = new Tester(web3, context);
    await tester.init();

    // Test takeSnapshot and revertToSnapshot
    await testSnapshot(web3, tester);

    const DToken = await getOrDeployDTokenContract(contract, tester, contractName);

    const CToken = contractName === 'Dharma Dai' ? tester.CDAI : tester.CUSDC;

    const { options: { address: dTokenAddress  } } = DToken;

    contractNames = Object.assign(contractNames, {
        [dTokenAddress]: (
            contractName === 'Dharma Dai' ? 'DDAI' : 'DUSDC'
        )
    });

    await testPureFunctions(tester, DToken, contractName, tokenSymbols[contractName]);

    const dDAIExchangeRate = web3.utils.toBN('10000000000000000000000000000');
    const dUSDCExchangeRate = web3.utils.toBN('10000000000000000');
    const initialExchangeRates = {
        "Dharma Dai": {
            notation: "1e28",
            rate: dDAIExchangeRate,
        },
        "Dharma USDC": {
            notation: "1e16",
            rate: dUSDCExchangeRate
        }
    };


    let dTokenExchangeRate = initialExchangeRates[contractName];
    // coverage mines a few blocks prior to reaching this point - skip this test
    if (context !== 'coverage') {
        await tester.runTest(
            `${contractName} exchange rate starts at ${dTokenExchangeRate.notation}`,
            DToken,
            'exchangeRateCurrent',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, dTokenExchangeRate.rate.toString())
            }
        )
    }

    await tester.runTest(
        `Accrue ${tokenSymbols[contractName]} interest`,
        CToken,
        'accrueInterest',
        'send',
        [],
        true,
        receipt => {
            const events = tester.getEvents(receipt, contractNames)

            // 'suck' on Vat, 'drip' on Pot, 'accrueInterest' on cDai
            assert.strictEqual(events.length, 3)

            assert.strictEqual(events[0].address, 'VAT')
            assert.strictEqual(events[1].address, 'POT')
            assert.strictEqual(events[2].address, 'CDAI')
        }
    )

    let cTokenSupplyRate;
    await tester.runTest(
        `${tokenSymbols[contractName]} supply rate can be retrieved`,
        CToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            cTokenSupplyRate = web3.utils.toBN(value)
        }
    )

    let dDaiSupplyRate = (cTokenSupplyRate.mul(tester.NINE)).div(tester.TEN)
    await tester.runTest(
        `${contractName} supply rate starts at 90% of cDai supply rate`,
        DToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiSupplyRate.toString())
        }
    )

    let cTokenExchangeRate;
    await tester.runTest(
        `${tokenSymbols[contractName]} exchange rate can be retrieved`,
        CToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
             cTokenExchangeRate = web3.utils.toBN(value)
        }
    )

    await tester.runTest(
        `${contractName} exchange rate can be retrieved`,
        DToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            dTokenExchangeRate = web3.utils.toBN(value)
        }
    )

    // dToken ExchangeRate "checkpoint" is stored at slot zero.
    let storedDTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DToken.options.address, 0)
    )

    // cToken ExchangeRate "checkpoint" is stored at slot one.
    let storedCTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DToken.options.address, 1)
    )

    let blockNumber = (await web3.eth.getBlock('latest')).number

    await tester.runTest(
        `${contractName} accrueInterest can be triggered correctly from any account`,
        DToken,
        'accrueInterest',
        'send',
        [],
        true,
        receipt => {
            assert.strictEqual(receipt.blockNumber, blockNumber + 1)
            const events = tester.getEvents(receipt, contractNames)

            assert.strictEqual(events.length, 1)

            const accrueEvent = events[0];
            assert.strictEqual(accrueEvent.address, 'DDAI')
            assert.strictEqual(accrueEvent.eventName, 'Accrue')
            dTokenExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.dTokenExchangeRate
            )
             cTokenExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.cTokenExchangeRate
            )

            cDaiInterest = ((
                 cTokenExchangeRate.mul(tester.SCALING_FACTOR)
            ).div(storedCTokenExchangeRate)).sub(tester.SCALING_FACTOR)

            dDaiInterest = (cDaiInterest.mul(tester.NINE)).div(tester.TEN)

            calculatedDDaiExchangeRate = (storedDTokenExchangeRate.mul(
                tester.SCALING_FACTOR.add(dDaiInterest)
            )).div(tester.SCALING_FACTOR)

            assert.strictEqual(
                dTokenExchangeRate.toString(),
                calculatedDDaiExchangeRate.toString()
            )
        },
        tester.originalAddress
    )

    await tester.runTest(
        `${contractName} exchange rate is updated correctly`,
        DToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dTokenExchangeRate.toString())
        }
    )

    await tester.runTest(
        `${contractName} supply rate is updated after an accrual`,
        DToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            dDaiSupplyRate = value
        }
    )

    await tester.runTest(
        `${tokenSymbols[contractName]} exchange rate is updated correctly`,
        CToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value,  cTokenExchangeRate.toString())
        }
    )

    await tester.runTest(
        `${tokenSymbols[contractName]} supply rate is unchanged after dDai accrual (as it did not accrue)`,
        CToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cTokenSupplyRate.toString())
        }
    )

    storedDTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DToken.options.address, 0)
    )
    storedCTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DToken.options.address, 1)
    )

    await tester.runTest(
        `${contractName} can pull surplus of 0 before any tokens are minted`,
        DToken,
        'pullSurplus',
        'send',
        [],
        true,
        receipt => {
            const events = tester.getEvents(receipt, contractNames);

            assert.strictEqual(events.length, 3);

            const accrueEvent = events[0];
            const transferEvent = events[1];
            const collectSurplusEvent = events[2];

            // Ensure that accrual is performed correctly
            assert.strictEqual(accrueEvent.address, 'DDAI');
            assert.strictEqual(accrueEvent.eventName, 'Accrue');
            dTokenExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.dTokenExchangeRate
            )
             cTokenExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.cTokenExchangeRate
            )

            cDaiInterest = ((
                 cTokenExchangeRate.mul(tester.SCALING_FACTOR)
            ).div(storedCTokenExchangeRate)).sub(tester.SCALING_FACTOR)

            dDaiInterest = (cDaiInterest.mul(tester.NINE)).div(tester.TEN)

            calculatedDDaiExchangeRate = (storedDTokenExchangeRate.mul(
                tester.SCALING_FACTOR.add(dDaiInterest)
            )).div(tester.SCALING_FACTOR)

            assert.strictEqual(
                dTokenExchangeRate.toString(),
                calculatedDDaiExchangeRate.toString()
            )

            // Ensure that cDai transfer of 0 tokens is performed correctly
            assert.strictEqual(transferEvent.address, 'CDAI');
            assert.strictEqual(transferEvent.eventName, 'Transfer');
            assert.strictEqual(
                transferEvent.returnValues.from, DToken.options.address
            )
            assert.strictEqual(
                transferEvent.returnValues.to, constants.VAULT_MAINNET_ADDRESS
            )
            assert.strictEqual(transferEvent.returnValues.value, '0')

            // Ensure that CollectSurplus of 0, 0 is performed correctly
            assert.strictEqual(collectSurplusEvent.address, 'DDAI');
            assert.strictEqual(collectSurplusEvent.eventName, 'CollectSurplus');
            assert.strictEqual(
                collectSurplusEvent.returnValues.surplusAmount, '0'
            )
            assert.strictEqual(
                collectSurplusEvent.returnValues.surplusCTokens, '0'
            )
        },
    )

    console.log(
        `completed ${tester.passed + tester.failed} test${tester.passed + tester.failed === 1 ? '' : 's'} ` +
        `with ${tester.failed} failure${tester.failed === 1 ? '' : 's'}.`
    );

    await longer();

    if (tester.failed > 0) {
        console.log('warning - some tests failed!')
        //process.exit(1)
    }

    // exit.
    return 0
}

async function getOrDeployDTokenContract(contract, tester, contractName) {
    if (contract) {
        return contract;
    }
    return await tester.runTest(
        `${contractName} contract deployment`,
        contractName === 'Dharma Dai'
            ? tester.DharmaDaiDeployer
            : tester.DharmaUSDCDeployer,
        '',
        'deploy'
    );
}

async function testSnapshot(web3, tester) {
    // test takeSnapshot and revertToSnapshot
    const beforeSnapshotBlockNumber = (await web3.eth.getBlock('latest')).number;

    const snapshot = await tester.takeSnapshot();

    const { result: snapshotId } = snapshot;

    await tester.advanceBlock();

    const newBlockNumber = (await web3.eth.getBlock('latest')).number;

    assert.strictEqual(beforeSnapshotBlockNumber + 1, newBlockNumber);

    await tester.revertToSnapShot(snapshotId);

    const blockNumber = (await web3.eth.getBlock('latest')).number;

    assert.strictEqual(beforeSnapshotBlockNumber, blockNumber);
}

async function testPureFunctions(tester, DTokenContract, DTokenName, DTokenSymbol) {
    await tester.runTest(
        `${DTokenName} gets the initial version correctly`,
        DTokenContract,
        'getVersion',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, '0')
        }
    );

    await tester.runTest(
        `${DTokenName} gets name correctly`,
        DTokenContract,
        'name',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, DTokenName)
        }
    );

    await tester.runTest(
        `${DTokenName} gets symbol correctly`,
        DTokenContract,
        'symbol',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, DTokenSymbol)
        }
    );

    await tester.runTest(
        `${DTokenName} gets decimals correctly`,
        DTokenContract,
        'decimals',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, DTokenDecimals.toString())
        }
    );
}

module.exports ={
    runAllTests,
};

