const DharmaDai = artifacts.require("token/DharmaDai");
const DharmaUSDC = artifacts.require("token/DharmaUSDC.sol");

module.exports = function(deployer) {
  deployer.deploy(DharmaDai);
  deployer.deploy(DharmaUSDC);
};