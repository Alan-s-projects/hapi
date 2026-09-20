FROM scratch
LABEL org.opencontainers.image.source="https://github.com/fatedier/frp" \
      org.opencontainers.image.version="0.71.0" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --chmod=0555 deploy/alan/artifacts/frp/frpc /usr/local/bin/frpc
COPY --chmod=0555 deploy/alan/artifacts/frp/frps /usr/local/bin/frps
COPY deploy/alan/artifacts/frp/LICENSE /LICENSE
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/frpc"]
