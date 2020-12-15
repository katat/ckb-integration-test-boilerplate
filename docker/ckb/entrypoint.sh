#!/bin/bash

ckb init --chain dev --import-spec /spec.dev.toml

cp /ckb.dev.toml /var/lib/ckb/ckb.toml
cp /ckb-miner.toml /var/lib/ckb/ckb-miner.toml

ckb run 