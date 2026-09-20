# Prefix-aware HAPI + Codex and private frp gateway

Status: implementation candidate; NOT a completed public deployment. The tested
browser URL layout is `/hapi/`. Native mobile companion apps are not certified
for this fork or the additional browser MFA gateway.

## Routing contract

- Build the web client with `VITE_BASE_URL=/hapi/`.
- Run the hub with `HAPI_BASE_PATH=/hapi`.
- Set `HAPI_PUBLIC_URL=https://your-domain/hapi` and the runner's
  `HAPI_API_URL=http://127.0.0.1:3006/hapi`.
- Caddy and frp preserve the prefix. Do NOT use `handle_path` or strip it there.
- CORS is a list of origins (scheme + hostname + port), without `/hapi`.
- All HTTP endpoints are beneath the prefix; unprefixed APIs return 404.
- Socket.IO namespaces remain `/cli` and `/terminal`; their transport path is
  `/hapi/socket.io/`. These are different concepts.
- Omit the hub prefix and build the web client with `/` for upstream-style root
  deployment. A separate static frontend can select a different hub base URL.
- Authenticated API responses are never service-worker cached. Old HAPI API
  caches are removed on worker activation; server-side chats are unaffected.

## Reusable Linux development container

Run from the repository root on a Docker host with the existing Copilot Bridge
network (`copilot-bridge_default`). No production data volumes are mounted.

```powershell
docker compose -f deploy/alan/compose.dev.yaml up -d --build
docker exec -u root hapi-dev chown node:node /workspace/hapi/node_modules /workspace/hapi/cli/node_modules /workspace/hapi/web/node_modules /workspace/hapi/hub/node_modules /workspace/hapi/shared/node_modules /workspace/hapi/relay/node_modules /workspace/hapi/docs/node_modules /workspace/hapi/website/node_modules
docker exec hapi-dev bun install --frozen-lockfile
docker exec hapi-dev node /workspace/hapi/deploy/alan/build.mjs
```

The dev container runs as `node`; its only additional capability is CHOWN for
explicit root initialization of dependency volumes. It has no Docker socket.
The production container drops all capabilities.

