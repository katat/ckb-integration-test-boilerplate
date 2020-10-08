This is a boilerplate to create integration tests against a local CKB dev node. 

It aims to facilitate creating tests to verify the behaviors of contracts that could be implemented by any programming languages, while serving as a playground for developers to do experiments in an efficient and reproducible way.

### Boot up CKB dev node

```bash
docker-compose up
```

You will need to install [docker-compose](https://docs.docker.com/compose/install/) before running the following command.

To tune the settings of the CKB dev node, such as enable certain modules or genesis issuance etc, please refer to the configuration files in the `docker/ckb` folder.

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

