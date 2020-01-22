var Web3 = require('web3')
let web3Provider = new Web3('ws://localhost:8555')

// import tests
var deployMockExternal = require('./deployMockExternal.js')

const { runAllTests } = require("./testScenarios");

// run tests
async function runTests(contract, contractName) {
  const context = 'coverage';
  await deployMockExternal.test(web3Provider, context)
  await runAllTests(web3Provider, context, contract, contractName);
}

// "use mocha" ;)
const DharmaDai = artifacts.require("./token/DharmaDai.sol")
contract("DharmaDai", accounts => {
  it("should run all tests", async () => {
  	const instance = await DharmaDai.deployed()
  	await runTests(instance.contract, 'Dharma Dai')
  	//console.log('1')
    return instance
  })
})