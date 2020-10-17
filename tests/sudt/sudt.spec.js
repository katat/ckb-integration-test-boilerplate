const fs = require('fs');
const { expect } = require('chai');
const path = require('path');
const {
    IndexerWrapper, getCKBSDK, resetBlocks, sendTransaction, BufferParser,
} = require('../../utils');

describe('sudt', () => {
    let indexer;
    let deps;
    let defaultLockScript;

    let signedTx;

    const ckb = getCKBSDK();
    const privateKey = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a2f';
    const publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    const publicKeyHash = `0x${ckb.utils.blake160(publicKey, 'hex')}`;

    const privateKey2 = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a1f';
    const publicKey2 = ckb.utils.privateKeyToPublicKey(privateKey2);
    const publicKeyHash2 = `0x${ckb.utils.blake160(publicKey2, 'hex')}`;

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

    describe('deploy', () => {
        let typeIdScript;
        let scriptDataHex;
        const sudtCellDep = {
            outPoint: {
                txHash: null,
                index: '0x0',
            },
            depType: 'code',
        };

        const formatScript = (script) => (script ? {
            args: script.args,
            hashType: script.hashType || script.hash_type,
            codeHash: script.codeHash || script.code_hash,
        } : undefined);

        const formatCKB = (capacity) => BigInt(capacity) / (10n ** 8n);

        const generateRawTx = async (inputs, outputs, cellDeps = []) => {
            const tx = {
                version: '0x0',
                headerDeps: [],
                cellDeps: [
                    {
                        outPoint: {
                            txHash: '0x42334ded191bfc39e4f2bae1f6052458e3e4def9cd8d32dc94186c585287d4ff',
                            index: '0x0',
                        },
                        depType: 'depGroup',
                    },
                    ...cellDeps,
                ],
            };

            tx.inputs = inputs.map((input) => ({
                previousOutput: input.outPoint,
                since: '0x0',
            }));

            tx.outputs = outputs.map((output) => ({
                capacity: `0x${(BigInt(output.ckb) * 10n ** 8n).toString(16)}`,
                lock: formatScript(output.lock),
                type: formatScript(output.type),
            }));

            tx.outputsData = outputs.map((output) => output.data || '0x');

            tx.witnesses = tx.inputs.map((_, i) => (i > 0 ? '0x' : {
                lock: '',
                inputType: '',
                outputType: '',
            }));

            return tx;
        };

        beforeEach(async () => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });

            const udtBinaryPath = path.join(__dirname, './simple_udt');
            const udtBinaryData = fs.readFileSync(udtBinaryPath);

            scriptDataHex = ckb.utils.bytesToHex(udtBinaryData);

            const input = cells.find((cell) => cell.data === '0x');

            const typeIdHash = calculateTypeIdHash(input.outPoint);
            typeIdScript = {
                hashType: 'type',
                codeHash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
                args: typeIdHash,
            };

            const inputs = [input];
            const outputs = [{
                ckb: 200000n,
                lock: input.lock,
                type: typeIdScript,
                data: scriptDataHex,
            }, {
                ckb: 2000000n,
                lock: input.lock,
            }];

            const rawTx = await generateRawTx(inputs, outputs);
            signedTx = ckb.signTransaction(privateKey)(rawTx);

            const txHash = await sendTransaction(signedTx);
            sudtCellDep.outPoint.txHash = txHash;
        });
        it('deployed type id script for sudt', async () => {
            const cells = await indexer.collectCells({ type: typeIdScript });
            expect(cells.length).to.equal(1);
            expect(cells[0].data).to.equal(scriptDataHex);
        });
        describe('issuance', () => {
            let uuid;
            const issuanceAmount = BigInt('10000000000000000000000000000');

            beforeEach(async () => {
                const cells = await indexer.collectCells({ lock: defaultLockScript });
                uuid = ckb.utils.scriptToHash(defaultLockScript);

                const input = cells.find((cell) => cell.data === '0x');

                const inputs = [input];
                const outputs = [{
                    ckb: 200000n,
                    lock: input.lock,
                    type: {
                        args: uuid,
                        hashType: 'type',
                        codeHash: ckb.utils.scriptToHash(typeIdScript),
                    },
                    data: BufferParser.writeBigUInt128LE(issuanceAmount),
                }];

                const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
                signedTx = ckb.signTransaction(privateKey)(rawTx);

                await sendTransaction(signedTx);
            });
            it('issued sudt', async () => {
                const type = {
                    args: uuid,
                    hashType: 'type',
                    codeHash: ckb.utils.scriptToHash(typeIdScript),
                };
                const cells = await indexer.collectCells({ lock: defaultLockScript, type });
                expect(cells.length).to.equal(1);
                expect(BufferParser.parseAmountFromSUDTData(cells[0].data).toString())
                    .to.equal(issuanceAmount.toString());
            });
            describe('transfer', () => {
                beforeEach(async () => {
                    const type = {
                        args: uuid,
                        hashType: 'type',
                        codeHash: ckb.utils.scriptToHash(typeIdScript),
                    };
                    const udtCell = (
                        await indexer.collectCells({ lock: defaultLockScript, type })
                    )[0];

                    const input = udtCell;
                    const inputUDTAmount = BufferParser.parseAmountFromSUDTData(input.data);

                    const inputs = [input];
                    const outputs = [{
                        ckb: 20000n,
                        type: input.type,
                        lock: {
                            ...input.lock,
                            args: publicKeyHash2,
                        },
                        data: BufferParser.writeBigUInt128LE(inputUDTAmount),
                    }];

                    const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
                    signedTx = ckb.signTransaction(privateKey)(rawTx);

                    await sendTransaction(signedTx);
                });
                it('transfers sudt to another owner', async () => {
                    const cells = await indexer.collectCells({
                        lock: { ...defaultLockScript, args: publicKeyHash2 },
                    });
                    const totalAmount = cells.reduce(
                        (total, cell) => total + BufferParser.parseAmountFromSUDTData(cell.data),
                        BigInt(0),
                    );
                    expect(cells.length).to.equal(1);
                    expect(totalAmount.toString()).to.equal((issuanceAmount).toString());
                });
                describe('transfer by non owner', () => {
                    let inputs;
                    let outputs;
                    beforeEach(async () => {
                        const cells = await indexer.collectCells({
                            lock: { ...defaultLockScript, args: publicKeyHash2 },
                        });

                        const input = cells[0];
                        const inputUDTAmount = BufferParser.parseAmountFromSUDTData(input.data);
                        const changeCKB = 200n;

                        inputs = [input];
                        outputs = [{
                            ckb: changeCKB,
                            type: input.type,
                            lock: {
                                ...input.lock,
                                args: publicKeyHash2,
                            },
                            data: BufferParser.writeBigUInt128LE(inputUDTAmount / 2n),
                        }, {
                            ckb: formatCKB(input.capacity) - changeCKB - 1n,
                            type: input.type,
                            lock: input.lock,
                            data: BufferParser.writeBigUInt128LE(inputUDTAmount / 2n),
                        }];
                    });
                    describe('splits into two outputs with equal amount of udt', () => {
                        beforeEach(async () => {
                            const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);

                            signedTx = ckb.signTransaction(privateKey2)(rawTx);
                            await sendTransaction(signedTx);
                        });
                        it('total udt amount equals to the sum of udt cells', async () => {
                            const cells = await indexer.collectCells({
                                lock: { ...defaultLockScript, args: publicKeyHash2 },
                            });
                            const totalAmount = cells.reduce(
                                (total, cell) => total + BufferParser.parseAmountFromSUDTData(cell.data),
                                BigInt(0),
                            );
                            expect(cells.length).to.equal(2);
                            expect(totalAmount.toString()).to.equal((issuanceAmount).toString());
                        });
                    });
                    describe('over run the udt balance', () => {
                        beforeEach(async () => {
                            const maxAmount = BufferParser.parseAmountFromSUDTData(outputs[1].data);
                            outputs[1].data = BufferParser.writeBigUInt128LE(maxAmount + 1n);

                            const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
                            signedTx = ckb.signTransaction(privateKey2)(rawTx);
                        });
                        it('fails to commit the transaction', async () => {
                            let err;
                            try {
                                await sendTransaction(signedTx);
                            } catch (error) {
                                err = error;
                            }

                            expect(err.message).to.match(/ValidationFailure/i);
                        });
                    });
                });
            });
        });
    });
    describe('destroy', () => {

    });
});
