const path = require('path');
const os = require('os');
const rimraf = require('rimraf');
const { Indexer, CellCollector } = require('@ckb-lumos/indexer');
const { NODE_URL, getTipBlockNumber } = require('./common');

const LUMOS_DB_ROOT = path.join(os.tmpdir(), 'lumos_db');

class IndexerWrapper {
    constructor() {
        this.lumosDBPath = path.join(LUMOS_DB_ROOT, Date.now().toString());
        this.indexer = new Indexer(NODE_URL, this.lumosDBPath);
    }

    async waitForIndexing(timeout = 5000) {
        if (this.indexer.running()) {
            this.indexer.stop();
        }
        this.indexer.start();
        const { data: { result: nodeTipBlockNumber } } = await getTipBlockNumber();
        const startedAt = Date.now();
        while (true) {
            await new Promise((resolve) => setTimeout(resolve, 10));

            const currentTip = await this.indexer.tip();
            if (!currentTip) {
                continue;
            }
            if (BigInt(currentTip.block_number) === BigInt(nodeTipBlockNumber)) {
                break;
            }
            if (Date.now() - startedAt > timeout) {
                throw new Error('waiting for indexing is timeout');
            }
        }
    }

    async collectCells({ lock, type }) {
        await this.waitForIndexing();

        const query = {};
        if (lock) {
            query.lock = {
                code_hash: lock.codeHash,
                hash_type: lock.hashType,
                args: lock.args,
            };
        }
        if (type) {
            query.type = {
                code_hash: type.codeHash,
                hash_type: type.hashType,
                args: type.args,
            };
        }
        const collector = new CellCollector(this.indexer, query);

        const cells = [];

        for await (const cell of collector.collect()) {
            cells.push({
                type: cell.cell_output.type || null,
                lock: cell.cell_output.lock || null,
                capacity: cell.cell_output.capacity,
                outPoint: {
                    txHash: cell.out_point.tx_hash,
                    index: cell.out_point.index,
                },
                data: cell.data,
            });
        }

        return cells;
    }

    reset() {
        if (this.indexer.running()) {
            this.indexer.stop();
        }
        rimraf.sync(this.lumosDBPath);
    }
}

module.exports = IndexerWrapper;
