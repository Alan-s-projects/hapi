FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG CODEX_VERSION=0.155.1
ARG REVISION=development
LABEL org.opencontainers.image.source="https://github.com/Alan-s-projects/hapi" \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.version="0.30.7-alan.1" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv ripgrep procps patch unzip bubblewrap \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @openai/codex@${CODEX_VERSION} \
    && npm cache clean --force
COPY --chmod=0755 deploy/alan/artifacts/hapi /usr/local/bin/hapi
COPY deploy/alan/artifacts/build.json /opt/codex-web/build.json
COPY --chown=node:node deploy/alan/config /opt/codex-web/config
COPY --chown=node:node deploy/alan/scripts /opt/codex-web/scripts
COPY LICENSE /usr/share/licenses/hapi/LICENSE
ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    HAPI_HOME=/home/node/.hapi \
    HAPI_API_URL=http://127.0.0.1:3006/hapi \
    HAPI_BASE_PATH=/hapi \
    HAPI_LISTEN_HOST=0.0.0.0 \
    HAPI_LISTEN_PORT=3006 \
    HAPI_RUNNER_SUPERVISED=1 \
    HAPI_DISABLE_VERSION_HANDOFF=1 \
    BRIDGE_BASE_URL=http://bridge:4142/v1
RUN mkdir -p /workspace /home/node/.codex /home/node/.hapi \
    && chown node:node /workspace /home/node/.codex /home/node/.hapi
USER node
WORKDIR /workspace
EXPOSE 3006
CMD ["node", "/opt/codex-web/scripts/supervisor.mjs"]
