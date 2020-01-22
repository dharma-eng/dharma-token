const DharmaDai = artifacts.require("token/DharmaDai");

module.exports = function(deployer) {
  deployer.deploy(DharmaDai);
};