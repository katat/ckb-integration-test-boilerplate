FROM nervos/ckb:v0.35.1

USER root
COPY ./spec.dev.toml /spec.dev.toml
COPY ./ckb.dev.toml /ckb.dev.toml
COPY ./ckb-miner.toml /ckb-miner.toml

COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["sh", "/entrypoint.sh"]