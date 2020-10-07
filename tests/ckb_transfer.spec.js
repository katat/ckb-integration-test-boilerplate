const { tmpdir } = require('os');
const path = require('path');
const rimraf = require('rimraf');
const { expect } = require('chai');
const { Indexer } = require('@ckb-lumos/indexer');
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const {
    NODE_URL, resetBlocks, waitForIndexing, collectCells, calculateTotalCapacities, commitTxs,
} = require('../utils');

const LUMOS_DB_ROOT = path.join(tmpdir(), 'lumos_db');

describe('tests for transfering ckb', () => {
    let indexer;
    let deps;
    let defaultLockScript;
    let totalCapacity;

    let signedTx;

    let lumosDBPath;

    const ckb = new CKB(NODE_URL);
    const privateKey = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a2f';
    const publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    const publicKeyHash = `0x${ckb.utils.blake160(publicKey, 'hex')}`;
    const ADDRESS = ckb.utils.pubkeyToAddress(publicKey);

    const transferAmount = 10000000000n;
    const fee = 100000n;

    beforeEach(async () => {
        lumosDBPath = path.join(LUMOS_DB_ROOT, Date.now().toString());
        indexer = new Indexer(NODE_URL, lumosDBPath);
        await resetBlocks();
        await waitForIndexing(indexer);
        deps = await ckb.loadDeps();

        defaultLockScript = {
            hashType: 'type',
            codeHash: deps.secp256k1Dep.codeHash,
            args: publicKeyHash,
        };

        const cells = await collectCells(indexer, defaultLockScript);
        totalCapacity = calculateTotalCapacities(cells);

        const rawTx = ckb.generateRawTransaction({
            fromAddress: ADDRESS,
            toAddress: ADDRESS,
            capacity: transferAmount,
            fee,
            safeMode: false,
            cells,
            deps: deps.secp256k1Dep,
        });

        rawTx.witnesses = rawTx.inputs.map((_, i) => (i > 0 ? '0x' : {
            lock: '',
            inputType: '',
            outputType: '',
        }));
        signedTx = ckb.signTransaction(privateKey)(rawTx);
        await ckb.rpc.sendTransaction(signedTx);
        await commitTxs();
        await waitForIndexing(indexer);
    });

    afterEach(async () => {
        rimraf.sync(lumosDBPath);
    });

    it('output capacities equal to the remaining amount', async () => {
        const cells = await collectCells(indexer, defaultLockScript);

        const remainingAmount = totalCapacity - fee;
        expect(remainingAmount).to.equal(calculateTotalCapacities(cells));
    });

    it('indexed cells equal to outputs in generated tx', async () => {
        const cells = await collectCells(indexer, defaultLockScript);
        expect(signedTx.outputs.length).to.equal(cells.length);
    });
});
