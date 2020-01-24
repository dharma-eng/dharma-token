const assert = require('assert');
const { Tester, longer } = require('./test');
const constants = require('./constants.js');

let contractNames = constants.CONTRACT_NAMES;

const tokenSymbols = {
    "Dharma Dai": "dDai",
    "Dharma USDC": "dUSDC"
};

const underlyingSymbols = {
    "Dharma Dai": "Dai",
    "Dharma USDC": "USDC"
};

const underlyingDecimals = {
    "Dharma Dai": 18,
    "Dharma USDC": 6   
}

const cTokenSymbols = {
    "Dharma Dai": "cDai",
    "Dharma USDC": "cUSDC"
};

const DTokenDecimals = 8;

const validateCTokenInterestAccrualEvents = (
    parsedEvents, eventIndex, cTokenSymbol
) => {
    if (cTokenSymbol === 'cDai') {
        // 'suck' on Vat, 'drip' on Pot, 'accrueInterest' on cDai
        const events = parsedEvents.slice(eventIndex, eventIndex + 3)
        assert.strictEqual(events.length, 3)

        assert.strictEqual(events[0].address, 'MKR-VAT')
        assert.strictEqual(events[0].returnValues.caller, 'MKR-VOW')

        assert.strictEqual(events[1].address, 'MKR-POT')
        assert.strictEqual(events[1].returnValues.caller, 'CDAI')

        assert.strictEqual(events[2].address, 'CDAI')
        assert.strictEqual(events[2].eventName, 'AccrueInterest')
    } else {
        // just 'accrueInterest' on cUSDC
        const events = parsedEvents.slice(eventIndex, eventIndex + 1)
        assert.strictEqual(events.length, 1)

        assert.strictEqual(events[0].address, 'CUSDC')
        assert.strictEqual(events[0].eventName, 'AccrueInterest')  
    }
}

const validateDTokenAccrueEvent = (
    parsedEvents, eventIndex, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
) => {
    const accrueEvent = parsedEvents[eventIndex];
    assert.strictEqual(
        accrueEvent.address, tokenSymbols[contractName].toUpperCase()
    )
    assert.strictEqual(accrueEvent.eventName, 'Accrue')
    dTokenExchangeRate = web3.utils.toBN(
        accrueEvent.returnValues.dTokenExchangeRate
    )
    cTokenExchangeRate = web3.utils.toBN(
        accrueEvent.returnValues.cTokenExchangeRate
    )

    cTokenInterest = ((
         cTokenExchangeRate.mul(tester.SCALING_FACTOR)
    ).div(storedCTokenExchangeRate)).sub(tester.SCALING_FACTOR)

    dTokenInterest = (cTokenInterest.mul(tester.NINE)).div(tester.TEN)

    calculatedDTokenExchangeRate = (storedDTokenExchangeRate.mul(
        tester.SCALING_FACTOR.add(dTokenInterest)
    )).div(tester.SCALING_FACTOR)

    assert.strictEqual(
        dTokenExchangeRate.toString(),
        calculatedDTokenExchangeRate.toString()
    )

    return [dTokenExchangeRate, cTokenExchangeRate]
}

const prepareToValidateAccrual = async (web3, dToken) => {
    // dToken ExchangeRate "checkpoint" is stored at slot zero.
    const storedDTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(dToken.options.address, 0)
    )

    // cToken ExchangeRate "checkpoint" is stored at slot one.
    const storedCTokenExchangeRate = web3.utils.toBN(
        await web3.eth.getStorageAt(dToken.options.address, 1)
    )

    const blockNumber = (await web3.eth.getBlock('latest')).number

    return [storedDTokenExchangeRate, storedCTokenExchangeRate, blockNumber]
}

