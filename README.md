This is a boilerplate to facilitate tests against a local CKB dev node. 

The design goal is to ease the creation of integration tests for the interactions with contracts that could be implemented by any programming languages, while serving as a educational medium for developers to understand how to interact with the on-chain contracts.

### Boot up CKB dev node

_You will need to install [docker-compose](https://docs.docker.com/compose/install/) before running the following command._

```bash
docker-compose up
```

For the CKB dev node, please refer to the configuration files in the `docker/ckb` folder.

### Install npm dependencies

```bash
npm i
```

### Run tests

```bash
npm test
```

Every time you run the above command, it should automatically reset the node states after the tests executed. 

It uses the node RPC `truncate` and `generate_block` to rollback to a specific block and generate blocks respectively, in order to achieve better efficiency in reproducing the test cases. 

