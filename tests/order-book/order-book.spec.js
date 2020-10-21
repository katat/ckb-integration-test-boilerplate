const fs = require('fs');
const { expect } = require('chai');
const path = require('path');
const {
    IndexerWrapper, getCKBSDK, resetBlocks, sendTransaction, BufferParser,
} = require('../../utils');

describe('order book', () => {
    let indexer;
    let deps;
    let defaultLockScript;

    const ckb = getCKBSDK();
    const privateKey = '0x01829817e4dead9ec93822574313c74eab20e308e4c9af476f28515aea4f8a2f';
    const publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    const rootPublicKeyHash = `0x${ckb.utils.blake160(publicKey, 'hex')}`;

    const alicePrivateKey = '0x650f2b74920bc2a3e5e33e5909cac206e38fc5fe8cb8b1596bf631a60057ff0e';
    const alicePublicKey = ckb.utils.privateKeyToPublicKey(alicePrivateKey);
    const alicePublicKeyHash = `0x${ckb.utils.blake160(alicePublicKey, 'hex')}`;

    const bobPrivateKey = '0x41f44f049b66b2d095d2c66a04b11b518feb6947b999e2b3d2fc2725e891e273';
    const bobPublicKey = ckb.utils.privateKeyToPublicKey(bobPrivateKey);
    const bobPublicKeyHash = `0x${ckb.utils.blake160(bobPublicKey, 'hex')}`;

    const dealmakerPrivateKey = '0x44c3c2baf6559ae80516486dc08ce023f6a3911152600c456093c0ad03001d32';
    const dealmakerPublicKey = ckb.utils.privateKeyToPublicKey(dealmakerPrivateKey);
    const dealmakerPublicKeyHash = `0x${ckb.utils.blake160(dealmakerPublicKey, 'hex')}`;

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
            args: rootPublicKeyHash,
        };
    });

    describe('deploy sudt', () => {
        let typeIdScript;
        let udtScriptDataHex;
        let orderLockScriptDataHex;
        let orderLockCodeHash;
        // let secp256k1SignAllScriptDataHex;

        const sudtCellDep = {
            outPoint: {
                txHash: null,
                index: null,
            },
            depType: 'code',
        };
        const orderCellDep = {
            outPoint: {
                txHash: null,
                index: null,
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
                capacity: output.ckbAmount ? `0x${output.ckbAmount.toString(16)}` : `0x${(BigInt(output.ckb) * 10n ** 8n).toString(16)}`,
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
            udtScriptDataHex = ckb.utils.bytesToHex(udtBinaryData);

            const orderLockBinaryPath = path.join(__dirname, './ckb_dex_contract');
            const orderLockBinaryData = fs.readFileSync(orderLockBinaryPath);
            orderLockScriptDataHex = ckb.utils.bytesToHex(orderLockBinaryData);

            const b = ckb.utils.blake2b(32, null, null, ckb.utils.PERSONAL);
            b.update(orderLockBinaryData);
            orderLockCodeHash = `0x${b.digest('hex')}`;

            // orderLockCodeHash = `0x${ckb.utils.blake160(orderLockScriptDataHex, 'hex')}`;

            // const secp256k1SignAllBinaryPath = path.join(__dirname, './udt');
            // const secp256k1SignAllBinaryData = fs.readFileSync(secp256k1SignAllBinaryPath);
            // secp256k1SignAllScriptDataHex = ckb.utils.bytesToHex(secp256k1SignAllBinaryData);

            const input = cells.find((cell) => cell.data === '0x');

            const typeIdHash = calculateTypeIdHash(input.outPoint);
            typeIdScript = {
                hashType: 'type',
                codeHash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
                args: typeIdHash,
            };

            const inputs = [input];
            const outputs = [
                {
                    ckb: 200000n,
                    lock: input.lock,
                    type: typeIdScript,
                    data: udtScriptDataHex,
                },
                {
                    ckb: 200000n,
                    lock: input.lock,
                    data: orderLockScriptDataHex,
                },
                // {
                //     ckb: 200000n,
                //     lock: input.lock,
                //     data: secp256k1SignAllScriptDataHex,
                // },
                {
                    ckb: 2000000n,
                    lock: input.lock,
                },
            ];

            const rawTx = await generateRawTx(inputs, outputs);
            const signedTx = ckb.signTransaction(privateKey)(rawTx);

            const txHash = await sendTransaction(signedTx);

            sudtCellDep.outPoint.txHash = txHash;
            sudtCellDep.outPoint.index = '0x0';

            orderCellDep.outPoint.txHash = txHash;
            orderCellDep.outPoint.index = '0x1';
        });
        it('deployed type id script for sudt', async () => {
            const cells = await indexer.collectCells({ type: typeIdScript });
            expect(cells.length).to.equal(1);
            expect(cells[0].data).to.equal(udtScriptDataHex);
        });
        describe('issuance', () => {
            let uuid;
            let typeScript;
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
                const signedTx = ckb.signTransaction(privateKey)(rawTx);
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
                    typeScript = {
                        args: uuid,
                        hashType: 'type',
                        codeHash: ckb.utils.scriptToHash(typeIdScript),
                    };
                    const udtCell = (
                        await indexer.collectCells({ lock: defaultLockScript, type: typeScript })
                    )[0];

                    const inputs = [udtCell];
                    const outputs = [{
                        ckb: 20000n,
                        type: udtCell.type,
                        lock: {
                            ...udtCell.lock,
                            args: alicePublicKeyHash,
                        },
                        data: BufferParser.writeBigUInt128LE(issuanceAmount / 2n),
                    }, {
                        ckb: 20000n,
                        type: udtCell.type,
                        lock: {
                            ...udtCell.lock,
                            args: bobPublicKeyHash,
                        },
                        data: BufferParser.writeBigUInt128LE(issuanceAmount / 2n),
                    }, {
                        ckb: 20000n,
                        lock: {
                            ...udtCell.lock,
                            args: dealmakerPublicKeyHash,
                        },
                    }];

                    const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
                    const signedTx = ckb.signTransaction(privateKey)(rawTx);

                    await sendTransaction(signedTx);
                });
                it('transfers sudt to alice', async () => {
                    const cells = await indexer.collectCells({
                        lock: { ...defaultLockScript, args: alicePublicKeyHash },
                    });
                    const totalAmount = cells.reduce(
                        (total, cell) => total + BufferParser.parseAmountFromSUDTData(cell.data),
                        BigInt(0),
                    );
                    expect(cells.length).to.equal(1);
                    expect(totalAmount.toString()).to.equal((issuanceAmount / 2n).toString());
                });
                it('transfers ckb to bob', async () => {
                    const cells = await indexer.collectCells({
                        lock: { ...defaultLockScript, args: bobPublicKeyHash },
                    });
                    const totalAmount = cells.reduce(
                        (total, cell) => total + BigInt(cell.capacity),
                        BigInt(0),
                    );
                    expect(cells.length).to.equal(1);
                    expect(formatCKB(totalAmount).toString()).to.equal((20000n).toString());
                });
                it('transfers ckb to dealmaker', async () => {
                    const cells = await indexer.collectCells({
                        lock: { ...defaultLockScript, args: dealmakerPublicKeyHash },
                    });
                    const totalAmount = cells.reduce(
                        (total, cell) => total + BigInt(cell.capacity),
                        BigInt(0),
                    );
                    expect(cells.length).to.equal(1);
                    expect(formatCKB(totalAmount).toString()).to.equal((20000n).toString());
                });
                describe('create order cells', () => {
                    const formatOrderData = (currentAmount, tradedAmount, orderAmount, price, isBid) => {
                        const udtAmountHex = BufferParser.writeBigUInt128LE(currentAmount);
                        if (!orderAmount) {
                            return udtAmountHex;
                        }

                        const tradedAmountHex = BufferParser.writeBigUInt128LE(tradedAmount).replace('0x', '');
                        const orderAmountHex = BufferParser.writeBigUInt128LE(orderAmount).replace('0x', '');

                        const priceBuf = Buffer.alloc(8);
                        priceBuf.writeBigUInt64LE(price);
                        const priceHex = `${priceBuf.toString('hex')}`;

                        const bidOrAskBuf = Buffer.alloc(1);
                        bidOrAskBuf.writeInt8(isBid ? 0 : 1);
                        const isBidHex = `${bidOrAskBuf.toString('hex')}`;

                        const dataHex = udtAmountHex + tradedAmountHex + orderAmountHex + priceHex + isBidHex;
                        return dataHex;
                    };
                    const parseOrderData = (hex) => {
                        const sUDTAmount = BufferParser.parseAmountFromSUDTData(hex.slice(0, 34));
                        const tradedSUDTAmount = BufferParser.parseAmountFromSUDTData(hex.slice(34, 66));
                        const orderAmount = BufferParser.parseAmountFromSUDTData(hex.slice(66, 98));

                        let price;
                        try {
                            const priceBuf = Buffer.from(hex.slice(98, 114), 'hex');
                            price = priceBuf.readBigInt64LE();
                        } catch (error) {
                            price = null;
                        }

                        const isBid = hex.slice(114, 116) === '00';

                        return {
                            sUDTAmount,
                            tradedSUDTAmount,
                            orderAmount,
                            price,
                            isBid,
                        };
                    };
                    const generateCreateOrderTx = async ({
                        publicKeyHash,
                        currentAmount,
                        tradedAmount,
                        orderAmount,
                        price,
                        isBid,
                        ckbAmount,
                    }) => {
                        const cells = await indexer.collectCells({
                            lock: { ...defaultLockScript, args: publicKeyHash },
                        });

                        const orderLock = {
                            codeHash: orderLockCodeHash,
                            hashType: 'data',
                            args: publicKeyHash,
                        };

                        const inputs = [cells[0]];

                        const changeOutput = {
                            ckbAmount: BigInt(inputs[0].capacity) - ckbAmount - 10n ** 8n,
                            type: typeScript,
                            lock: { ...defaultLockScript, args: publicKeyHash },
                            data: BufferParser.writeBigUInt128LE(BufferParser.parseAmountFromSUDTData(cells[0].data) - currentAmount),
                        };
                        const outputs = [
                            {
                                ckbAmount,
                                type: typeScript,
                                lock: orderLock,
                                data: formatOrderData(currentAmount, tradedAmount, orderAmount, price, isBid),
                            },
                            changeOutput,
                        ];

                        const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep]);
                        return rawTx;
                    };
                    const calculateAmountsByTradedAmount = (tradedSUDTAmount, input, isBid) => {
                        const {
                            price,
                        } = parseOrderData(input.data);
                        const priceInDecimal = price / 10n ** 10n;
                        const sudtTradeFee = (tradedSUDTAmount / 1000n) * 3n;

                        const tradedCKBAmount = tradedSUDTAmount * priceInDecimal;
                        const ckbTradeFee = (tradedCKBAmount / 1000n) * 3n;
                        const currentCKBAmount = BigInt(input.capacity);
                        let resultedCKBAmount = currentCKBAmount;

                        const currentSUDTAmount = BufferParser.parseAmountFromSUDTData(input.data.slice(0, 34));
                        let resultedSUDTAmount = currentSUDTAmount;

                        const totalTradedSUDTAmount = BufferParser.parseAmountFromSUDTData(input.data.slice(34, 66)) + tradedSUDTAmount;
                        const totalOrderAmount = BufferParser.parseAmountFromSUDTData(input.data.slice(66, 98)) - tradedSUDTAmount;

                        if (isBid) {
                            resultedCKBAmount -= ckbTradeFee;
                            resultedCKBAmount -= tradedCKBAmount;

                            resultedSUDTAmount += tradedSUDTAmount;
                        } else {
                            resultedCKBAmount += tradedCKBAmount;

                            resultedSUDTAmount -= sudtTradeFee;
                            resultedSUDTAmount -= tradedSUDTAmount;
                        }

                        return {
                            resultedCKBAmount,
                            resultedSUDTAmount,
                            totalTradedSUDTAmount,
                            totalOrderAmount,
                            currentCKBAmount,
                            currentSUDTAmount,
                        };
                    };
                    const calculateAmountsForSwap = (tradedSUDTAmount, bidOrderCell, askOrderCell, dealmakerCell) => {
                        const newAliceOrderStates = calculateAmountsByTradedAmount(tradedSUDTAmount, bidOrderCell, true);
                        const newBobOrderStates = calculateAmountsByTradedAmount(tradedSUDTAmount, askOrderCell, false);

                        const currentTotalCKBAmount = newAliceOrderStates.currentCKBAmount + newBobOrderStates.currentCKBAmount;
                        const resultedTotalCKBAmount = newAliceOrderStates.resultedCKBAmount + newBobOrderStates.resultedCKBAmount;
                        const dealmakerCKBProfitAmount = currentTotalCKBAmount - resultedTotalCKBAmount;
                        const currentDealmakerCKBAmount = BigInt(dealmakerCell.capacity);
                        const resultedDealmakerCKBAmouont = currentDealmakerCKBAmount + dealmakerCKBProfitAmount;

                        const currentTotalSUDTAmount = newAliceOrderStates.currentSUDTAmount + newBobOrderStates.currentSUDTAmount;
                        const resultedTotalSUDTAmount = newAliceOrderStates.resultedSUDTAmount + newBobOrderStates.resultedSUDTAmount;
                        const dealmakerSUDTProfitAmount = currentTotalSUDTAmount - resultedTotalSUDTAmount;

                        const currentDealmakerSUDTAmount = BufferParser.parseAmountFromSUDTData(dealmakerCell.data.slice(0, 34));
                        const resultedDealmakerSUDTAmount = currentDealmakerSUDTAmount + dealmakerSUDTProfitAmount;

                        const newDealmakerStates = {
                            resultedCKBAmount: resultedDealmakerCKBAmouont,
                            resultedSUDTAmount: resultedDealmakerSUDTAmount,
                            currentCKBAmount: currentDealmakerCKBAmount,
                            currentSUDTAmount: currentDealmakerSUDTAmount,
                        };

                        return {
                            newAliceOrderStates,
                            newBobOrderStates,
                            newDealmakerStates,
                        };
                    };
                    const collectOrderInputs = async () => {
                        const aliceOrderLock = {
                            codeHash: orderLockCodeHash,
                            hashType: 'data',
                            args: alicePublicKeyHash,
                        };
                        const bobOrderLock = {
                            codeHash: orderLockCodeHash,
                            hashType: 'data',
                            args: bobPublicKeyHash,
                        };
                        const dealmakerDefaultLock = {
                            ...defaultLockScript,
                            args: dealmakerPublicKeyHash,
                        };
                        const [aliceOrderCell] = await indexer.collectCells({
                            lock: aliceOrderLock,
                        });
                        const [bobOrderCell] = await indexer.collectCells({
                            lock: bobOrderLock,
                        });
                        const [dealmakerCell] = await indexer.collectCells({
                            lock: dealmakerDefaultLock,
                        });

                        const inputs = [
                            dealmakerCell,
                            aliceOrderCell,
                            bobOrderCell,
                        ];

                        return inputs;
                    };
                    describe('with orders having exact prices matched', () => {
                        beforeEach(async () => {
                            const bidPrice = 50000000000n;
                            const askPrice = bidPrice;

                            const aliceOrder = {
                                publicKeyHash: alicePublicKeyHash,
                                currentAmount: 5000000000n,
                                tradedAmount: 5000000000n,
                                orderAmount: 15000000000n,
                                price: bidPrice,
                                isBid: true,
                                ckbAmount: 2000n * 10n ** 8n,
                            };
                            const bobOrder = {
                                publicKeyHash: bobPublicKeyHash,
                                currentAmount: 50000000000n,
                                tradedAmount: 10000000000n,
                                orderAmount: 20000000000n,
                                price: askPrice,
                                isBid: false,
                                ckbAmount: 800n * 10n ** 8n,
                            };
                            const aliceRawTx = await generateCreateOrderTx(aliceOrder);
                            await sendTransaction(ckb.signTransaction(alicePrivateKey)(aliceRawTx));

                            const bobRawTx = await generateCreateOrderTx(bobOrder);
                            await sendTransaction(ckb.signTransaction(bobPrivateKey)(bobRawTx));
                        });
                        it('creates order cells', async () => {
                            const [, aliceOrderCell, bobOrderCell] = await collectOrderInputs();
                            expect(aliceOrderCell).not.to.equal(null);
                            expect(bobOrderCell).not.to.equal(null);
                        });
                        describe('setup trades', () => {
                            let inputs;
                            let outputs;
                            beforeEach(async () => {
                                inputs = await collectOrderInputs();
                                const [dealmakerCell, aliceOrderCell, bobOrderCell] = inputs;

                                const ckbMinerFee = 1000000n;
                                const tradedSUDTAmount = 150n * 10n ** 8n;

                                const {
                                    newAliceOrderStates,
                                    newBobOrderStates,
                                    newDealmakerStates,
                                } = calculateAmountsForSwap(tradedSUDTAmount, aliceOrderCell, bobOrderCell, dealmakerCell);

                                outputs = [
                                    {
                                        ...dealmakerCell,
                                        type: aliceOrderCell.type,
                                        ckbAmount: newDealmakerStates.resultedCKBAmount - ckbMinerFee,
                                        data: formatOrderData(newDealmakerStates.resultedSUDTAmount),
                                    },
                                    {
                                        lock: aliceOrderCell.lock,
                                        type: aliceOrderCell.type,
                                        ckbAmount: newAliceOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newAliceOrderStates.resultedSUDTAmount,
                                            newAliceOrderStates.totalTradedSUDTAmount,
                                            newAliceOrderStates.totalOrderAmount,
                                            parseOrderData(aliceOrderCell.data).price,
                                            true,
                                        ),
                                    },
                                    {
                                        lock: bobOrderCell.lock,
                                        type: bobOrderCell.type,
                                        ckbAmount: newBobOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newBobOrderStates.resultedSUDTAmount,
                                            newBobOrderStates.totalTradedSUDTAmount,
                                            newBobOrderStates.totalOrderAmount,
                                            parseOrderData(bobOrderCell.data).price,
                                            false,
                                        ),
                                    },
                                ];

                                expect(Number(parseOrderData(outputs[0].data).sUDTAmount))
                                    .is.greaterThan(Number(parseOrderData(dealmakerCell.data).sUDTAmount));

                                expect(Number(outputs[0].ckbAmount))
                                    .is.greaterThan(Number(BigInt(dealmakerCell.capacity)));
                            });
                            describe('success', () => {
                                beforeEach(async () => {
                                    const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep, orderCellDep]);
                                    const signedTx = rawTx;
                                    const signedWitnesses = ckb.signWitnesses(dealmakerPrivateKey)({
                                        transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                                        witnesses: [rawTx.witnesses[0]],
                                    });
                                    signedTx.witnesses[0] = signedWitnesses[0];

                                    await sendTransaction(signedTx);
                                });
                                it('updates the indexer data', async () => {
                                    const [dealmakerCell, aliceOrderCell, bobOrderCell] = await collectOrderInputs();

                                    expect(BigInt(dealmakerCell.capacity).toString()).to.equal('2000224000000');

                                    expect(BigInt(aliceOrderCell.capacity).toString()).to.equal('124775000000');
                                    expect(BufferParser.parseAmountFromSUDTData(aliceOrderCell.data.slice(0, 34)).toString()).to.equal('20000000000');
                                    expect(BufferParser.parseAmountFromSUDTData(`0x${aliceOrderCell.data.slice(34, 66)}`).toString()).to.equal('0');
                                    expect(BufferParser.parseAmountFromSUDTData(`0x${aliceOrderCell.data.slice(66, 98)}`).toString()).to.equal('0');

                                    expect(BigInt(bobOrderCell.capacity).toString()).to.equal('155000000000');
                                    expect(BufferParser.parseAmountFromSUDTData(bobOrderCell.data.slice(0, 34)).toString()).to.equal('34955000000');
                                    expect(BufferParser.parseAmountFromSUDTData(`0x${bobOrderCell.data.slice(34, 66)}`).toString()).to.equal('25000000000');
                                    expect(BufferParser.parseAmountFromSUDTData(`0x${bobOrderCell.data.slice(66, 98)}`).toString()).to.equal('5000000000');
                                });
                            });
                            describe('fails', () => {
                                describe('deal maker tries to modify trade intention', () => {
                                    beforeEach(async () => {
                                        const {
                                            sUDTAmount,
                                            tradedSUDTAmount,
                                            orderAmount,
                                            price,
                                            isBid,
                                        } = parseOrderData(outputs[2].data);
                                        // deal maker modifies order intention from bid to ask
                                        outputs[2].data = formatOrderData(sUDTAmount, tradedSUDTAmount, orderAmount, price, !isBid);
                                    });
                                    it('order lock contract rejects', async () => {
                                        let err = null;
                                        try {
                                            const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep, orderCellDep]);
                                            const signedTx = rawTx;
                                            const signedWitnesses = ckb.signWitnesses(dealmakerPrivateKey)({
                                                transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                                                witnesses: [rawTx.witnesses[0]],
                                            });
                                            signedTx.witnesses[0] = signedWitnesses[0];

                                            await sendTransaction(signedTx);
                                        } catch (error) {
                                            err = error;
                                        }

                                        expect(err).not.equal(null);
                                    });
                                });
                            });
                        });
                    });
                    describe('with a gap between the bid and ask prices', () => {
                        const bidPrice = 50000000000n;
                        const askPrice = 60000000000n;
                        beforeEach(async () => {
                            const aliceRawTx = await generateCreateOrderTx({
                                publicKeyHash: alicePublicKeyHash,
                                currentAmount: 5000000000n,
                                tradedAmount: 5000000000n,
                                orderAmount: 15000000000n,
                                price: bidPrice,
                                isBid: true,
                                ckbAmount: 2000n * 10n ** 8n,
                            });
                            await sendTransaction(ckb.signTransaction(alicePrivateKey)(aliceRawTx));

                            const bobRawTx = await generateCreateOrderTx({
                                publicKeyHash: bobPublicKeyHash,
                                currentAmount: 50000000000n,
                                tradedAmount: 10000000000n,
                                orderAmount: 20000000000n,
                                price: askPrice,
                                isBid: false,
                                ckbAmount: 800n * 10n ** 8n,
                            });
                            await sendTransaction(ckb.signTransaction(bobPrivateKey)(bobRawTx));
                        });
                        it('creates order cells', async () => {
                            const [, aliceOrderCell, bobOrderCell] = await collectOrderInputs();
                            expect(aliceOrderCell).not.to.equal(null);
                            expect(bobOrderCell).not.to.equal(null);
                        });
                        describe('setup trades', () => {
                            let inputs;
                            let outputs;
                            beforeEach(async () => {
                                const tradedSUDTAmount = 150n * 10n ** 8n;
                                inputs = await collectOrderInputs();
                                const [dealmakerCell, aliceOrderCell, bobOrderCell] = inputs;

                                const {
                                    newAliceOrderStates,
                                    newBobOrderStates,
                                    newDealmakerStates,
                                } = calculateAmountsForSwap(tradedSUDTAmount, aliceOrderCell, bobOrderCell, dealmakerCell);

                                outputs = [
                                    {
                                        ...dealmakerCell,
                                        type: aliceOrderCell.type,
                                        ckbAmount: BigInt(dealmakerCell.capacity) + 10000n,
                                        data: formatOrderData(newDealmakerStates.resultedSUDTAmount),
                                    },
                                    {
                                        lock: aliceOrderCell.lock,
                                        type: aliceOrderCell.type,
                                        ckbAmount: newAliceOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newAliceOrderStates.resultedSUDTAmount,
                                            newAliceOrderStates.totalTradedSUDTAmount,
                                            newAliceOrderStates.totalOrderAmount,
                                            parseOrderData(aliceOrderCell.data).price,
                                            true,
                                        ),
                                    },
                                    {
                                        lock: bobOrderCell.lock,
                                        type: bobOrderCell.type,
                                        ckbAmount: newBobOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newBobOrderStates.resultedSUDTAmount,
                                            newBobOrderStates.totalTradedSUDTAmount,
                                            newBobOrderStates.totalOrderAmount,
                                            parseOrderData(bobOrderCell.data).price,
                                            false,
                                        ),
                                    },
                                ];

                                expect(Number(parseOrderData(outputs[0].data).sUDTAmount))
                                    .is.greaterThan(Number(parseOrderData(dealmakerCell.data).sUDTAmount));

                                expect(Number(outputs[0].ckbAmount))
                                    .is.greaterThan(Number(BigInt(dealmakerCell.capacity)));
                            });
                            it('contract rejects', async () => {
                                let err = null;
                                try {
                                    const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep, orderCellDep]);
                                    const signedTx = rawTx;
                                    const signedWitnesses = ckb.signWitnesses(dealmakerPrivateKey)({
                                        transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                                        witnesses: [rawTx.witnesses[0]],
                                    });
                                    signedTx.witnesses[0] = signedWitnesses[0];

                                    await sendTransaction(signedTx);
                                } catch (error) {
                                    err = error;
                                }

                                expect(err).not.equal(null);
                            });
                        });
                    });
                    describe('with an overlap between bid and ask prices', () => {
                        const bidPrice = 60000000000n;
                        const askPrice = 50000000000n;
                        beforeEach(async () => {
                            const aliceRawTx = await generateCreateOrderTx({
                                publicKeyHash: alicePublicKeyHash,
                                currentAmount: 5000000000n,
                                tradedAmount: 5000000000n,
                                orderAmount: 15000000000n,
                                price: bidPrice,
                                isBid: true,
                                ckbAmount: 2000n * 10n ** 8n,
                            });
                            await sendTransaction(ckb.signTransaction(alicePrivateKey)(aliceRawTx));
                            const bobRawTx = await generateCreateOrderTx({
                                publicKeyHash: bobPublicKeyHash,
                                currentAmount: 50000000000n,
                                tradedAmount: 10000000000n,
                                orderAmount: 20000000000n,
                                price: askPrice,
                                isBid: false,
                                ckbAmount: 800n * 10n ** 8n,
                            });
                            await sendTransaction(ckb.signTransaction(bobPrivateKey)(bobRawTx));
                        });
                        it('creates order cells', async () => {
                            const [, aliceOrderCell, bobOrderCell] = await collectOrderInputs();
                            expect(aliceOrderCell).not.to.equal(null);
                            expect(bobOrderCell).not.to.equal(null);
                        });
                        describe('setup trades', () => {
                            let inputs;
                            let outputs;
                            beforeEach(async () => {
                                const tradeFee = 1000000n;
                                const tradedSUDTAmount = 150n * 10n ** 8n;

                                inputs = await collectOrderInputs();
                                const [dealmakerCell, aliceOrderCell, bobOrderCell] = inputs;

                                const {
                                    newAliceOrderStates,
                                    newBobOrderStates,
                                    newDealmakerStates,
                                } = calculateAmountsForSwap(tradedSUDTAmount, aliceOrderCell, bobOrderCell, dealmakerCell);

                                outputs = [
                                    {
                                        ...dealmakerCell,
                                        type: aliceOrderCell.type,
                                        ckbAmount: newDealmakerStates.resultedCKBAmount - tradeFee,
                                        data: formatOrderData(newDealmakerStates.resultedSUDTAmount),
                                    },
                                    {
                                        lock: aliceOrderCell.lock,
                                        type: aliceOrderCell.type,
                                        ckbAmount: newAliceOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newAliceOrderStates.resultedSUDTAmount,
                                            newAliceOrderStates.totalTradedSUDTAmount,
                                            newAliceOrderStates.totalOrderAmount,
                                            parseOrderData(aliceOrderCell.data).price,
                                            true,
                                        ),
                                    },
                                    {
                                        lock: bobOrderCell.lock,
                                        type: bobOrderCell.type,
                                        ckbAmount: newBobOrderStates.resultedCKBAmount,
                                        data: formatOrderData(
                                            newBobOrderStates.resultedSUDTAmount,
                                            newBobOrderStates.totalTradedSUDTAmount,
                                            newBobOrderStates.totalOrderAmount,
                                            parseOrderData(bobOrderCell.data).price,
                                            false,
                                        ),
                                    },
                                ];

                                expect(Number(parseOrderData(outputs[0].data).sUDTAmount))
                                    .is.greaterThan(Number(parseOrderData(dealmakerCell.data).sUDTAmount));

                                expect(Number(outputs[0].ckbAmount))
                                    .is.greaterThan(Number(BigInt(dealmakerCell.capacity)));
                            });
                            it('contract accepts', async () => {
                                const rawTx = await generateRawTx(inputs, outputs, [sudtCellDep, orderCellDep]);
                                const signedTx = rawTx;
                                const signedWitnesses = ckb.signWitnesses(dealmakerPrivateKey)({
                                    transactionHash: ckb.utils.rawTransactionToHash(rawTx),
                                    witnesses: [rawTx.witnesses[0]],
                                });
                                signedTx.witnesses[0] = signedWitnesses[0];

                                await sendTransaction(signedTx);
                            });
                        });
                    });
                });
            });
        });
    });
});
