const assert = require('assert');
const { Tester, longer } = require('./test');
const connectionConfig = require('../../truffle-config.js');
const connection = connectionConfig.networks['development'];
const web3 = connection.provider;
const constants = require('./constants.js');

let contractNames = constants.CONTRACT_NAMES;


async function runAllTests() {

    const tester = new Tester(web3, 'development');
    await tester.init();

    const DharmaDai = await tester.runTest(
        `DharmaDai contract deployment`,
        tester.DharmaDaiDeployer,
        '',
        'deploy'
    );

    contractNames = Object.assign(contractNames, {
        [DharmaDai.options.address]: 'DDAI'
    });

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
    );

    let cDaiSupplyRate;
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
    );

    let cDaiExchangeRate;
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
    );

    let dDaiSupplyRate = (cDaiSupplyRate.mul(tester.NINE)).div(tester.TEN);
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
    );

    let dDaiExchangeRate = web3.utils.toBN('10000000000000000000000000000');
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
    );

    // Every time we call send, block increments by 1
    const latestBlock = await web3.eth.getBlock('latest');
    const blockNumber = latestBlock.number;

    const expectedDDaiExchangeRate = dDaiExchangeRate.add(
        (dDaiExchangeRate.mul(dDaiSupplyRate)).div(tester.SCALING_FACTOR)
    );

    const expectedCDaiExchangeRate = cDaiExchangeRate.add(
        (cDaiExchangeRate.mul(cDaiSupplyRate)).div(tester.SCALING_FACTOR)
    );

    await tester.runTest(
        'Dharma Dai accrueInterest can be triggered correctly from any account',
        DharmaDai,
        'accrueInterest',
        'send',
        [],
        true,
        receipt => {
            assert.strictEqual(receipt.blockNumber, blockNumber + 1);
            if (tester.context !== 'coverage') {
                const events = tester.getEvents(receipt, contractNames);

                assert.strictEqual(events.length, 1);

                assert.strictEqual(events[0].address, 'DDAI');
                assert.strictEqual(events[0].eventName, 'Accrue');
                assert.strictEqual(
                    events[0].returnValues.dTokenExchangeRate,
                    expectedDDaiExchangeRate.toString()
                );
                assert.strictEqual(
                    events[0].returnValues.cTokenExchangeRate,
                    expectedCDaiExchangeRate.toString()
                )
            }
        },
        tester.originalAddress
    );

    dDaiExchangeRate = expectedDDaiExchangeRate;
    cDaiExchangeRate = expectedCDaiExchangeRate;

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
    );

    await tester.runTest(
        'Dharma Dai supply rate is unchanged after an accrual',
        DharmaDai,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dDaiSupplyRate.toString())
        }
    );

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
    );

    await tester.runTest(
        'cDai supply rate is unchanged after an accrual',
        tester.CDAI,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cDaiSupplyRate.toString())
        }
    );

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
