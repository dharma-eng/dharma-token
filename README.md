# Dharma Token (dharma-token)

> Implementation and testing for core Dharma Token (dToken) contracts.

## Install
To install locally, you'll need Node.js 10 through 12 and Yarn *(or npm)*. To get everything set up:
```sh
$ git clone https://github.com/dharmaprotocol/dharma-token.git
$ cd dharma-token
$ yarn install
$ yarn build
```

## Usage
To run tests locally, start the testRPC, trigger the tests, run the linter, and tear down the testRPC *(you can do all of this at once via* `yarn all` *if you prefer)*:
```sh
$ yarn start
$ yarn test
$ yarn lint
$ yarn stop
```

You can also run code coverage if you like:
```sh
$ yarn build
$ yarn coverage
```

There is also an option to run tests against a fork of mainnet - be warned that these tests take much longer to run.
```sh
$ yarn forkStart
$ yarn test
$ yarn stop
```

Finally, there is an option to run code coverage against a mainnet fork (same caveat as above):
```sh
$ yarn build
$ yarn forkCoverage
```
