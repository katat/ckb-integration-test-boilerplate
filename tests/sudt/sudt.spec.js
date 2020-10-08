const fs = require('fs');
const { expect } = require('chai');
const path = require('path');
const {
    IndexerWrapper, getCKBSDK, resetBlocks, calculateTotalCapacities, sendTransaction, BufferParser,
} = require('../../utils');

describe('sudt', () => {
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

    const transferAmount = 3000000000000n;
    const fee = 100000n;

    const calculateTypeIdHash = (input) => {
        const typeIdHash = ckb.utils.blake2b(32, null, null, ckb.utils.PERSONAL);

        const outpointStruct = new Map([['txHash', input.txHash], ['index', ckb.utils.toUint32Le(input.index)]]);
        const serializedOutpoint = ckb.utils.serializeStruct(outpointStruct);
        const serializedSince = ckb.utils.toUint64Le('0x0', 8);
        const inputStruct = new Map([['since', serializedSince], ['previousOutput', serializedOutpoint]]);
        const inputSerialized = ckb.utils.serializeStruct(inputStruct);

        typeIdHash.update(ckb.utils.hexToBytes(inputSerialized));
        typeIdHash.update(ckb.utils.hexToBytes('0x0000000000000000'));
        const id = `0x${typeIdHash.digest('hex')}`;

        return id;
    };

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

    describe('deploy', () => {
        let typeIdScript;
        const sudtCellDep = {
            outPoint: {
                txHash: null,
                index: '0x0',
            },
            depType: 'code',
        };
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

            const typeIdHash = calculateTypeIdHash(rawTx.inputs[0].previousOutput);
            typeIdScript = {
                hashType: 'type',
                codeHash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
                args: typeIdHash,
            };
            rawTx.outputs[0].type = typeIdScript;

            const udtBinaryPath = path.join(__dirname, './udt');
            const udtBinaryData = fs.readFileSync(udtBinaryPath);

            const scriptDataHex = ckb.utils.bytesToHex(udtBinaryData);
            rawTx.outputsData[0] = scriptDataHex;

            rawTx.witnesses = rawTx.inputs.map((_, i) => (i > 0 ? '0x' : {
                lock: '',
                inputType: '',
                outputType: '',
            }));
            signedTx = ckb.signTransaction(privateKey)(rawTx);

            const txHash = await sendTransaction(signedTx);
            sudtCellDep.outPoint.txHash = txHash;
        });
        it('output capacities equal to the remaining amount', async () => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });

            const remainingAmount = totalCapacity - fee;
            expect(calculateTotalCapacities(cells).toString()).to.equal(remainingAmount.toString());
        });
        describe('issuance', () => {
            let uuid;
            const issuanceAmount = BigInt('10000000000000000000000000000');

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

                uuid = ckb.utils.scriptToHash(defaultLockScript);

                rawTx.outputs[0].type = {
                    args: uuid,
                    hashType: 'type',
                    codeHash: ckb.utils.scriptToHash(typeIdScript),
                };

                rawTx.outputsData[0] = BufferParser.writeBigUInt128LE(issuanceAmount);

                rawTx.cellDeps.push(sudtCellDep);

                rawTx.witnesses = rawTx.inputs.map((_, i) => (i > 0 ? '0x' : {
                    lock: '',
                    inputType: '',
                    outputType: '',
                }));
                signedTx = ckb.signTransaction(privateKey)(rawTx);

                await sendTransaction(signedTx);
            });
            it('issued sudt', async () => {
                const type = {
                    args: uuid,
                    hashType: 'type',
                    codeHash: ckb.utils.scriptToHash(typeIdScript),
                };
                const cells = await indexer.collectCells({ type });
                expect(cells.length).to.equal(1);
                expect(BufferParser.parseAmountFromSUDTData(cells[0].data).toString())
                    .to.equal(issuanceAmount.toString());
            });
        });
    });
    describe('transfer', () => {

    });
    describe('destroy', () => {

    });
});
