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
const DharmaDai = artifacts.require("./token/DharmaDai.sol")
const DharmaUSDC = artifacts.require("./token/DharmaUSDC.sol")

contract("DharmaDai", accounts => {
  it("should run all tests for Dharma Dai", async () => {
  	const instance = await DharmaDai.deployed()
  	await runTests(instance.contract, 'Dharma Dai')
    return instance
  })
})

contract("DharmaUSDC", accounts => {
  it("should run all tests for Dharma USDC", async () => {
  	const instance = await DharmaUSDC.deployed()
  	await runTests(instance.contract, 'Dharma USDC')
    return instance
  })
})