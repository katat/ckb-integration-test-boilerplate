const { expect } = require('chai');
const {
    resetBlocks,
    calculateTotalCapacities,
    sendTransaction,
    getCKBSDK,
    IndexerWrapper,
} = require('../utils');

describe('ckb transfers', () => {
    let indexer;
    let deps;
    let defaultLockScript;
    let totalCapacity;

    let signedTx;

    const ckb = getCKBSDK();
    const privateKey = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a2f';
    const publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    const publicKeyHash = `0x${ckb.utils.blake160(publicKey, 'hex')}`;
    const ADDRESS = ckb.utils.pubkeyToAddress(publicKey);

    const transferAmount = 10000000000n;
    const fee = 100000n;

    beforeEach(async () => {
        await resetBlocks();
        indexer = new IndexerWrapper();

        deps = await ckb.loadDeps();

        defaultLockScript = {
            hashType: 'type',
            codeHash: deps.secp256k1Dep.codeHash,
            args: publicKeyHash,
        };
    });

    it('capacity equals to genesis issuance', async () => {
        const cells = await indexer.collectCells({ lock: defaultLockScript });
        totalCapacity = calculateTotalCapacities(cells);
        expect(totalCapacity.toString()).to.equal('1000000000000000000');
    });
    describe('after transfered to itself', () => {
        beforeEach(async () => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });
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
            await sendTransaction(signedTx);
        });
        it('output capacities equal to the remaining amount', async () => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });

            const remainingAmount = totalCapacity - fee;
            expect(remainingAmount.toString()).to.equal(calculateTotalCapacities(cells).toString());
        });

        it('indexed cells equal to outputs in generated tx', async () => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });
            expect(signedTx.outputs.length).to.equal(cells.length);
        });
    });
});
