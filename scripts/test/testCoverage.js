var Web3 = require('web3')
let web3Provider = new Web3('ws://localhost:8555')

// import tests
var deployMockExternal = require('./deployMockExternal.js')

const { runAllTests } = require("./testScenarios");

// run tests
async function runTests(contract, contractName) {
  const context = 'coverage';
  await deployMockExternal.test(web3Provider, context)
  await runAllTests(web3Provider, context, contractName, contract);
}

// "use mocha" ;)
const DharmaDai = artifacts.require("./token/DharmaDaiImplementationV1.sol")
const DharmaUSDC = artifacts.require("./token/DharmaUSDCImplementationV1.sol")

const DharmaDaiInitializer = artifacts.require("./token/DharmaDaiInitializer.sol")
const DharmaUSDCInitializer = artifacts.require("./token/DharmaUSDCInitializer.sol")

const HelperTester = artifacts.require("./test/HelperTester.sol")

contract("DharmaDaiInitializer", accounts => {
  it("should be able to initialize Dharma Dai", async () => {
    const instance = await DharmaDaiInitializer.deployed()
    await instance.methods['initialize()'].sendTransaction()
    return instance
  })
})

contract("DharmaDai", accounts => {
  it("should run all tests for Dharma Dai", async () => {
  	const instance = await DharmaDai.deployed()
  	await runTests(instance.contract, 'Dharma Dai')
    return instance
  })
})

contract("DharmaUSDCInitializer", accounts => {
  it("should be able to initialize Dharma USD Coin", async () => {
    const instance = await DharmaUSDCInitializer.deployed()
    await instance.methods['initialize()'].sendTransaction()
    return instance
  })
})

contract("DharmaUSDC", accounts => {
  it("should run all tests for Dharma USD Coin", async () => {
  	const instance = await DharmaUSDC.deployed()
  	await runTests(instance.contract, 'Dharma USD Coin')
    return instance
  })
})

contract("HelperTester", accounts => {
  it("should run tests against the helper tester contract", async () => {
    const instance = await HelperTester.deployed()
    await instance.methods['test()'].sendTransaction()
    return instance
  })
})