# Prefix-aware HAPI + Codex and private frp gateway

This deployment kit supports the `/hapi/` browser layout behind HTTPS/MFA.
It contains reusable examples, not a particular machine's live configuration,
account names, inventory or operational status. Native mobile companion apps
are not certified for this fork or the additional browser MFA gateway.

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
- Build the optional gateway-session UI with
  `VITE_GATEWAY_SESSION_PATH=/hapi/.gateway/session` (set by `build.mjs`).
  The marked Caddy endpoint returns 204 for an authorized session and 401/403
  otherwise. Direct hubs without the marker disable the check. The notice never
  navigates automatically or retries an application write.
- Set `HAPI_SSE_MAX_CONNECTION_SECONDS=60` on the public hub and pair it with
  Caddy's one-minute WebSocket `stream_timeout`. Existing connections may retain
  access for up to that bound after logout/expiry; every new request/reconnect
  is authorized again. Reconnect cursors and terminal detach/resume are retained.
- Authelia inactivity is request-based, so background polling may keep the idle
  timer active; the separately configured one-hour absolute expiry remains.
- HAPI strips all request-query values from its own access logs. Caddy's access
  and runtime/error encoders must independently redact credentials too.

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

### Owner account and multi-device WebAuthn enrollment

For browser-first enrollment, run `prepare-browser-enrollment.py` on the gateway
host as root before creating an enabled account. It only
accepts the known disabled-bootstrap state, creates an owner with a random
discarded password via Authelia, and moves the active users database to
`/data/users.yml` so browser password changes can persist. It enables password
reset/change and a 16-128 character policy. `/config`, `/run/secrets` and the root
filesystem stay read-only. A failed startup rolls back the live configuration.
The old disabled-bootstrap users file is retained but is no longer active.

`Caddy.enrollment.example` opens only `/auth`; HAPI remains closed. Add the
redaction filter from `Caddy.logging.example` to both the access log and the
global default/error logger before issuing a reset link. Persist Caddy's extra
private network in its Compose definition and connect it live without recreating
the existing proxy. Validate and back up all configuration before a graceful
reload; existing streaming connections may briefly reconnect.

Until SMTP is configured, the public reset-start endpoint is deliberately closed.
An operator can run `request-owner-reset.py --public-url https://your-domain/auth
--username YOUR_USER --emit-private-link` through the trusted SSH channel. It
asks Authelia's private API for a real, five-minute, single-use reset link and
reads only the newly generated notification. Its stdout is sensitive: capture
it directly into an owner-only local delivery artifact, never agent output,
ordinary logs, a repository, a public folder, or chat. Do not visit the real link
for testing, because the browser consumes it. The owner enters/submits the new
password themselves. Browser password changes work after login; email-based
recovery and enrollment verification remain operator-assisted until SMTP exists.

The optional terminal-first alternative is retained below; do not run it again
after browser-first account creation. It resolves the active database path and
refuses to overwrite an existing account.

`owner-setup.py` is an interactive, gateway-host helper (Python 3 + PyYAML).
Install it root-owned outside any public web directory, then run it as the owner
over a trusted SSH TTY: `sudo python3 /opt/hapi-gateway/owner-setup.py setup`.
It prompts for a username (generic default `owner`) and uses the existing Authelia
container's hidden password/confirmation prompts. Use a unique password of at
least 16 characters. No plaintext password is passed in arguments or written to
disk. The helper only replaces the known disabled bootstrap user; it refuses to
overwrite any existing account. It backs up the old users file privately,
validates configuration, and restarts/checks only Authelia, rolling back the user
file if validation or startup fails. It does not enable public routes.

`check` validates configuration and reports account counts without revealing
hashes. `code` requires the owner's terminal and displays recent private
filesystem-notifier messages after the browser requests registration. Never
run `code` in an agent/logged session or share its output in chat. The placeholder
email is only a notifier label, not a real delivery address; configure SMTP and
a verified real email separately if desired.

The example uses password-first authentication plus WebAuthn with required user
verification, no platform-attachment restriction and synced credentials allowed.
Register Windows Hello from Edge/Chrome and an Apple credential from Safari.
Name them clearly, such as `Windows PC` and `Apple iCloud`. Apple devices sharing
an Apple Account and iCloud Keychain can share the Apple credential. Test an
independent login from the PC, iPhone and iPad before relying on synchronization.
Either credential can be the second factor; both are not required per login.
The experimental passkey-only two-factor option remains disabled.

Keep at least two independently usable credentials and retain secure SSH/key
recovery access. Self-service password reset stays disabled. Device loss/recovery
is operator-assisted: use a remaining credential to add a replacement and revoke
the lost credential; if all factors are lost, verify ownership through the
existing private VM-administration channel before making any recovery change.
The helper intentionally does not implement an automatic MFA bypass.

Run the helper's non-mutating unit tests in the reusable Linux dev container:
`docker exec hapi-dev python3 -B -m unittest discover -s /workspace/hapi/deploy/alan -p test_owner_setup.py`.

### Dedicated container restart safety

The deployment supervisor runs exactly one hub and one runner in its own PID
namespace. At startup, `scripts/runnerState.mjs` checks the previous runner PID
files before spawning any HAPI child. Old state/lock files are archived intact;
an actually live `runner start-sync` process causes a safe refusal. This prevents
PID reuse after container recreation from making the new hub look like the old
runner. Credentials, history and resume-process records are not touched.

Run its focused tests with:
`docker exec hapi-dev node --test /workspace/hapi/deploy/alan/tests/runnerState.test.mjs`.

For a consistent cutover backup, stop only the idle HAPI service and export both
named volumes as tar archives before recreating it. Keep archive hashes, the old
image ID and Compose configuration in owner-only storage. Verify that existing
chats and workspace directories survive the cutover, check SQLite integrity,
and confirm the runner recovers after another container restart.

### Protecting an existing 3x-ui panel

`Caddy.xui.example` gates only `/xui/*` and keeps the existing canonical redirect,
native panel login and separate `/v2ray` route. Add the owner/two_factor resource
to Authelia. The gateway cookie is masked before reaching the panel backend.
Panel API/automation clients also need gateway authorization. This is not a
software vulnerability fix. Review security updates separately and obtain the
operator's approval before any disruptive maintenance or software upgrades.

### Public-source boundary

Keep runtime directories, private deployment notes, account databases, keys,
certificates, notification messages, login-delivery HTML, logs and backups
outside the repository. Use `example.com` and example account names in committed
material. Never copy live secrets into tests, screenshots, build inputs or CI
logs. Review the exact staged diff and commit identity before publishing; ignore
rules are a secondary safeguard, not a substitute for a credential scan.

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
