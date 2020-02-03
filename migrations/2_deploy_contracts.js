const DharmaDai = artifacts.require("token/DharmaDaiImplementationV1");
const DharmaUSDC = artifacts.require("token/DharmaUSDCImplementationV1");
const DharmaDaiInitializer = artifacts.require("token/DharmaDaiInitializer");
const DharmaUSDCInitializer = artifacts.require("token/DharmaUSDCInitializer");
const HelperTester = artifacts.require("test/HelperTester");

module.exports = function(deployer) {
  deployer.deploy(DharmaDai);
  deployer.deploy(DharmaUSDC);
  deployer.deploy(DharmaDaiInitializer);
  deployer.deploy(DharmaUSDCInitializer);
  deployer.deploy(HelperTester);
};