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

    async collectCells(lockScript) {
        await this.waitForIndexing();

        const collector = new CellCollector(this.indexer, {
            lock: {
                code_hash: lockScript.codeHash,
                hash_type: lockScript.hashType,
                args: lockScript.args,
            },
        });

        const cells = [];

        for await (const cell of collector.collect()) {
            cells.push({
                type: cell.cell_output.type || null,
                capacity: cell.cell_output.capacity,
                outPoint: {
                    txHash: cell.out_point.tx_hash,
                    index: cell.out_point.index,
                },
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