`build.mjs` compiles on native Linux storage to avoid Bun 1.4.0's Windows/9p
temporary-file bug (oven-sh/bun#40111), and verifies its pinned Linux tunwg asset
digest. The build manifest records the resulting executable's SHA-256.

Export the binary and manifest, then build the application image:

```powershell
New-Item -ItemType Directory deploy/alan/artifacts -Force
docker cp hapi-dev:/test-state/build/bun-linux-x64-baseline/hapi deploy/alan/artifacts/hapi
docker cp hapi-dev:/test-state/build/bun-linux-x64-baseline/build.json deploy/alan/artifacts/build.json
docker build -f deploy/alan/Dockerfile -t alan-codex-web:0.30.7-alan.1-candidate .
```

This image is self-contained: official Node base, official Codex 0.155.1 and the
fork's compiled HAPI. It does not depend on a Windows Codex installation or a
pre-existing private base image. The official Codex model catalog is retained;
only Copilot-specific context and unavailable paid speed-tier metadata change.

## Verification

Clear deployment-specific environment values for upstream unit tests. In the
dev container, run `bun typecheck` and `bun run test` with HAPI_BASE_PATH empty,
HAPI_API_URL/HAPI_PUBLIC_URL pointing to the unprefixed test origin, VITE_BASE_URL
set to `/`, and HAPI_ANDROID_PUSH/HAPI_IOS_PUSH unset.

Run `bun run gen:fixtures`; generated fixtures have a canonical LF contract.
`.gitattributes` prevents Windows checkout conversion from breaking that check.

For the isolated preview (localhost:3007/hapi/):

```powershell
docker exec -d hapi-dev sh -c 'exec node /workspace/hapi/deploy/alan/start-test.mjs > /test-state/staging.log 2>&1'
docker exec hapi-dev node /workspace/hapi/deploy/alan/check-staging.mjs YOUR_TEST_SESSION_ID
```

The preview uses `/test-state/staging`, not the live HAPI home/workspace. Do not
run another test supervisor while one is already listening. It is a development
preview, not an automatically restarted production service.

Manual browser checks: login, new session, streamed Codex tool execution,
one-time approval, terminal output/reconnect, deep-link reload, file links, and
PWA scope. The protocol smoke test also checks protected APIs, uploads, SSE,
model/effort discovery, prefix lookalikes and unprefixed API rejection.

## frp transport

Pinned frp: 0.71.0, linux/amd64. Official archive:
https://github.com/fatedier/frp/releases/download/v0.71.0/frp_0.71.0_linux_amd64.tar.gz

Archive SHA-256:
`84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716`

Extract into `artifacts/frp/` and build with `frp.Dockerfile`. The scratch image
contains only official frpc/frps binaries and their license. It runs as 65532,
read-only, without additional capabilities or a Docker socket.

Use `provision-frp.ps1` with an explicit private directory OUTSIDE the repository
and application containers. Windows MSIX apps virtualize AppData, so use a
protected non-virtualized directory for Docker bind mounts. Never mount the CA
private key into any runtime container. Leaf certificates expire in 90 days;
record their expiry, rotate before expiry, and back up the CA separately.

- Client mounts only ca.crt, client.crt, client.key and tunnel-token.
- Server mounts only ca.crt, server.crt, server.key and tunnel-token.
- Enforced mutual TLS includes explicit client CA trust and expected server name.
- A separate token also authenticates heartbeats and new work connections.
- Server permits only private forwarding port 13006, one port per client.
- Only transport TCP 7000 is host-published. Never publish 13006.
- No dashboard, SSH gateway, vhost port, QUIC or KCP listener is enabled.
- Use `test-frp-tls.mjs` to check valid mTLS, missing client certificate, wrong CA,
  wrong hostname and plaintext rejection; additionally verify bad-token rejection.

`compose.frpc.yaml` uses a separate local backend network. Attach only the HAPI
service to it; do not give the tunnel direct access to Copilot Bridge or Windows
folders. `compose.frps.yaml` creates a separate VM-side front network; Caddy may
join it during the approved cutover while retaining its existing network.

## MFA gateway and public activation gates

Authelia 4.39.28 is pinned by digest. `compose.auth.yaml` overlays the frps stack.
Prepare data/config/secret directories with UID/GID 1000; config and secrets are
read-only. Authelia needs one writable healthcheck-environment file, explicitly
mounted rather than making the entire application filesystem writable.

The bootstrap user entry is DISABLED, has no groups, and uses a fresh digest of
a random discarded password. Never enable it. Replace it with the owner's
privately chosen password hash, owner group and enrolled authenticator only
after the owner is present. No enabled account exists during preparation.

The filesystem notifier is for private, operator-assisted enrollment only.
Confirm SMTP or a documented manual recovery procedure before public use;
password-reset self-service is disabled. Notification files must remain private.

`Caddy.hapi.example` and `Caddy.logging.example` are validated fragments, not an
instruction to activate a site. Preserve existing Xray routes and Caddy volumes.
Do not activate public HAPI until all of these are complete:

1. Owner password setup, MFA enrollment and recovery test.
2. Explicit resolution of outstanding VM/3x-ui hardening and maintenance choices.
3. Gateway tests for login, logout, expiry, API/fetch redirects, SSE and WebSockets.
4. Log verification that credentials, cookies and token queries are redacted.
5. Verified production image, consistent volume backup, idle sessions and rollback.

## Rollback and limits

Disable only the new public routes if gateway checks fail. Keep original Xray
routing, SSH access, certificate volumes and all application data. Restore the
previous HAPI image/configuration; use a matching data backup if any schema
migration occurred. Never use volume pruning as rollback.

The PC must stay awake and Docker must run. Restarting a container interrupts
active work; do not blindly replay uncertain writes. A URL prefix does not
isolate browser origins, and TLS does not replace browser authentication.

No private keys, tokens, password hashes, backups, production user data, or real
infrastructure-specific configuration should be committed to this public fork.
