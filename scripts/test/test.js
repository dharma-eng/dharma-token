var assert = require('assert');
const constants = require('./constants.js');

// artifacts: compiled contracts
// abi + contract
const DharmaDaiArtifact = require('../../build/contracts/DharmaDai.json');
const DharmaUSDCArtifact = require('../../build/contracts/DharmaUSDC.json');
// abi
const IERC20Artifact = require('../../build/contracts/ERC20Interface.json');
const ICTokenArtifact = require('../../build/contracts/CTokenInterface.json');

// used to wait for more confirmations
function longer() {
  return new Promise(resolve => {setTimeout(() => {resolve()}, 500)})
}

class Tester {

    constructor(provider, testingContext) {
        this.web3 = provider;
        this.context = testingContext;
        this.failed = 0;
        this.passed = 0;
        this.SCALING_FACTOR = this.web3.utils.toBN('1000000000000000000');
        this.NINE = this.web3.utils.toBN('9');
        this.TEN = this.web3.utils.toBN('10');
    }

    async init() {
        const DharmaDaiDeployer = new this.web3.eth.Contract(DharmaDaiArtifact.abi);
        DharmaDaiDeployer.options.data = DharmaDaiArtifact.bytecode;
        this.DharmaDaiDeployer = DharmaDaiDeployer;

        const DharmaUSDCDeployer = new this.web3.eth.Contract(DharmaUSDCArtifact.abi);
        DharmaUSDCDeployer.options.data = DharmaUSDCArtifact.bytecode;
        this.DharmaUSDCDeployer = DharmaUSDCDeployer;

        this.DAI = new this.web3.eth.Contract(
            IERC20Artifact.abi, constants.DAI_MAINNET_ADDRESS
        );

        this.USDC = new this.web3.eth.Contract(
            IERC20Artifact.abi, constants.USDC_MAINNET_ADDRESS
        );

        this.CDAI = new this.web3.eth.Contract(
            ICTokenArtifact.abi, constants.CDAI_MAINNET_ADDRESS
        );

        this.CUSDC = new this.web3.eth.Contract(
            ICTokenArtifact.abi, constants.CUSDC_MAINNET_ADDRESS
        );

        const addresses = await this.web3.eth.getAccounts();
        if (addresses.length < 1) {
            console.log('cannot find enough addresses to run tests!');
            process.exit(1);
        }

        this.originalAddress = addresses[0];

        this.address = await this.setupNewDefaultAddress(
            '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed'
        );

        this.addressTwo = await this.setupNewDefaultAddress(
            '0xf00df00df00df00df00df00df00df00df00df00df00df00df00df00df00df00d'
        );

        let latestBlock = await this.web3.eth.getBlock('latest');

        this.gasLimit = latestBlock.gasLimit
    }

    async setupNewDefaultAddress(newPrivateKey) {
        const pubKey = await this.web3.eth.accounts.privateKeyToAccount(newPrivateKey);
        await this.web3.eth.accounts.wallet.add(pubKey);

        await this.web3.eth.sendTransaction({
            from: this.originalAddress,
            to: pubKey.address,
            value: 2 * 10 ** 18,
            gas: '0x5208',
            gasPrice: '0x4A817C800'
        });

        return pubKey.address
    }

