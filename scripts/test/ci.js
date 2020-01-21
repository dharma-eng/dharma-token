const connectionConfig = require('../../truffle-config.js');

const connection = connectionConfig.networks['development'];

let web3Provider = connection.provider;

// import tests
var deployMockExternal = require('./deployMockExternal.js');

const { runAllTests } = require("./testScenarios");

// run tests
async function runTests() {
	await deployMockExternal.test(web3Provider, 'development');
    await runAllTests();
	process.exit(0)
}

runTests();
