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

    const initialExchangeRates = getExchangeRates(web3);

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

            assert.strictEqual(events[0].address, 'MKR-VAT')
            assert.strictEqual(events[1].address, 'MKR-POT')
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

    // Get some Dai from Uniswap
    let priceOfOneHundredDai;
    await tester.runTest(
        `Get the price of 100 Dai from Uniswap`,
        tester.UNISWAP_DAI,
        'getEthToTokenOutputPrice',
        'call',
        ['100000000000000000000'],
        true,
        value => {
            priceOfOneHundredDai = value
        },
    )

    await tester.runTest(
        `Get 100 Dai from Uniswap`,
        tester.UNISWAP_DAI,
        'ethToTokenSwapOutput',
        'send',
        ['100000000000000000000', '9999999999'],
        true,
        receipt => {},
        tester.address,
        priceOfOneHundredDai
    )

    await tester.runTest(
        `Check that we now have 100 Dai`,
        tester.DAI,
        'balanceOf',
        'call',
        [tester.address],
        true,
        value => {
            assert.strictEqual(value, '100000000000000000000')
        },
    )

    // Get some USDC from Uniswap
    let priceOfOneHundredUSDC;
    await tester.runTest(
        `Get the price of 100 USDC from Uniswap`,
        tester.UNISWAP_USDC,
        'getEthToTokenOutputPrice',
        'call',
        ['100000000'],
        true,
        value => {
            priceOfOneHundredUSDC = value
        },
    )

    await tester.runTest(
        `Get 100 USDC from Uniswap`,
        tester.UNISWAP_USDC,
        'ethToTokenSwapOutput',
        'send',
        ['100000000', '9999999999'],
        true,
        receipt => {},
        tester.address,
        priceOfOneHundredUSDC
    )

    await tester.runTest(
        `Check that we now have 100 USDC`,
        tester.USDC,
        'balanceOf',
        'call',
        [tester.address],
        true,
        value => {
            assert.strictEqual(value, '100000000')
        },
    )

    await tester.runTest(
        `${contractName} cannot mint dTokens without prior approval`,
        DharmaToken,
        'mint',
        'send',
        ['1000000000000000000'],
        false
    )

    await tester.runTest(
        `Dai can approve ${contractName} in order to mint dTokens`,
        tester.DAI,
        'approve',
        'send',
        [DharmaToken.options.address, constants.FULL_APPROVAL]
    )

    await tester.runTest(
        `${contractName} can get dToken exchange rate`,
        DharmaToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            dDaiExchangeRate = web3.utils.toBN(value)    
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

    storedDTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DharmaToken.options.address, 0)
    )
    storedCTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(DharmaToken.options.address, 1)
    )

    await tester.runTest(
        `${contractName} can mint dTokens`,
        DharmaToken,
        'mint',
        'send',
        ['1000000000000000000'],
        true,
        receipt => {
            const events = tester.getEvents(receipt, contractNames)
            assert.strictEqual(events.length, 15)

            // important events - validate in full later
            const daiTransferInEvent = events[0]
            const cDaiMintEvent = events[10]
            const cDaiTransferEvent = events[11]
            const dDaiAccrueEvent = events[12]
            const dDaiMintEvent = events[13]
            const dDaiTransferEvent = events[14]

            // ancillary events - partial validation ok (mostly cDai-specific)
            assert.strictEqual(events[1].address, 'MKR-VAT')
            assert.strictEqual(events[1].returnValues.caller, 'MKR-VOW')

            assert.strictEqual(events[2].address, 'MKR-POT')
            assert.strictEqual(events[2].returnValues.caller, 'CDAI')

            assert.strictEqual(events[3].address, 'CDAI')
            assert.strictEqual(events[3].eventName, 'AccrueInterest')

            // (transfer from dDai to DSR)
            assert.strictEqual(events[4].address, 'DAI')
            assert.strictEqual(events[4].eventName, 'Transfer')
            assert.strictEqual(
                events[4].returnValues.from, DharmaToken.options.address
            )
            assert.strictEqual(
                events[4].returnValues.value, '1000000000000000000'
            )

            assert.strictEqual(events[5].address, 'MKR-VAT')
            assert.strictEqual(events[5].returnValues.caller, 'MKR-DAI-JOIN')

            // (burned by DSR)
            assert.strictEqual(events[6].address, 'DAI')
            assert.strictEqual(events[6].eventName, 'Transfer')
            assert.strictEqual(
                events[6].returnValues.to, constants.NULL_ADDRESS
            )
            assert.strictEqual(
                events[6].returnValues.value, '1000000000000000000'
            )

            assert.strictEqual(events[7].address, 'MKR-DAI-JOIN')
            assert.strictEqual(events[7].returnValues.caller, 'CDAI')

            assert.strictEqual(events[8].address, 'MKR-VAT')
            assert.strictEqual(events[8].returnValues.caller, 'CDAI')    

            assert.strictEqual(events[9].address, 'MKR-POT')
            assert.strictEqual(events[9].returnValues.caller, 'CDAI')

            // Validate initial transfer in to dDai of 1 Dai
            assert.strictEqual(daiTransferInEvent.address, 'DAI')
            assert.strictEqual(daiTransferInEvent.eventName, 'Transfer')
            assert.strictEqual(
                daiTransferInEvent.returnValues.from, tester.address
            )
            assert.strictEqual(
                daiTransferInEvent.returnValues.to, DharmaToken.options.address
            )
            assert.strictEqual(
                daiTransferInEvent.returnValues.value, '1000000000000000000'
            )

            // Validate cDai mint to dDai
            assert.strictEqual(cDaiMintEvent.address, 'CDAI')
            assert.strictEqual(cDaiMintEvent.eventName, 'Mint')
            assert.strictEqual(
                cDaiMintEvent.returnValues.minter, DharmaToken.options.address
            )
            assert.strictEqual(
                cDaiMintEvent.returnValues.mintTokens, '1000000000000000000'
            )
            // note: mint amount is checked after parsing dDai accrual event

            // Validate cDai transfer to dDai
            assert.strictEqual(cDaiTransferEvent.address, 'CDAI')
            assert.strictEqual(cDaiTransferEvent.eventName, 'Transfer')
            assert.strictEqual(
                cDaiTransferEvent.returnValues.from, tester.CDAI.options.address
            )
            assert.strictEqual(
                cDaiTransferEvent.returnValues.to, DharmaToken.options.address
            )
            assert.strictEqual(
                cDaiTransferEvent.returnValues.value,
                cDaiMintEvent.returnValues.mintAmount
            )  

            // Validate dDai accrue event
            assert.strictEqual(dDaiAccrueEvent.address, 'DDAI')
            assert.strictEqual(dDaiAccrueEvent.eventName, 'Accrue')
            dDaiExchangeRate = web3.utils.toBN(
                dDaiAccrueEvent.returnValues.dTokenExchangeRate
            )
            cDaiExchangeRate = web3.utils.toBN(
                dDaiAccrueEvent.returnValues.cTokenExchangeRate
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

            assert.strictEqual(
                cDaiMintEvent.returnValues.mintAmount,
                (web3.utils.toBN(
                    cDaiMintEvent.returnValues.mintTokens
                ).mul(tester.SCALING_FACTOR)).div(cDaiExchangeRate).toString()
            )

            // Validate dDai mint to caller
            assert.strictEqual(dDaiMintEvent.address, 'DDAI')
            assert.strictEqual(dDaiMintEvent.eventName, 'Mint')
            assert.strictEqual(
                dDaiMintEvent.returnValues.minter, tester.address
            )
            assert.strictEqual(
                dDaiMintEvent.returnValues.mintTokens,
                cDaiMintEvent.returnValues.mintTokens
            )

            assert.strictEqual(
                dDaiMintEvent.returnValues.mintAmount,
                (web3.utils.toBN(
                    dDaiMintEvent.returnValues.mintTokens
                ).mul(tester.SCALING_FACTOR)).div(dDaiExchangeRate).toString()                
            )

            // Validate dDai transfer to caller
            assert.strictEqual(dDaiTransferEvent.address, 'DDAI')
            assert.strictEqual(dDaiTransferEvent.eventName, 'Transfer')
            assert.strictEqual(
                dDaiTransferEvent.returnValues.from, constants.NULL_ADDRESS
            )
            assert.strictEqual(
                dDaiTransferEvent.returnValues.to, tester.address
            )
            assert.strictEqual(
                dDaiTransferEvent.returnValues.value,
                dDaiMintEvent.returnValues.mintAmount
            )
        }
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

function getExchangeRates(web3) {
    const dDAIExchangeRate = web3.utils.toBN('10000000000000000000000000000');
    const dUSDCExchangeRate = web3.utils.toBN('10000000000000000');
    return {
        "Dharma Dai": {
            notation: "1e28",
            rate: dDAIExchangeRate,
        },
        "Dharma USDC": {
            notation: "1e16",
            rate: dUSDCExchangeRate
        }
    };
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

