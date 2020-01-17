var assert = require('assert')
var fs = require('fs')
var util = require('ethereumjs-util')
const constants = require('./constants.js')

const DharmaDaiArtifact = require('../../build/contracts/DharmaDai.json')
const DharmaUSDCArtifact = require('../../build/contracts/DharmaUSDC.json')
const IERC20Artifact = require('../../build/contracts/ERC20Interface.json')
const ICTokenArtifact = require('../../build/contracts/CTokenInterface.json')

let contractNames = Object.assign({}, constants.CONTRACT_NAMES)

// used to wait for more confirmations
function longer() {
  return new Promise(resolve => {setTimeout(() => {resolve()}, 500)})
}

function sendTransaction(instance, method, args, from, value, gas, gasPrice, transactionShouldSucceed) {
  return instance.methods[method](...args).send({
    from: from,
    value: value,
    gas: gas,
    gasPrice: gasPrice
  }).on('confirmation', (confirmationNumber, r) => {
    confirmations[r.transactionHash] = confirmationNumber
  }).catch(error => {
    if (transactionShouldSucceed) {
      console.error(error)
    }
    return {status: false}
  });
}

async function callMethod(instance, method, args, from, value, gas, gasPrice, callShouldSucceed) {
  let callSucceeded = true;

  const returnValues = await instance.methods[method](...args).call({
    from: from,
    value: value,
    gas: gas,
    gasPrice: gasPrice
  }).catch(error => {
    if (callShouldSucceed) {
      console.error(error)
    }
    callSucceeded = false
  });

  return {callSucceeded, returnValues};
}