async function runAllTests(web3, context, contractName, contract) {
    let storedDTokenExchangeRate;
    let storedCTokenExchangeRate;
    let blockNumber;

    const tester = new Tester(web3, context);
    await tester.init();

    // Test takeSnapshot and revertToSnapshot
    await testSnapshot(web3, tester);

    const DToken = await getOrDeployDTokenContract(contract, tester, contractName);

    const CToken = contractName === 'Dharma Dai' ? tester.CDAI : tester.CUSDC;

    const Underlying = contractName === 'Dharma Dai' ? tester.DAI : tester.USDC;

    const Uniswap = (
        contractName === 'Dharma Dai' ? tester.UNISWAP_DAI : tester.UNISWAP_USDC
    );

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
        `Accrue ${cTokenSymbols[contractName]} interest`,
        CToken,
        'accrueInterest',
        'send',
        [],
        true,
        receipt => {
            const events = tester.getEvents(receipt, contractNames)

            validateCTokenInterestAccrualEvents(
                events, 0, cTokenSymbols[contractName]
            )
        }
    )

    let cTokenSupplyRate;
    await tester.runTest(
        `${cTokenSymbols[contractName]} supply rate can be retrieved`,
        CToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            cTokenSupplyRate = web3.utils.toBN(value)
        }
    )

    let dTokenSupplyRate = (cTokenSupplyRate.mul(tester.NINE)).div(tester.TEN)
    await tester.runTest(
        `${contractName} supply rate starts at 90% of ${cTokenSymbols[contractName]} supply rate`,
        DToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, dTokenSupplyRate.toString())
        }
    )

    let cTokenExchangeRate;
    await tester.runTest(
        `${cTokenSymbols[contractName]} exchange rate can be retrieved`,
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
    );

    [
        storedDTokenExchangeRate, storedCTokenExchangeRate, blockNumber
    ] = await prepareToValidateAccrual(web3, DToken)

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

            assert.strictEqual(events.length, 1);

            [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
                events, 0, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
            );
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
            dTokenSupplyRate = value
        }
    )

    await tester.runTest(
        `${cTokenSymbols[contractName]} exchange rate is updated correctly`,
        CToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cTokenExchangeRate.toString())
        }
    )

    await tester.runTest(
        `${cTokenSymbols[contractName]} supply rate is unchanged after ${tokenSymbols[contractName]} accrual (as it did not accrue)`,
        CToken,
        'supplyRatePerBlock',
        'call',
        [],
        true,
        value => {
            assert.strictEqual(value, cTokenSupplyRate.toString())
        }
    );

    [
        storedDTokenExchangeRate, storedCTokenExchangeRate, blockNumber
    ] = await prepareToValidateAccrual(web3, DToken)

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

            const transferEvent = events[1];
            const collectSurplusEvent = events[2];

            // Ensure that accrual is performed correctly
            [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
                events, 0, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
            );

            // Ensure that cToken transfer of 0 tokens is performed correctly
            assert.strictEqual(
                transferEvent.address, cTokenSymbols[contractName].toUpperCase()
            );
            assert.strictEqual(transferEvent.eventName, 'Transfer');
            assert.strictEqual(
                transferEvent.returnValues.from, DToken.options.address
            )
            assert.strictEqual(
                transferEvent.returnValues.to, constants.VAULT_MAINNET_ADDRESS
            )
            assert.strictEqual(transferEvent.returnValues.value, '0')

            // Ensure that CollectSurplus of 0, 0 is performed correctly
            assert.strictEqual(
                collectSurplusEvent.address,
                tokenSymbols[contractName].toUpperCase()
            );
            assert.strictEqual(collectSurplusEvent.eventName, 'CollectSurplus');
            assert.strictEqual(
                collectSurplusEvent.returnValues.surplusAmount, '0'
            )
            assert.strictEqual(
                collectSurplusEvent.returnValues.surplusCTokens, '0'
            )
        },
    )

    // Get some underlying tokens from Uniswap
    let priceOfOneHundredUnderlying;
    await tester.runTest(
        `Get the price of 100 ${underlyingSymbols[contractName]} from Uniswap`,
        Uniswap,
        'getEthToTokenOutputPrice',
        'call',
        ['1'.padEnd(underlyingDecimals[contractName] + 3, '0')],
        true,
        value => {
            priceOfOneHundredUnderlying = value
        },
    )

    await tester.runTest(
        `Get 100 ${underlyingSymbols[contractName]} from Uniswap`,
        Uniswap,
        'ethToTokenSwapOutput',
        'send',
        ['1'.padEnd(underlyingDecimals[contractName] + 3, '0'), '9999999999'],
        true,
        receipt => {},
        tester.address,
        priceOfOneHundredUnderlying
    )

    await tester.runTest(
        `Check that we now have 100 ${underlyingSymbols[contractName]}`,
        Underlying,
        'balanceOf',
        'call',
        [tester.address],
        true,
        value => {
            assert.strictEqual(
                value, '1'.padEnd(underlyingDecimals[contractName] + 3, '0')
            )
        },
    )

    await tester.runTest(
        `${contractName} cannot mint dTokens without prior approval`,
        DToken,
        'mint',
        'send',
        ['1'.padEnd(underlyingDecimals[contractName] + 1, '0')],
        false
    )

    await tester.runTest(
        `${underlyingSymbols[contractName]} can approve ${contractName} in order to mint dTokens`,
        Underlying,
        'approve',
        'send',
        [DToken.options.address, constants.FULL_APPROVAL]
    )

    await tester.runTest(
        `${contractName} can get dToken exchange rate`,
        DToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            dTokenExchangeRate = web3.utils.toBN(value)    
        }
    )

    await tester.runTest(
        `${cTokenSymbols[contractName]} exchange rate can be retrieved`,
        CToken,
        'exchangeRateCurrent',
        'call',
        [],
        true,
        value => {
            cTokenExchangeRate = web3.utils.toBN(value)
        }
    )

    async function testMint() {
        let totalDTokensMinted;

        await tester.runTest(
            `${tokenSymbols[contractName]} total supply is 0 before mint`,
            DToken,
            'totalSupply',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, '0')
            }
        );

        await tester.runTest(
            `${tokenSymbols[contractName]} total underlying supply is 0 before mint`,
            DToken,
            'totalSupplyUnderlying',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, '0')
            }
        );

        [
            storedDTokenExchangeRate,
            storedCTokenExchangeRate,
            blockNumber
        ] = await prepareToValidateAccrual(web3, DToken);

        await tester.runTest(
            `${contractName} can mint dTokens`,
            DToken,
            'mint',
            'send',
            ['1'.padEnd(underlyingDecimals[contractName] + 1, '0')],
            true,
            receipt => {
                const extraEvents = contractName === 'Dharma Dai' ? 7 : 0

                const events = tester.getEvents(receipt, contractNames)
                assert.strictEqual(events.length, 8 + extraEvents)

                // important events - validate in full after the ancillary ones
                const underlyingTransferInEvent = events[0]
                // note: cUSDC & cDai emit transfer / mint events in opposite order
                const cTokenMintEvent = events[3 + extraEvents]
                const cTokenTransferEvent = events[4 + extraEvents];
                const dTokenAccrueEvent = events[5 + extraEvents];
                [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
                    events, 5 + extraEvents, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
                );

                const dTokenMintEvent = events[6 + extraEvents]
                const dTokenTransferEvent = events[7 + extraEvents]

                validateCTokenInterestAccrualEvents(
                    events, 1, cTokenSymbols[contractName]
                )

                // ancillary events - partial validation ok (mostly cDai-specific)
                if (contractName === 'Dharma Dai') {
                    // (transfer from dDai to DSR)
                    assert.strictEqual(events[4].address, 'DAI')
                    assert.strictEqual(events[4].eventName, 'Transfer')
                    assert.strictEqual(
                        events[4].returnValues.from, DToken.options.address
                    )
                    // to -> Dai Join
                    assert.strictEqual(
                        events[4].returnValues.value,
                        '1'.padEnd(underlyingDecimals[contractName] + 1, '0')
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
                        events[6].returnValues.value,
                        '1'.padEnd(underlyingDecimals[contractName] + 1, '0')
                    )

                    assert.strictEqual(events[7].address, 'MKR-DAI-JOIN')
                    assert.strictEqual(events[7].returnValues.caller, 'CDAI')

                    assert.strictEqual(events[8].address, 'MKR-VAT')
                    assert.strictEqual(events[8].returnValues.caller, 'CDAI')

                    assert.strictEqual(events[9].address, 'MKR-POT')
                    assert.strictEqual(events[9].returnValues.caller, 'CDAI')
                } else {
                    // (transfer from dUSDC to cUSDC)
                    assert.strictEqual(events[2].address, 'USDC')
                    assert.strictEqual(events[2].eventName, 'Transfer')
                    assert.strictEqual(
                        events[2].returnValues.from, DToken.options.address
                    )
                    assert.strictEqual(
                        events[2].returnValues.to, CToken.options.address
                    )
                    assert.strictEqual(
                        events[2].returnValues.value,
                        '1'.padEnd(underlyingDecimals[contractName] + 1, '0')
                    )
                }

                // Validate initial transfer in to dToken of 1 underlying
                assert.strictEqual(
                    underlyingTransferInEvent.address,
                    underlyingSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(underlyingTransferInEvent.eventName, 'Transfer')
                assert.strictEqual(
                    underlyingTransferInEvent.returnValues.from, tester.address
                )
                assert.strictEqual(
                    underlyingTransferInEvent.returnValues.to, DToken.options.address
                )
                assert.strictEqual(
                    underlyingTransferInEvent.returnValues.value,
                    '1'.padEnd(underlyingDecimals[contractName] + 1, '0')
                )

                // Validate cToken mint to dToken
                assert.strictEqual(
                    cTokenMintEvent.address, cTokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(cTokenMintEvent.eventName, 'Mint')
                assert.strictEqual(
                    cTokenMintEvent.returnValues.minter, DToken.options.address
                )
                assert.strictEqual(
                    cTokenMintEvent.returnValues.mintTokens,
                    '1'.padEnd(underlyingDecimals[contractName] + 1, '0')
                )
                // note: mint amount is checked after parsing dToken accrual event

                // Validate cToken transfer to dToken
                assert.strictEqual(
                    cTokenTransferEvent.address, cTokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(cTokenTransferEvent.eventName, 'Transfer')
                assert.strictEqual(
                    cTokenTransferEvent.returnValues.from, CToken.options.address
                )
                assert.strictEqual(
                    cTokenTransferEvent.returnValues.to, DToken.options.address
                )
                assert.strictEqual(
                    cTokenTransferEvent.returnValues.value,
                    cTokenMintEvent.returnValues.mintAmount
                )

                // Validate dToken accrue event
                assert.strictEqual(
                    dTokenAccrueEvent.address, tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(dTokenAccrueEvent.eventName, 'Accrue')
                dTokenExchangeRate = web3.utils.toBN(
                    dTokenAccrueEvent.returnValues.dTokenExchangeRate
                )
                cTokenExchangeRate = web3.utils.toBN(
                    dTokenAccrueEvent.returnValues.cTokenExchangeRate
                )

                cTokenInterest = ((
                    cTokenExchangeRate.mul(tester.SCALING_FACTOR)
                ).div(storedCTokenExchangeRate)).sub(tester.SCALING_FACTOR)

                dTokenInterest = (cTokenInterest.mul(tester.NINE)).div(tester.TEN)

                calculatedDTokenExchangeRate = (storedDTokenExchangeRate.mul(
                    tester.SCALING_FACTOR.add(dTokenInterest)
                )).div(tester.SCALING_FACTOR)

                assert.strictEqual(
                    dTokenExchangeRate.toString(),
                    calculatedDTokenExchangeRate.toString()
                )

                assert.strictEqual(
                    cTokenMintEvent.returnValues.mintAmount,
                    (web3.utils.toBN(
                        cTokenMintEvent.returnValues.mintTokens
                    ).mul(tester.SCALING_FACTOR)).div(cTokenExchangeRate).toString()
                )

                // Validate dToken mint to caller
                assert.strictEqual(
                    dTokenMintEvent.address, tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(dTokenMintEvent.eventName, 'Mint')
                assert.strictEqual(
                    dTokenMintEvent.returnValues.minter, tester.address
                )
                assert.strictEqual(
                    dTokenMintEvent.returnValues.mintTokens,
                    cTokenMintEvent.returnValues.mintTokens
                )

                assert.strictEqual(
                    dTokenMintEvent.returnValues.mintAmount,
                    (web3.utils.toBN(
                        dTokenMintEvent.returnValues.mintTokens
                    ).mul(tester.SCALING_FACTOR)).div(dTokenExchangeRate).toString()
                )

                totalDTokensMinted = dTokenMintEvent.returnValues.mintAmount

                // Validate dToken transfer to caller
                assert.strictEqual(
                    dTokenTransferEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(dTokenTransferEvent.eventName, 'Transfer')
                assert.strictEqual(
                    dTokenTransferEvent.returnValues.from, constants.NULL_ADDRESS
                )
                assert.strictEqual(
                    dTokenTransferEvent.returnValues.to, tester.address
                )
                assert.strictEqual(
                    dTokenTransferEvent.returnValues.value,
                    dTokenMintEvent.returnValues.mintAmount
                )
            }
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
            `${cTokenSymbols[contractName]} exchange rate is updated correctly`,
            CToken,
            'exchangeRateCurrent',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, cTokenExchangeRate.toString())
            }
        )

        await tester.runTest(
            `${tokenSymbols[contractName]} total supply is correct after mint`,
            DToken,
            'totalSupply',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, totalDTokensMinted)
            }
        )

        const totalSupply = web3.utils.toBN(totalDTokensMinted);
        const exchangeRate = web3.utils.toBN(dTokenExchangeRate);
        const expectedTotalSupplyUnderlying = (totalSupply.mul(exchangeRate)).div(tester.SCALING_FACTOR);
        await tester.runTest(
            `${tokenSymbols[contractName]} total underlying supply is correct after mint`,
            DToken,
            'totalSupplyUnderlying',
            'call',
            [],
            true,
            value => {
                assert.strictEqual(value, expectedTotalSupplyUnderlying.toString())
            }
        )
    }

    async function testTransfer() {
        const snapshot = await tester.takeSnapshot();
        const { result: snapshotId } = snapshot;

        let transferAmount;
        await tester.runTest(
            `Get total ${tokenSymbols[contractName]} balance for transfer`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                transferAmount = value.toString()
            },
        )

        await tester.runTest(
            `${contractName} can transfer dTokens`,
            DToken,
            'transfer',
            'send',
            [tester.addressTwo, transferAmount],
            true,
            receipt => {
                const events = tester.getEvents(receipt, contractNames);
                assert.strictEqual(events.length, 1);

                const dTokenTransferEvent = events[0];

                assert.strictEqual(
                    dTokenTransferEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(dTokenTransferEvent.eventName, 'Transfer');

                const { returnValues: transferReturnValues } = dTokenTransferEvent;

                assert.strictEqual(transferReturnValues.from, tester.address);
                assert.strictEqual(transferReturnValues.to, tester.addressTwo);
                assert.strictEqual(transferReturnValues.value, transferAmount);


            }
        );

        await tester.runTest(
            `Check transfer recipient received correct amount`,
            DToken,
            'balanceOf',
            'call',
            [tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, transferAmount);
            },
        )

        await tester.revertToSnapShot(snapshotId);
    }

    async function testTransferFrom() {
        const snapshot = await tester.takeSnapshot();
        const { result: snapshotId } = snapshot;

        let transferAmount;
        await tester.runTest(
            `Get total ${tokenSymbols[contractName]} balance for transfer`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                transferAmount = value.toString()
            },
        );

        await tester.runTest(
            `${contractName} can increase dTokens allowance`,
            DToken,
            'increaseAllowance',
            'send',
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
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, transferAmount);
            }
        );

        await tester.runTest(
            `${contractName} can transferFrom dTokens`,
            DToken,
            'transferFrom',
            'send',
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
                )
                assert.strictEqual(dTokenTransferEvent.eventName, 'Transfer');

                const { returnValues: transferReturnValues } = dTokenTransferEvent;

                assert.strictEqual(transferReturnValues.from, tester.address);
                assert.strictEqual(transferReturnValues.to, tester.addressTwo);
                assert.strictEqual(transferReturnValues.value, transferAmount);


                // Approval Event
                const approvalEvent = events[1];
                assert.strictEqual(
                    approvalEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, '0');

            },
            tester.addressTwo
        );

        await tester.runTest(
            `Check transfer sender sent correct amount`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(value, '0');
            },
        );

        await tester.runTest(
            `Check transfer recipient received correct amount`,
            DToken,
            'balanceOf',
            'call',
            [tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, transferAmount);
            },
        )

        await tester.runTest(
            `Check transfer recipient has correct allowance`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, '0');
            },
        )

        await tester.revertToSnapShot(snapshotId);
    }

    async function testTransferUnderlying() {
        const snapshot = await tester.takeSnapshot();
        const { result: snapshotId } = snapshot;

        let balance;
        await tester.runTest(
            `Get total ${tokenSymbols[contractName]} balance for transfer`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                balance = web3.utils.toBN(value.toString())
            },
        );

        [
            storedDTokenExchangeRate,
            storedCTokenExchangeRate,
            blockNumber
        ] = await prepareToValidateAccrual(web3, DToken);

        const expectedUnderlyingAmount = (
            balance.mul(storedDTokenExchangeRate)
        ).div(tester.SCALING_FACTOR);

        let initialUnderlyingAmount;
        await tester.runTest(
            `Get total underlying ${underlyingSymbols[contractName]} balance`,
            DToken,
            'balanceOfUnderlying',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(value, expectedUnderlyingAmount.toString());
                initialUnderlyingAmount = web3.utils.toBN(value.toString())
            },
        );

        let dTokenExchangeRate;
        let leftOverBalance;
        let dTokentransferAmount;
        await tester.runTest(
            `${contractName} can transfer underlying`,
            DToken,
            'transferUnderlying',
            'send',
            [tester.addressTwo, initialUnderlyingAmount.toString()],
            true,
            receipt => {
                const events = tester.getEvents(receipt, contractNames);

                assert.strictEqual(events.length, 2);

                [dTokenExchangeRate] = validateDTokenAccrueEvent(
                    events, 0, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
                );

                dTokentransferAmount = (initialUnderlyingAmount.mul(tester.SCALING_FACTOR)).div(dTokenExchangeRate);

                leftOverBalance = balance.sub(dTokentransferAmount)

                const tokenTransferEvent = events[1];
                assert.strictEqual(
                    tokenTransferEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                );
                assert.strictEqual(tokenTransferEvent.eventName, 'Transfer');

                const { returnValues: transferReturnValues } = tokenTransferEvent;

                assert.strictEqual(transferReturnValues.from, tester.address);
                assert.strictEqual(transferReturnValues.to, tester.addressTwo);
                assert.strictEqual(transferReturnValues.value, dTokentransferAmount.toString());
            }
        );

        await tester.runTest(
            `${contractName} balance is reduced by expected amount`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(value, leftOverBalance.toString())
            }
        );

        const underlyingAmountTransfered = (dTokentransferAmount.mul(dTokenExchangeRate)).div(tester.SCALING_FACTOR);

        await tester.runTest(
            `Check transfer recipient received correct amount`,
            DToken,
            'balanceOfUnderlying',
            'call',
            [tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, underlyingAmountTransfered.toString());
            },
        );

        const leftOverUnderlying = (
            leftOverBalance.mul(dTokenExchangeRate)
        ).div(tester.SCALING_FACTOR);

        await tester.runTest(
            `Check transfer sender has correct balance`,
            DToken,
            'balanceOfUnderlying',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(value, leftOverUnderlying.toString());
            },
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
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                balanceAmount = web3.utils.toBN(value)
            },
        );

        let transferUnderlyingAmount;
        await tester.runTest(
            `Get an underlying ${underlyingSymbols[contractName]} account balance`,
            DToken,
            'balanceOfUnderlying',
            'call',
            [tester.address],
            true,
            value => {
                transferUnderlyingAmount = web3.utils.toBN(value)
            },
        );

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
        );

        assert.strictEqual(
            transferUnderlyingAmount.toString(),
            (
                balanceAmount.mul(dTokenExchangeRate)
            ).div(tester.SCALING_FACTOR).toString()
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
            'increaseAllowance',
            'send',
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
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, dTokenAllowance.toString());
            }
        );

        let approvedAllowance;
        let calculatedTransferAmount;
        await tester.runTest(
            `${contractName} can transferUnderlyingFrom dTokens`,
            DToken,
            'transferUnderlyingFrom',
            'send',
            [tester.address, tester.addressTwo, transferUnderlyingAmount.toString()],
            true,
            receipt => {
                const events = tester.getEvents(receipt, contractNames);

                assert.strictEqual(events.length, 3);

                [dTokenExchangeRate, cTokenExchangeRate] = validateDTokenAccrueEvent(
                    events, 0, contractName, web3, tester, storedDTokenExchangeRate, storedCTokenExchangeRate
                );

                // Transfer Event
                const dTokenTransferEvent = events[1];

                assert.strictEqual(
                    dTokenTransferEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(dTokenTransferEvent.eventName, 'Transfer');

                const { returnValues: transferReturnValues } = dTokenTransferEvent;

                calculatedTransferAmount = (
                    transferUnderlyingAmount.mul(tester.SCALING_FACTOR)
                ).div(dTokenExchangeRate);

                assert.strictEqual(transferReturnValues.from, tester.address);
                assert.strictEqual(transferReturnValues.to, tester.addressTwo);
                assert.strictEqual(transferReturnValues.value, calculatedTransferAmount.toString());


                // Approval Event
                const approvalEvent = events[2];
                assert.strictEqual(
                    approvalEvent.address,
                    tokenSymbols[contractName].toUpperCase()
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                approvedAllowance = dTokenAllowance.sub(calculatedTransferAmount);

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, approvedAllowance.toString());

            },
            tester.addressTwo
        );


        /*
        await tester.runTest(
            `Transfer cleared the account`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                assert.strictEqual(value, "0");
            },
        );
        */

        await tester.runTest(
            `Check transfer recipient received correct amount`,
            DToken,
            'balanceOf',
            'call',
            [tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, calculatedTransferAmount.toString());
            },
        )

        await tester.runTest(
            `Check transfer recipient has correct allowance`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, approvedAllowance.toString());
            },
        )

        await tester.revertToSnapShot(snapshotId);
    }

    async function testAllowance() {
        const snapshot = await tester.takeSnapshot();
        const { result: snapshotId } = snapshot;

        await tester.runTest(
            `Get ${tokenSymbols[contractName]} allowance`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, '0');
            },
        );

        let allowanceAmount;
        await tester.runTest(
            `Get total ${tokenSymbols[contractName]} balance`,
            DToken,
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                allowanceAmount = value.toString()
            },
        );

        await tester.runTest(
            `${contractName} can increase dTokens allowance`,
            DToken,
            'increaseAllowance',
            'send',
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
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, allowanceAmount);
            }
        );

        await tester.runTest(
            `Get ${tokenSymbols[contractName]} allowance`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, allowanceAmount);
            },
        );

        await tester.runTest(
            `${contractName} can decrease dTokens allowance`,
            DToken,
            'decreaseAllowance',
            'send',
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
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, '0');
            }
        );

        await tester.runTest(
            `Get ${tokenSymbols[contractName]} allowance`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, '0');
            },
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
            'balanceOf',
            'call',
            [tester.address],
            true,
            value => {
                approveAmount = value.toString()
            },
        );

        await tester.runTest(
            `${contractName} can approve dToken allowance`,
            DToken,
            'approve',
            'send',
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
                )
                assert.strictEqual(approvalEvent.eventName, 'Approval');

                const { returnValues: approvalReturnValues } = approvalEvent;

                assert.strictEqual(approvalReturnValues.owner, tester.address);
                assert.strictEqual(approvalReturnValues.spender, tester.addressTwo);
                assert.strictEqual(approvalReturnValues.value, approveAmount);
            }
        );

        await tester.runTest(
            `Check ${tokenSymbols[contractName]} allowance is set correctly after approve`,
            DToken,
            'allowance',
            'call',
            [tester.address, tester.addressTwo],
            true,
            value => {
                assert.strictEqual(value, approveAmount);
            },
        );

        await tester.revertToSnapShot(snapshotId);
    }

    async function testSpreadPerBlock() {
        const snapshot = await tester.takeSnapshot();
        const { result: snapshotId } = snapshot;
        await tester.runTest(
            `${contractName} spread per block is 10% of ${cTokenSymbols[contractName]} supply rate per block`,
            DToken,
            'getSpreadPerBlock',
            'call',
            [],
            true,
            async value =>  {
                await tester.revertToSnapShot(snapshotId);

                let cTokenSupplyRate;
                await tester.runTest(
                    `${cTokenSymbols[contractName]} supply rate can be retrieved`,
                    CToken,
                    'supplyRatePerBlock',
                    'call',
                    [],
                    true,
                    value => {
                        cTokenSupplyRate = web3.utils.toBN(value)
                    }
                );

                let dTokenSpreadPerBlock = cTokenSupplyRate.div(tester.TEN);
                assert.strictEqual(value, dTokenSpreadPerBlock.toString())
            }
        );
        await tester.revertToSnapShot(snapshotId);
    }


    await testMint();
    await testTransfer();
    await testTransferFrom();
    await testAllowance();
    await testTransferUnderlying();
    await testTransferUnderlyingFrom();
    await testApprove();
    await testSpreadPerBlock();


    console.log(
        `completed ${tester.passed + tester.failed} test${tester.passed + tester.failed === 1 ? '' : 's'} ` +
        `on the ${tokenSymbols[contractName]} contract with ${tester.failed} failure${tester.failed === 1 ? '' : 's'}.`
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

