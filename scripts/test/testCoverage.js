var Web3 = require('web3')
let web3Provider = new Web3('ws://localhost:8555')

// import tests
var deployMockExternal = require('./deployMockExternal.js')

const { runAllTests } = require("./testScenarios");

// run tests
async function runTests() {
  const context = 'coverage';

  await deployMockExternal.test(web3Provider, context)
  await runAllTests(web3Provider, context);
  process.exit(0)
}

runTests()
