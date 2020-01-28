const DharmaDai = artifacts.require("token/DharmaDaiImplementationV0");
const DharmaUSDC = artifacts.require("token/DharmaUSDCImplementationV0");
const DharmaDaiInitializer = artifacts.require("token/DharmaDaiInitializer");
const DharmaUSDCInitializer = artifacts.require("token/DharmaUSDCInitializer");

module.exports = function(deployer) {
  deployer.deploy(DharmaDai);
  deployer.deploy(DharmaUSDC);
  deployer.deploy(DharmaDaiInitializer);
  deployer.deploy(DharmaUSDCInitializer);
};