    async sendTransaction(
        instance,
        method,
        args,
        from,
        value,
        gas,
        gasPrice,
        transactionShouldSucceed
    ) {
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

    async callMethod(
        instance,
        method,
        args,
        from,
        value,
        gas,
        gasPrice,
        callShouldSucceed) {
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

    async send(
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
        const receipt = await this.sendTransaction(
            instance,
            method,
            args,
            from,
            value,
            gas,
            gasPrice,
            transactionShouldSucceed
        );

        const transactionSucceeded = receipt.status;

        let assertionsPassed;

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

    async call(
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
        const {callSucceeded, returnValues} = await this.callMethod(instance, method, args, from, value, gas, gasPrice, callShouldSucceed);

        // if call succeeds, try assertion callback
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

    // immediately redeem -- requires we deploy a test contract to enable this.
    // for example in the constructor run the mint -> redeem, if the deployment fails then the test failed
    async deploy(
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
        let deployData = instance.deploy({arguments: args}).encodeABI();
        let deployGas = await this.web3.eth.estimateGas({
            from: from,
            data: deployData
        }).catch(error => {
            if (shouldSucceed) {
                console.error(error)
            }
            return this.gasLimit
        });

        if (deployGas > this.gasLimit) {
            console.error(` ✘ ${title}: deployment costs exceed block gas limit!`);
            process.exit(1);
        }

        if (typeof(gas) === 'undefined') {
            gas = deployGas;
        }

        if (deployGas > gas) {
            console.error(` ✘ ${title}: deployment costs exceed supplied gas.`);
            process.exit(1);
        }

        let signed;
        let deployHash;
        let receipt;
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
        });

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

        assert.ok(receipt.status);

        let assertionsPassed;
        try {
            assertionCallback(receipt);
            assertionsPassed = true
        } catch(error) {
            assertionsPassed = false
        }

        if (contract) {
            return [assertionsPassed, contract, gas]
        }
        return [assertionsPassed, instance, gas]
    }

    /* aggregates the first 3 functions
     * run test without coverage, once they're passing then run with coverage
     * coverage changes the gas -- orders of magnitued more expensive
     * any test that are gas dependent get grilled under coverage test
     *
     *
     * default: send
     */
    async runTest(
        title,
        instance,
        method,
        callOrSendOrDeploy,
        args,
        shouldSucceed,
        assertionCallback,
        from,
        value,
        gas
    ) {
        if (typeof(callOrSendOrDeploy) === 'undefined') {
            callOrSendOrDeploy = 'send'
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
            from = this.address
        }
        if (typeof(value) === 'undefined') {
            value = 0
        }
        if (typeof(gas) === 'undefined' && callOrSendOrDeploy !== 'deploy') {
            gas = 6009006;
            if (this.context === 'coverage') {
                gas = gasLimit - 1
            }
        }
        let ok = false
        let contract
        let deployGas
        if (callOrSendOrDeploy === 'send') {
            ok = await this.send(
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
        } else if (callOrSendOrDeploy === 'call') {
            ok = await this.call(
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
        } else if (callOrSendOrDeploy === 'deploy') {
            const fields = await this.deploy(
                title,
                instance,
                args,
                from,
                value,
                gas,
                1,
                shouldSucceed,
                assertionCallback
            );
            ok = fields[0];
            contract = fields[1];
            deployGas = fields[2]
        } else {
            console.error('must use call, send, or deploy!');
            process.exit(1)
        }

        if (ok) {
            console.log(
                ` ✓ ${
                    callOrSendOrDeploy === 'deploy' ? 'successful ' : ''
                    }${title}${
                    callOrSendOrDeploy === 'deploy' ? ` (${deployGas} gas)` : ''
                    }`
            );
            this.passed++
        } else {
            console.log(
                ` ✘ ${
                    callOrSendOrDeploy === 'deploy' ? 'failed ' : ''
                    }${title}${
                    callOrSendOrDeploy === 'deploy' ? ` (${deployGas} gas)` : ''
                    }`
            );
            this.failed++
        }

        if (contract) {
            return contract
        }
    }

    getEvents(receipt, contractNames) {
        return Object.values(receipt.events).map((value) => {
            const log = constants.EVENT_DETAILS[value.raw.topics[0]];
            return {
                address: contractNames[value.address],
                eventName: log.name,
                returnValues: this.web3.eth.abi.decodeLog(
                    log.abi, value.raw.data, value.raw.topics
                )
            }
        })
    }
}

module.exports = {
  Tester,
  longer
};
