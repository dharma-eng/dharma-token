const assert = require('assert');
const { Tester, longer } = require('./test');
const connectionConfig = require('../../truffle-config.js');
const constants = require('./constants.js');

let contractNames = constants.CONTRACT_NAMES;


async function runAllTests(web3, context, contract, contractName) {
    const tester = new Tester(web3, context);
    await tester.init();

    await testSnapshot(web3, tester);

    let cDaiSupplyRate
    let cDaiExchangeRate

    let DharmaToken;
    if (contract) {
        DharmaToken = contract;
    } else {
        contractName = 'Dharma Dai'
        DharmaToken = await tester.runTest(
            `${contractName} contract deployment`,
            contractName === 'Dharma Dai'
                ? tester.DharmaDaiDeployer
                : tester.DharmaUSDCDeployer,
            '',
            'deploy'
        )
    }

    contractNames = Object.assign(contractNames, {
        [DharmaToken.options.address]: (
            contractName === 'Dharma Dai' ? 'DDAI' : 'DUSDC'
        )
    })

    await tester.runTest(
        `${contractName} gets the initial version correctly`,
        DharmaToken,
        'getVersion',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, '0')
        }
    )

    let dDaiExchangeRate = web3.utils.toBN('10000000000000000000000000000')
    // coverage mines a few blocks prior to reaching this point - skip this test
    if (context !== 'coverage') {
        await tester.runTest(
            `${contractName} exchange rate starts at 1e28`,
            DharmaToken,
            'exchangeRateCurrent',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, dDaiExchangeRate.toString())
            }
        )
    }

    await tester.runTest(
        'Accrue cDai interest',
        tester.CDAI,
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

    await tester.runTest(
        'cDai supply rate can be retrieved',
        tester.CDAI,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            cDaiSupplyRate = web3.utils.toBN(value)
        }
    )

    let dDaiSupplyRate = (cDaiSupplyRate.mul(tester.NINE)).div(tester.TEN)
    await tester.runTest(
        `${contractName} supply rate starts at 90% of cDai supply rate`,
        DharmaToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiSupplyRate.toString())
        }
    )

    await tester.runTest(
        'cDai exchange rate can be retrieved',
        tester.CDAI,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            cDaiExchangeRate = web3.utils.toBN(value)
        }
    )

    await tester.runTest(
        `${contractName} exchange rate can be retrieved`,
        DharmaToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            dDaiExchangeRate = web3.utils.toBN(value)
        }
    )

    // dToken ExchangeRate "checkpoint" is stored at slot zero.
    let storedDTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DharmaToken.options.address, 0)
    )

    // cToken ExchangeRate "checkpoint" is stored at slot one.
    let storedCTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DharmaToken.options.address, 1)
    )

    let blockNumber = (await web3.eth.getBlock('latest')).number

    await tester.runTest(
        `${contractName} accrueInterest can be triggered correctly from any account`,
        DharmaToken,
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
            dDaiExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.dTokenExchangeRate
            )
            cDaiExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.cTokenExchangeRate
            )

            cDaiInterest = ((
                cDaiExchangeRate.mul(tester.SCALING_FACTOR)
            ).div(storedCTokenExchangeRate)).sub(tester.SCALING_FACTOR)

            dDaiInterest = (cDaiInterest.mul(tester.NINE)).div(tester.TEN)

            calculatedDDaiExchangeRate = (storedDTokenExchangeRate.mul(
                tester.SCALING_FACTOR.add(dDaiInterest)
            )).div(tester.SCALING_FACTOR)

            assert.strictEqual(
                dDaiExchangeRate.toString(),
                calculatedDDaiExchangeRate.toString()
            )
        },
        tester.originalAddress
    )

    await tester.runTest(
        `${contractName} exchange rate is updated correctly`,
        DharmaToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiExchangeRate.toString())
        }
    )

    await tester.runTest(
        `${contractName} supply rate is updated after an accrual`,
        DharmaToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            dDaiSupplyRate = value
        }
    )

    await tester.runTest(
        'cDai exchange rate is updated correctly',
        tester.CDAI,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cDaiExchangeRate.toString())
        }
    )

    await tester.runTest(
        'cDai supply rate is unchanged after dDai accrual (as it did not accrue)',
        tester.CDAI,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cDaiSupplyRate.toString())
        }
    )

    await tester.runTest(
        `${contractName} can pull surplus`,
        DharmaToken,
        'pullSurplus',
        'send',
        [],
        true,
        receipt => {
            const events = tester.getEvents(receipt, contractNames);

            assert.strictEqual(events.length, 3);

            const accrueEvent = events[0];
            const transferEvent = events[1];
            const collectSurplusEvents = events[2];

            assert.strictEqual(accrueEvent.address, 'DDAI');
            assert.strictEqual(accrueEvent.eventName, 'Accrue');
            // TODO: validate accrual

            assert.strictEqual(transferEvent.address, 'CDAI');
            assert.strictEqual(transferEvent.eventName, 'Transfer');
            // TODO: validate transferred surplus amount

            assert.strictEqual(collectSurplusEvents.address, 'DDAI');
            assert.strictEqual(collectSurplusEvents.eventName, 'CollectSurplus');
            // TODO: validate transferred surplus amount
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


module.exports ={
    runAllTests,
};

