module.exports = {
  norpc: true,
  testCommand: 'node --max-old-space-size=4096 ./scripts/test/testCoverage.js',
  compileCommand: 'node --max-old-space-size=4096 ../node_modules/.bin/truffle compile',
  copyPackages: ['web3'],
  skipFiles: []
}