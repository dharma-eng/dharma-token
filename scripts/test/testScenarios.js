const assert = require('assert');
const { Tester, longer } = require('./test');
const connectionConfig = require('../../truffle-config.js');
const constants = require('./constants.js');

let contractNames = constants.CONTRACT_NAMES;


async function runAllTests(web3, context) {

    const tester = new Tester(web3, context);
    await tester.init();

    let cDaiSupplyRate
    let cDaiExchangeRate
    const DharmaDai = await tester.runTest(
        `DharmaDai contract deployment`,
        tester.DharmaDaiDeployer,
        '',
        'deploy'
    )

    contractNames = Object.assign(contractNames, {
        [DharmaDai.options.address]: 'DDAI'
    })

    await tester.runTest(
        'Dharma Dai gets the initial version correctly',
        DharmaDai,
        'getVersion',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, '0')
        }
    )

    let dDaiExchangeRate = web3.utils.toBN('10000000000000000000000000000')
    await tester.runTest(
        'Dharma Dai exchange rate starts at 1e28',
        DharmaDai,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiExchangeRate.toString())
        }
    )

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
        'Dharma Dai supply rate starts at 90% of cDai supply rate',
        DharmaDai,
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
        'Dharma Dai exchange rate can be retrieved',
        DharmaDai,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            dDaiExchangeRate = web3.utils.toBN(value)
        }
    )

    let blockNumber = (await web3.eth.getBlock('latest')).number
    let newDDaiExchangeRate;
    let newCDaiExchangeRate;

    await tester.runTest(
        'Dharma Dai accrueInterest can be triggered correctly from any account',
        DharmaDai,
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
            newDDaiExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.dTokenExchangeRate
            )
            newCDaiExchangeRate = web3.utils.toBN(
                accrueEvent.returnValues.cTokenExchangeRate
            )

            cDaiInterest = ((
                newCDaiExchangeRate.mul(tester.SCALING_FACTOR)
            ).div(cDaiExchangeRate)).sub(tester.SCALING_FACTOR)

            dDaiInterest = (cDaiInterest.mul(tester.NINE)).div(tester.TEN)

            calculatedDDaiExchangeRate = (dDaiExchangeRate.mul(
                tester.SCALING_FACTOR.add(dDaiInterest)
            )).div(tester.SCALING_FACTOR)

            assert.strictEqual(
                accrueEvent.returnValues.dTokenExchangeRate,
                calculatedDDaiExchangeRate.toString()
            )
        },
        tester.originalAddress
    )

    dDaiExchangeRate = newDDaiExchangeRate
    cDaiExchangeRate = newCDaiExchangeRate

    await tester.runTest(
        'Dharma Dai exchange rate is updated correctly',
        DharmaDai,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiExchangeRate.toString())
        }
    )

    await tester.runTest(
        'Dharma Dai supply rate is updated after an accrual',
        DharmaDai,
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
        'cDai static supply rate is unchanged after a dDai accrual',
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
        'pull surplus',
        DharmaDai,
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

            assert.strictEqual(transferEvent.address, 'CDAI');
            assert.strictEqual(transferEvent.eventName, 'Transfer');

            assert.strictEqual(collectSurplusEvents.address, 'DDAI');
            assert.strictEqual(collectSurplusEvents.eventName, 'CollectSurplus');
        },
    )

    const DharmaUSDC = await tester.runTest(
        `DharmaUSDC contract deployment`,
        tester.DharmaUSDCDeployer,
        '',
        'deploy'
    )

    contractNames = Object.assign(contractNames, {
        [DharmaUSDC.options.address]: 'DUSDC'
    })

    console.log(
        `completed ${tester.passed + tester.failed} test${tester.passed + tester.failed === 1 ? '' : 's'} ` +
        `with ${tester.failed} failure${tester.failed === 1 ? '' : 's'}.`
    );

    await longer();

    if (tester.failed > 0) {
        process.exit(1)
    }

    // exit.
    return 0
}

module.exports ={
    runAllTests,
};