module.exports = {test: async function (provider, testingContext) {
  var web3 = provider
  let passed = 0
  let failed = 0
  let gasUsage = {}
  let counts = {}

  const NINE = web3.utils.toBN('9')
  const TEN = web3.utils.toBN('10')
  const SCALING_FACTOR = web3.utils.toBN('1000000000000000000')

  const DAI = new web3.eth.Contract(
    IERC20Artifact.abi, constants.DAI_MAINNET_ADDRESS
  )

  const USDC = new web3.eth.Contract(
    IERC20Artifact.abi, constants.USDC_MAINNET_ADDRESS
  )

  const CDAI = new web3.eth.Contract(
    ICTokenArtifact.abi, constants.CDAI_MAINNET_ADDRESS
  )

  const CUSDC = new web3.eth.Contract(
    ICTokenArtifact.abi, constants.CUSDC_MAINNET_ADDRESS
  )

  const DharmaDaiDeployer = new web3.eth.Contract(DharmaDaiArtifact.abi)
  DharmaDaiDeployer.options.data = DharmaDaiArtifact.bytecode

  const DharmaUSDCDeployer = new web3.eth.Contract(DharmaUSDCArtifact.abi)
  DharmaUSDCDeployer.options.data = DharmaUSDCArtifact.bytecode

  // get available addresses and assign them to various roles
  const addresses = await web3.eth.getAccounts()
  if (addresses.length < 1) {
    console.log('cannot find enough addresses to run tests!')
    process.exit(1)
  }

  let latestBlock = await web3.eth.getBlock('latest')

  const originalAddress = addresses[0]

  let address = await setupNewDefaultAddress(
    '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed'
  )

  let addressTwo = await setupNewDefaultAddress(
    '0xf00df00df00df00df00df00df00df00df00df00df00df00df00df00df00df00d'
  )

  const gasLimit = latestBlock.gasLimit

  console.log('running tests...')

  // ************************** helper functions **************************** //
  async function send(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    transactionShouldSucceed,
    assertionCallback
  ) {
      const receipt = await sendTransaction(instance, method, args, from, value, gas, gasPrice, transactionShouldSucceed);

      const transactionSucceeded = receipt.status;

      if (transactionSucceeded) {
        try {
          assertionCallback(receipt);
        } catch (error) {
          console.log(error);
          return false; // return false if assertions fail and throw an error
        }
      }

      //return true if transaction success matches expectations, false if expectations are mismatched
      return transactionSucceeded === transactionShouldSucceed;
  }

  async function call(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    callShouldSucceed,
    assertionCallback
  ) {
    const {callSucceeded, returnValues} = await callMethod(instance, method, args, from, value, gas, gasPrice, callShouldSucceed);

    //if call succeeds, try assertion callback
    if (callSucceeded) {
      try {
        assertionCallback(returnValues);
      } catch (error) {
        console.log(error);
        return false;
      }
    }

    return callSucceeded === callShouldSucceed;
  }

  async function deploy(
    title,
    instance,
    args,
    from,
    value,
    gas,
    gasPrice,
    shouldSucceed,
    assertionCallback
  ) {
    let deployData = instance.deploy({arguments: args}).encodeABI()
    let deployGas = await web3.eth.estimateGas({
        from: from,
        data: deployData
    }).catch(error => {
      if (shouldSucceed) {
        console.error(error)
      }
      return gasLimit
    })

    if (deployGas > gasLimit) {
      console.error(` ✘ ${title}: deployment costs exceed block gas limit!`)
      process.exit(1)
    }

    if (typeof(gas) === 'undefined') {
      gas = deployGas
    }

    if (deployGas > gas) {
      console.error(` ✘ ${title}: deployment costs exceed supplied gas.`)
      process.exit(1)
    }

    let signed
    let deployHash
    let receipt
    const contract = await instance.deploy({arguments: args}).send({
      from: from,
      gas: gas,
      gasPrice: gasPrice
    }).on('transactionHash', hash => {
      deployHash = hash
    }).on('receipt', r => {
      receipt = r
    }).on('confirmation', (confirmationNumber, r) => {
      confirmations[r.transactionHash] = confirmationNumber
    }).catch(error => {
      if (shouldSucceed) {
        console.error(error)
      }

      receipt = {status: false}
    })

    if (receipt.status !== shouldSucceed) {
      if (contract) {
        return [false, contract, gas]
      }
      return [false, instance, gas]
    } else if (!shouldSucceed) {
      if (contract) {
        return [true, contract, gas]
      }
      return [true, instance, gas]
    }

    assert.ok(receipt.status)

    let assertionsPassed
    try {
      assertionCallback(receipt)
      assertionsPassed = true
    } catch(error) {
      assertionsPassed = false
    }

    if (contract) {
      return [assertionsPassed, contract, gas]
    }
    return [assertionsPassed, instance, gas]
  }

  async function runTest(
    title,
    instance,
    method,
    callOrSend,
    args,
    shouldSucceed,
    assertionCallback,
    from,
    value,
    gas
  ) {
    if (typeof(callOrSend) === 'undefined') {
      callOrSend = 'send'
    }
    if (typeof(args) === 'undefined') {
      args = []
    }
    if (typeof(shouldSucceed) === 'undefined') {
      shouldSucceed = true
    }
    if (typeof(assertionCallback) === 'undefined') {
      assertionCallback = (value) => {}
    }
    if (typeof(from) === 'undefined') {
      from = address
    }
    if (typeof(value) === 'undefined') {
      value = 0
    }
    if (typeof(gas) === 'undefined' && callOrSend !== 'deploy') {
      gas = 6009006
      if (testingContext === 'coverage') {
        gas = gasLimit - 1
      }
    }
    let ok = false
    let contract
    let deployGas
    if (callOrSend === 'send') {
      ok = await send(
        title,
        instance,
        method,
        args,
        from,
        value,
        gas,
        1,
        shouldSucceed,
        assertionCallback
      )
    } else if (callOrSend === 'call') {
      ok = await call(
        title,
        instance,
        method,
        args,
        from,
        value,
        gas,
        1,
        shouldSucceed,
        assertionCallback
      )
    } else if (callOrSend === 'deploy') {
      const fields = await deploy(
        title,
        instance,
        args,
        from,
        value,
        gas,
        1,
        shouldSucceed,
        assertionCallback
      )
      ok = fields[0]
      contract = fields[1]
      deployGas = fields[2]
    } else {
      console.error('must use call, send, or deploy!')
      process.exit(1)
    }

    if (ok) {
      console.log(
        ` ✓ ${
          callOrSend === 'deploy' ? 'successful ' : ''
        }${title}${
          callOrSend === 'deploy' ? ` (${deployGas} gas)` : ''
        }`
      )
      passed++
    } else {
      console.log(
        ` ✘ ${
          callOrSend === 'deploy' ? 'failed ' : ''
        }${title}${
          callOrSend === 'deploy' ? ` (${deployGas} gas)` : ''
        }`
      )
      failed++
    }

    if (contract) {
      return contract
    }
  }

  async function setupNewDefaultAddress(newPrivateKey) {
    const pubKey = await web3.eth.accounts.privateKeyToAccount(newPrivateKey)
    await web3.eth.accounts.wallet.add(pubKey)

    await web3.eth.sendTransaction({
      from: originalAddress,
      to: pubKey.address,
      value: 2 * 10 ** 18,
      gas: '0x5208',
      gasPrice: '0x4A817C800'
    })

    return pubKey.address
  }

  async function raiseGasLimit(necessaryGas) {
    iterations = 9999
    if (necessaryGas > 8000000) {
      console.error('the gas needed is too high!')
      process.exit(1)
    } else if (typeof necessaryGas === 'undefined') {
      iterations = 20
      necessaryGas = 8000000
    }

    // bring up gas limit if necessary by doing additional transactions
    var block = await web3.eth.getBlock("latest")
    while (iterations > 0 && block.gasLimit < necessaryGas) {
      await web3.eth.sendTransaction({
        from: originalAddress,
        to: originalAddress,
        value: '0x01',
        gas: '0x5208',
        gasPrice: '0x4A817C800'
      })
      var block = await web3.eth.getBlock("latest")
      iterations--
    }

    console.log("raising gasLimit, currently at " + block.gasLimit)
    return block.gasLimit
  }

  async function getDeployGas(dataPayload) {
    await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    }).catch(async error => {
      if (
        error.message === (
          'Returned error: gas required exceeds allowance or always failing ' +
          'transaction'
        )
      ) {
        await raiseGasLimit()
        await getDeployGas(dataPayload)
      }
    })

    deployGas = await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    })

    return deployGas
  }

  async function advanceTime(time) {
    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [time],
        id: new Date().getTime()
      },
      (err, result) => {
        if (err) {
          console.error(err)
        } else {
          console.log(' ✓ advanced time by', time, 'seconds')
        }
      }
    )
  }

  const signHashedPrefixedHexString = (hashedHexString, account) => {
    const sig = util.ecsign(
      util.toBuffer(web3.utils.keccak256(
        // prefix => "\x19Ethereum Signed Message:\n32"
        "0x19457468657265756d205369676e6564204d6573736167653a0a3332" +
        hashedHexString.slice(2),
        {encoding: "hex"}
      )),
      util.toBuffer(web3.eth.accounts.wallet[account].privateKey)
    )

    return (
      util.bufferToHex(sig.r) +
      util.bufferToHex(sig.s).slice(2) +
      web3.utils.toHex(sig.v).slice(2)
    )
  }

  const signHashedPrefixedHashedHexString = (hexString, account) => {
    const sig = util.ecsign(
      util.toBuffer(web3.utils.keccak256(
        // prefix => "\x19Ethereum Signed Message:\n32"
        "0x19457468657265756d205369676e6564204d6573736167653a0a3332" +
        web3.utils.keccak256(hexString, {encoding: "hex"}).slice(2),
        {encoding: "hex"}
      )),
      util.toBuffer(web3.eth.accounts.wallet[account].privateKey)
    )

    return (
      util.bufferToHex(sig.r) +
      util.bufferToHex(sig.s).slice(2) +
      web3.utils.toHex(sig.v).slice(2)
    )
  }

  const getEvents = (receipt) => Object.values(receipt.events).map((value) => {
    const log = constants.EVENT_DETAILS[value.raw.topics[0]]   
    return {
      address: contractNames[value.address],
      eventName: log.name,
      returnValues: web3.eth.abi.decodeLog(
        log.abi, value.raw.data, value.raw.topics
      )
    }
  })

  // *************************** deploy contracts *************************** //
  let deployGas
  let selfAddress

  const DharmaDai = await runTest(
    `DharmaDai contract deployment`,
    DharmaDaiDeployer,
    '',
    'deploy'
  )

  contractNames = Object.assign(contractNames, {
    [DharmaDai.options.address]: 'DDAI'
  })

  await runTest(
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

  let cDaiSupplyRate
  await runTest(
    'cDai supply rate can be retrieved',
    CDAI,
    'supplyRatePerBlock',
    'call',
    [],
    true,
    value => {
      cDaiSupplyRate = web3.utils.toBN(value)
    }
  )

  let cDaiExchangeRate
  await runTest(
    'cDai exchange rate can be retrieved',
    CDAI,
    'exchangeRateCurrent',
    'call',
    [],
    true,
    value => {
      cDaiExchangeRate = web3.utils.toBN(value)
    }
  )

  let dDaiSupplyRate = (cDaiSupplyRate.mul(NINE)).div(TEN)
  await runTest(
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

  let dDaiExchangeRate = web3.utils.toBN('10000000000000000000000000000')
  await runTest(
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

  let blockNumber = (await web3.eth.getBlock('latest')).number
  let expectedDDaiExchangeRate = dDaiExchangeRate.add(
    (dDaiExchangeRate.mul(dDaiSupplyRate)).div(SCALING_FACTOR)
  )
  let expectedCDaiExchangeRate = cDaiExchangeRate.add(
    (cDaiExchangeRate.mul(cDaiSupplyRate)).div(SCALING_FACTOR)
  )

  await runTest(
    'Dharma Dai accrueInterest can be triggered correctly from any account',
    DharmaDai,
    'accrueInterest',
    'send',
    [],
    true,
    receipt => {
      assert.strictEqual(receipt.blockNumber, blockNumber + 1)
      if (testingContext !== 'coverage') {
        const events = getEvents(receipt)
     
        assert.strictEqual(events.length, 1)

        assert.strictEqual(events[0].address, 'DDAI')
        assert.strictEqual(events[0].eventName, 'Accrue')
        assert.strictEqual(
          events[0].returnValues.dTokenExchangeRate,
          expectedDDaiExchangeRate.toString()
        )
        assert.strictEqual(
          events[0].returnValues.cTokenExchangeRate,
          expectedCDaiExchangeRate.toString()
        )
      }
    },
    originalAddress
  )

  dDaiExchangeRate = expectedDDaiExchangeRate
  cDaiExchangeRate = expectedCDaiExchangeRate

  await runTest(
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

  await runTest(
    'Dharma Dai supply rate is unchanged after an accrual',
    DharmaDai,
    'supplyRatePerBlock',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, dDaiSupplyRate.toString())
    }
  )

  await runTest(
    'cDai exchange rate is updated correctly',
    CDAI,
    'exchangeRateCurrent',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, cDaiExchangeRate.toString())
    }
  )

  await runTest(
    'cDai supply rate is unchanged after an accrual',
    CDAI,
    'supplyRatePerBlock',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, cDaiSupplyRate.toString())
    }
  )

  const DharmaUSDC = await runTest(
    `DharmaUSDC contract deployment`,
    DharmaUSDCDeployer,
    '',
    'deploy'
  )

  contractNames = Object.assign(contractNames, {
    [DharmaUSDC.options.address]: 'DUSDC'
  })

  console.log(
    `completed ${passed + failed} test${passed + failed === 1 ? '' : 's'} ` +
    `with ${failed} failure${failed === 1 ? '' : 's'}.`
  )

  await longer()

  if (failed > 0) {
    process.exit(1)
  }

  // exit.
  return 0

}}
