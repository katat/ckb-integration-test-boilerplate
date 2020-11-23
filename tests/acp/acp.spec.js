const fs = require('fs');
const { expect } = require('chai');
const path = require('path');
const { serializeFixVec, serializeOutPoint, AddressType } = require('@nervosnetwork/ckb-sdk-utils');
const {
    IndexerWrapper, getCKBSDK, resetBlocks, sendTransaction, BufferParser, bigIntifyCKB,
} = require('../../utils');

describe('acp', () => {
    let indexer;
    let deps;
    let defaultLockScript;

    let signedTx;

    const ckb = getCKBSDK();
    const privateKey = '0xb902874dd8afbf7d3b3c6cb7933a9151c4e8693fd41127f439ee0a2ee01bf705';
    const publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    const publicKeyHash = `0x${ckb.utils.blake160(publicKey, 'hex')}`;

    const privateKey2 = '0xc01560311b5156dba2777be844b8d5e6bcdc02d458f4d93eaf014e1470e3c959';
    const publicKey2 = ckb.utils.privateKeyToPublicKey(privateKey2);
    const publicKeyHash2 = `0x${ckb.utils.blake160(publicKey2, 'hex')}`;

    const privateKey3 = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a2f';
    const publicKey3 = ckb.utils.privateKeyToPublicKey(privateKey3);
    const publicKeyHash3 = `0x${ckb.utils.blake160(publicKey3, 'hex')}`;

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
            const genesisBlock = await ckb.rpc.getBlockByNumber('0x0');
            const secpOutPointTxHash = genesisBlock.transactions[1].hash;

            const tx = {
                version: '0x0',
                headerDeps: [],
                cellDeps: [
                    {
                        outPoint: {
                            txHash: secpOutPointTxHash,
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

        const acpDepGroup1 = {
            txHash: null,
            index: null,
        };
        const acpDepGroup2 = {
            txHash: null,
            index: null,
        };
        const deployAcp = async () => {
            const acpBinaryPath = path.join(__dirname, './anyone_can_pay');
            const acpBinaryData = fs.readFileSync(acpBinaryPath);

            const dataHex = ckb.utils.bytesToHex(acpBinaryData);
            const cells = await indexer.collectCells({ lock: defaultLockScript });
            const input = cells.find((cell) => cell.data === '0x');
            const inputs = [input];

            const typeIdHash = calculateTypeIdHash(input.outPoint);

            // 0xc4489445d83aebaf9dbbdd625224ced39b49c52301991cfaa0b6da4fbd78401b
            const acpTypeIdScript = {
                hashType: 'type',
                codeHash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
                args: typeIdHash,
            };

            const fee = 1n;
            const requiredCKB = 61n + 64n + BigInt(dataHex.length / 2);
            const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;
            const outputs = [{
                ckb: requiredCKB,
                lock: input.lock,
                type: acpTypeIdScript,
                data: dataHex,
            }, {
                ckb: changeCKB,
                lock: input.lock,
            }];

            const rawTx = await generateRawTx(inputs, outputs);
            const signed = ckb.signTransaction(privateKey)(rawTx);
            const hash = await sendTransaction(signed);
            return { txHash: hash, typeIdScript: acpTypeIdScript };
        };
        const deployACPDepGroup = async (txHash) => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });
            const input = cells.find((cell) => cell.data === '0x');
            const serializedACPOutPoint = serializeOutPoint({ txHash, index: '0x0' });

            const genesisBlock = await ckb.rpc.getBlockByNumber('0x0');
            const secpOutPointTxHash = genesisBlock.transactions[0].hash;

            const serializedSecp256DataOutPoint = serializeOutPoint({
                txHash: secpOutPointTxHash,
                index: '0x3',
            });
            const serializedOutPoints = serializeFixVec([
                serializedACPOutPoint,
                serializedSecp256DataOutPoint,
            ]);

            const requiredCKB = 141n;
            const fee = 1n;
            const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;
            const inputs = [input];
            const outputs = [{
                ckb: requiredCKB,
                lock: input.lock,
                data: serializedOutPoints,
            }, {
                ckb: changeCKB,
                lock: input.lock,
            }];

            const rawTx = await generateRawTx(inputs, outputs);
            signedTx = ckb.signTransaction(privateKey)(rawTx);

            const depGroupTxHash = await sendTransaction(signedTx);
            const depGroupTxIndex = '0x0';

            return {
                txHash: depGroupTxHash,
                index: depGroupTxIndex,
            };
        };
        const deploySudt = async () => {
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

            const requiredCKB = 200000n;
            const fee = 1n;
            const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;

            const inputs = [input];
            const outputs = [{
                ckb: requiredCKB,
                lock: input.lock,
                type: typeIdScript,
                data: scriptDataHex,
            }, {
                ckb: changeCKB,
                lock: input.lock,
            }];

            const rawTx = await generateRawTx(inputs, outputs);

            signedTx = ckb.signTransaction(privateKey)(rawTx);

            const txHash = await sendTransaction(signedTx);
            sudtCellDep.outPoint.txHash = txHash;
        };
        const issueSudt = async (issuanceAmount) => {
            const cells = await indexer.collectCells({ lock: defaultLockScript });
            const uuid = ckb.utils.scriptToHash(defaultLockScript);

            const input = cells.find((cell) => cell.data === '0x');

            const requiredCKB = 200000n;
            const fee = 1n;
            const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;

            const inputs = [input];
            const outputs = [{
                ckb: requiredCKB,
                lock: input.lock,
                type: {
                    args: uuid,
                    hashType: 'type',
                    codeHash: ckb.utils.scriptToHash(typeIdScript),
                },
                data: BufferParser.writeBigUInt128LE(issuanceAmount),
            }, {
                ckb: changeCKB,
                lock: input.lock,
            }];

            const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
            signedTx = ckb.signTransaction(privateKey)(rawTx);

            await sendTransaction(signedTx);

            return uuid;
        };
        const createACPForCKB = async (acpTypeIdScript, amount, key, type, data, appendInput) => {
            const cells = await indexer.collectCells({ lock: { ...defaultLockScript, args: key.publicKeyHash } });

            const input = appendInput || cells.find((cell) => cell.data === '0x');

            const acpTypeIdHash = ckb.utils.scriptToHash(acpTypeIdScript);

            const acpLock = {
                codeHash: acpTypeIdHash,
                args: key.publicKeyHash,
                hashType: 'type',
            };

            console.log('acp lock address', ckb.utils.fullPayloadToAddress({
                args: acpLock.args,
                type: acpLock.hashType === 'type' ? AddressType.TypeCodeHash : AddressType.DataCodeHash,
                codeHash: acpLock.codeHash,
                prefix: 'ckt',
            }));

            const requiredCKB = amount;
            const fee = 1n;
            const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;

            const inputs = [input];
            const outputs = [{
                ckb: amount,
                lock: acpLock,
            }, {
                ckb: changeCKB,
                lock: input.lock,
            }];

            if (type) {
                outputs[0].type = type;
                outputs[0].data = data;
            }

            const rawTx = await generateRawTx(inputs, outputs, [
                {
                    outPoint: acpDepGroup1,
                    depType: 'depGroup',
                },
                sudtCellDep,
            ]);
            signedTx = ckb.signTransaction(key.privateKey)(rawTx);

            await sendTransaction(signedTx);
        };

        let acpTypeIdScript;
        let deployedAcpResult;
        beforeEach(async () => {
            await deploySudt();
            deployedAcpResult = await deployAcp();
            acpTypeIdScript = deployedAcpResult.typeIdScript;

            const deployedACPDepGroupResult1 = await deployACPDepGroup(deployedAcpResult.txHash);
            acpDepGroup1.txHash = deployedACPDepGroupResult1.txHash;
            acpDepGroup1.index = deployedACPDepGroupResult1.index;
        });
        it('deployed type id script for sudt', async () => {
            const cells = await indexer.collectCells({ type: typeIdScript });
            expect(cells.length).to.equal(1);
            expect(cells[0].data).to.equal(scriptDataHex);
        });
        describe('setup accounts', () => {
            beforeEach(async () => {
                const cells = await indexer.collectCells({ lock: defaultLockScript });

                const input = cells.find((cell) => cell.data === '0x');

                const requiredCKB = 10000n;
                const fee = 1n;
                const changeCKB = bigIntifyCKB(input.capacity) - requiredCKB - fee;

                const inputs = [input];
                const outputs = [
                    {
                        ckb: requiredCKB,
                        lock: { ...defaultLockScript, args: publicKeyHash2 },
                    },
                    // {
                    //     ckb: requiredCKB,
                    //     lock: { ...defaultLockScript, args: publicKeyHash3 },
                    // },
                    {
                        ckb: changeCKB,
                        lock: input.lock,
                    },
                ];

                const rawTx = await generateRawTx(inputs, outputs);
                signedTx = ckb.signTransaction(privateKey)(rawTx);

                await sendTransaction(signedTx);
            });
            describe('with sudt issued and acp cell created', () => {
                let uuid;
                const issuanceAmount = BigInt('10000000000000000000000000000');

                beforeEach(async () => {
                    uuid = await issueSudt(issuanceAmount);
                    const sudtTypeScript = {
                        args: uuid,
                        hashType: 'type',
                        codeHash: ckb.utils.scriptToHash(typeIdScript),
                    };
                    const cells = await indexer.collectCells({ type: sudtTypeScript });

                    await createACPForCKB(
                        acpTypeIdScript,
                        1000n,
                        { publicKeyHash, privateKey },
                        sudtTypeScript,
                        BufferParser.writeBigUInt128LE(10n),
                        cells[0],
                    );

                    // const tx = await ckb.rpc.getTransaction('0xb6dc1fd7190f84f81e21c1a758f9a58ce1cff41cebb37869dc40888521928eaf');
                    // console.log(tx);

                    await createACPForCKB(
                        acpTypeIdScript,
                        1000n,
                        { publicKeyHash: publicKeyHash2, privateKey: privateKey2 },
                    );

                    // const cells = await indexer.collectCells({ type: typeIdScript });
                    // console.log(cells);

                    const anotherDeployedAcpResult = await deployAcp();
                    const deployedACPDepGroupResult = await deployACPDepGroup(anotherDeployedAcpResult.txHash);
                    acpDepGroup2.txHash = deployedACPDepGroupResult.txHash;
                    acpDepGroup2.index = deployedACPDepGroupResult.index;
                    console.log(acpDepGroup1, acpDepGroup2, sudtCellDep, sudtTypeScript);
                    console.log('legacy acp dep group', acpDepGroup1);
                    console.log('new acp dep group', acpDepGroup2);
                    console.log('sudt cell dep', sudtCellDep);

                    // console.log(anotherDeployedAcpResult)
                    console.log('legacy acp type id hash', ckb.utils.scriptToHash(deployedAcpResult.typeIdScript))
                    console.log('new acp type id hash', ckb.utils.scriptToHash(anotherDeployedAcpResult.typeIdScript))
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
                it.only('created acp', async () => {
                    // console.log('acp type id hash', ckb.utils.scriptToHash({
                    //     "args": '0xde8b879bd1e98399de0dc9be163e703fc1fb82d9379ee1e85143b9f5a863610c',
                    //     "codeHash": '0x00000000000000000000000000000000000000000000000000545950455f4944',
                    //     "hashType": 'type'
                    // }));
                });
                describe('transfer sudt to acp', () => {
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
                // describe('transfer ckb to acp', () => {
                //     beforeEach(async () => {
                //         const acpTypeIdHash = ckb.utils.scriptToHash(acpTypeIdScript);

                //         const acpLock = {
                //             codeHash: acpTypeIdHash,
                //             args: publicKeyHash,
                //             hashType: 'type',
                //         };
                //         const cellsByPrivateKey1 = await indexer.collectCells({
                //             lock: acpLock,
                //         });
                //         const cellsByPrivateKey2 = await indexer.collectCells({
                //             lock: { ...defaultLockScript, args: publicKeyHash2 },
                //         });

                //         const input1 = cellsByPrivateKey1[0];
                //         const input2 = cellsByPrivateKey2[0];
                //         const fee = 1n;
                //         const requiredCKB = bigIntifyCKB(input1.capacity) + bigIntifyCKB(input2.capacity) - fee;

                //         const inputs = [input2, input1];
                //         const outputs = [{
                //             ckb: requiredCKB,
                //             lock: acpLock,
                //         }];

                //         const rawTx = await generateRawTx(inputs, outputs, [{
                //             outPoint: acpDepGroup,
                //             depType: 'depGroup',
                //         }]);
                //         signedTx = ckb.signTransaction(privateKey2)(rawTx);

                //         await sendTransaction(signedTx);
                //     });
                //     it.only('', () => {});
                // });
                describe('unlock acp', () => {
                    beforeEach(async () => {
                        const acpTypeIdHash = ckb.utils.scriptToHash(acpTypeIdScript);
                        const acpLock1 = {
                            codeHash: acpTypeIdHash,
                            args: publicKeyHash,
                            hashType: 'type',
                        };
                        const cells1 = await indexer.collectCells({
                            lock: acpLock1,
                        });

                        const input1 = cells1[0];

                        const acpLock2 = {
                            codeHash: acpTypeIdHash,
                            args: publicKeyHash2,
                            hashType: 'type',
                        };
                        const cells2 = await indexer.collectCells({
                            lock: acpLock2,
                        });
                        const input2 = cells2[0];

                        const requiredCKB1 = bigIntifyCKB(input1.capacity);
                        const fee1 = 1n;
                        const changeCKB1 = requiredCKB1 - fee1;

                        const requiredCKB2 = bigIntifyCKB(input2.capacity);
                        const fee2 = 1n;
                        const changeCKB2 = requiredCKB2 - fee2;

                        const inputs = [input1, input2];
                        const outputs = [
                            {
                                ckb: changeCKB1,
                                type: input1.type,
                                lock: {
                                    ...defaultLockScript,
                                    args: publicKeyHash,
                                },
                                data: BufferParser.writeBigUInt128LE(10n),
                            },
                            {
                                ckb: changeCKB2,
                                type: input2.type,
                                lock: {
                                    ...defaultLockScript,
                                    args: publicKeyHash2,
                                },
                            },
                        ];

                        const rawTx = await generateRawTx(inputs, outputs, [
                            {
                                outPoint: acpDepGroup1,
                                depType: 'depGroup',
                            },
                            sudtCellDep,
                        ]);
                        const signedTx = rawTx;

                        const signedWitness1 = ckb.signWitnesses(privateKey)({
                            transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                            witnesses: [rawTx.witnesses[0]],
                        })[0];

                        const signedWitness2 = ckb.signWitnesses(privateKey2)({
                            transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                            witnesses: [rawTx.witnesses[0]],
                        })[0];

                        signedTx.witnesses[0] = signedWitness1;
                        signedTx.witnesses[1] = signedWitness2;

                        // signedTx = ckb.signTransaction(privateKey)(rawTx);

                        await sendTransaction(signedTx);
                    });
                    it('', () => {});
                });
            });
        });
    });
});
