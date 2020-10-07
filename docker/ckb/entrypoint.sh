#!/bin/bash

ckb init --chain dev --import-spec /spec.dev.toml

cp /ckb.dev.toml /var/lib/ckb/ckb.toml

ckb run 