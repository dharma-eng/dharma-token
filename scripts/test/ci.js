const connectionConfig = require('../../truffle-config.js');

const connection = connectionConfig.networks['development'];

let web3Provider = connection.provider;

// import tests
var deployMockExternal = require('./deployMockExternal.js');

const { runAllTests } = require("./testScenarios");

// run tests
async function runTests() {
    const context = 'development';

	await deployMockExternal.test(web3Provider, context);
    await runAllTests(context);
	process.exit(0)
}

runTests();
