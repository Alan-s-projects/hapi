# Alan's HAPI build tracking

This fork tracks the proposed prefix-aware Docker build of HAPI. Upstream source
and its AGPL-3.0 license are retained.

## Current status

- Upstream: <https://github.com/tiann/hapi>
- Fork: <https://github.com/Alan-s-projects/hapi>
- Working branch: `codex/hapi-prefix`
- Starting release: `v0.30.7`
- Starting commit: `0239edf38e2da653d662f31039e24ccea04c7837`
- Existing deployment: unmodified HAPI 0.30.7 with official Codex CLI 0.155.1.
- This initial fork commit documents the work only. Prefix changes, a custom
  image, frp deployment, public routing and MFA are **not implemented yet**.

Keep `main` aligned with upstream. Build and verify the prefix patch on this
branch before replacing a running image. Do not claim a release is deployable
until its actual image and end-to-end checks have passed.

## Prefix-aware build scope

Target browser URL: `https://your-domain/hapi/`.

The existing release has root-relative page routes, API paths and Socket.IO
paths. The Vite asset base alone is not complete subpath support. Changing only
the reverse proxy or HAPI_PUBLIC_URL does not fix those routes.

1. Centralize and normalize the external application base path.
2. Apply it consistently to browser navigation, REST, SSE, terminal WebSockets,
   static assets, deep links, service worker and PWA URLs.
3. Preserve runner-to-hub communication and authentication isolation.
4. Preserve the unprefixed default and existing users' configuration.
5. Build a pinned image with the intended base path and provide an explicit
   reverse-proxy contract (which component strips or retains the prefix).
6. Publish source changes and reproducible build instructions with any custom
   network-served release, in accordance with the upstream license.

### Acceptance checks before public deployment

- Login/logout and expired-token handling under the prefix.
- New sessions, history, deep-link refresh and resume-on-send.
- Chat streaming, reconnects, approvals and interactive questions.
- Terminal WebSockets, uploads/downloads and generated-media links.
- PWA scope, service-worker updates and mobile browser behavior.
- No unexpected root-level `/api`, `/sessions`, `/assets` or `/socket.io` traffic.
- Upstream-default behavior, runner communication and namespace isolation.
- Persistence after restart and rollback to the prior image.

Reuse a long-running Linux Docker development container for build, test and
test deployment. Do not use the live service's data as test fixtures.

## Proposed frp transport security

frp is a tunnel transport, not browser login protection and not a URL-rewriting
fix. Keep the Codex engine and HAPI local; use the remote VM as an HTTPS gateway.

- Pin a reviewed frp release; v0.71.0 was inspected during planning.
- Force TLS on frps and enable TLS on frpc.
- Set a trusted CA and the expected server name explicitly on the client.
  In v0.71.0, omitting the trusted CA enables InsecureSkipVerify; the default
  encrypted connection alone must not be treated as server authentication.
- Use separate server/client certificates and configure the server's trusted CA
  to require and verify client certificates (mutual TLS).
- Add a dedicated high-entropy token, including authentication for heartbeats
  and new work connections. Load secrets from protected files, not Git.
- Limit allowed forwarding ports and client port count to the one HAPI service.
- Keep the forwarded application port Docker-private; do not publish it.
- Keep frp administration/dashboard disabled and leave VM admin keys out of the
  application and tunnel containers.
- Authenticate browsers separately at HAPI and a suitable MFA gateway.
- Preserve other applications' routing. A URL prefix is not a browser-origin
  security boundary.

Reference:
<https://github.com/fatedier/frp/blob/v0.71.0/pkg/transport/tls.go>

Public firewall/routing changes, certificate enrollment and public deployment
are separate execution steps. No production credentials or infrastructure
private keys belong in this repository.
