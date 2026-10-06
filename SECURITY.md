# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Hisaabo, **please report it responsibly**. Do not open a public GitHub issue.

**Email:** security@hisaabo.in

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation plan within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | No — please upgrade |

## Security Architecture

This section describes what the code does today. Where a protection depends on how you deploy Hisaabo, it says so.

### Authentication
- **Magic link (passwordless)** as primary auth method — tokens are SHA-256 hashed before storage, single-use, 15-minute expiry
- **Argon2id** password hashing for password-based auth (memory-hard, GPU-resistant)
- **Web sessions:** HttpOnly, `SameSite=Lax` cookie, 30-day expiry with server-controlled invalidation. The `Secure` flag is set when `APP_URL` starts with `https`.
- **Mobile / desktop / CLI sessions:** Bearer session tokens with a 7-day sliding window and a 30-day absolute cap. Short-lived (15-minute) access tokens can be issued for Bearer sessions; web cookie sessions never receive them.
- Per-email limits: 5 magic-link requests per 15 minutes; 5 failed password logins per 15 minutes
- **No phone OTP.** Phone numbers are not an authentication factor anywhere in Hisaabo.

### Authorization
- **CASL-based RBAC** with 5 roles (`superadmin`/owner, `admin`, `seller_manager`, `seller`, `accountant`) and per-resource create/read/update/delete grants defined in `packages/shared/src/permissions.ts`; every tRPC procedure checks its grant server-side
- Business isolation: queries are scoped to the authenticated user's tenant and business, and `scripts/check-ownership-scoping.ts` runs in CI to flag procedures that accept a client-supplied id without scoping it
- Role permissions are resource-level. Field-level restrictions inside a permitted action (for example limiting what a `seller` may change on an invoice line) are only claimed where the API code enforces them; do not assume a role-level grant implies field-level limits.

### Transport & Headers
- **TLS is a deployment responsibility.** The API and the bundled nginx config speak plain HTTP; terminate TLS in front of them (Caddy, a cloud load balancer, Cloudflare Tunnel). Hono's `secureHeaders()` emits an HSTS header from the API, and `nginx/nginx.conf` emits HSTS only for requests the edge proxy marks `X-Forwarded-Proto: https`; HSTS has no effect unless clients actually reach you over HTTPS.
- **Content-Security-Policy** is set by the web and store frontends (`apps/web/public/_headers` on Cloudflare Pages, a CSP meta tag, and the Tauri desktop CSP). The API itself sets a restrictive CSP only on its small HTML pages (landing, UPI pay link, 404); its JSON responses carry `X-Content-Type-Options: nosniff` and the other `secureHeaders()` defaults.
- CORS is restricted to `CORS_ORIGINS` plus the first-party desktop webview origins.
- **CSRF:** cookie-authenticated, state-changing non-tRPC requests must carry `X-Requested-With: hisaabo`; tRPC enforces the same check in middleware. Bearer-token requests are exempt (not ambient credentials).

### Trusted Proxy / Client IP
Rate limits, lockouts, audit entries and fail2ban all key on the client IP, and forwarding headers are attacker-controlled unless a proxy you operate sets them. The API therefore only trusts them as configured:

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY_HOPS` | `1` | Number of trusted reverse proxies in front of the API that append to `X-Forwarded-For`. The client IP is the Nth entry from the right. `0` = the API is exposed directly; forwarding headers are ignored and the socket address is used. |
| `TRUST_CLOUDFLARE` | `false` | `true` to honour `cf-connecting-ip`. Enable only when the origin is reachable exclusively through Cloudflare (Tunnel, or firewall restricted to Cloudflare ranges). |

Set these to match your topology: one proxy → `1`; two chained proxies → `2`; direct exposure → `0`. A wrong value either lets clients spoof their IP (too high) or collapses all clients into the proxy's address (too low). `nginx/nginx.conf` overwrites `X-Forwarded-For` with the connecting address and strips `CF-Connecting-IP`; it documents how to enable `real_ip` when a TLS proxy or Cloudflare sits in front of it. `docker-compose.prod.yml` publishes the API on `127.0.0.1` only, so a reverse proxy on the host is the intended path.

### Rate Limiting
In-memory, per client IP, per API process (not shared across replicas), plus coarse limits in the bundled nginx config:

- **tRPC (`/api/trpc/*`):** 300 req/min same-origin with a plausibly-shaped credential; 60 same-origin without; 120 external with a credential; 10 external without. A cheap credential-shape check decides the tier, so forged tokens do not earn the higher tier.
- **Credential endpoints** (`auth.login`, `auth.register`, `auth.sendMagicLink`, `auth.verifyMagicLink`, `auth.confirmEmailChange`, `tenant.peekInvitation`): an additional 20 procedure calls/min per IP regardless of headers; each procedure in a tRPC batch counts. Batches are capped at 25 calls.
- **PDF endpoints:** 30/min per IP
- **Public store:** 20/min per IP per endpoint for order, identify, logo, images, OG image, meta and page shell; 120/min per IP for the catalog; 5 orders/min per phone number
- Request bodies: 10 MB for tRPC, 256 KB for `/store/*`, 1 MB for `/webhooks/*`
- Throttling events are logged as structured `sec` events for fail2ban (see `docs/fail2ban/README.md`; ban effectiveness depends on correct client IPs, above).

### Input Validation
- Every tRPC procedure validates input with Zod schemas from `@hisaabo/shared`
- SQL injection prevented by Drizzle ORM parameterized queries
- XSS prevented by React's default escaping + explicit `escapeHtml()` in email templates and server-rendered HTML

### Data
- All monetary values use PostgreSQL `NUMERIC(15,2)` — no floating point
- Fixed-point `money` module for all server-side arithmetic (integer paise internally)
- Sensitive fields (e-invoice credentials, carrier API keys, tenant DB passwords) are encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY`; supports rotation via `ENCRYPTION_KEY_PREVIOUS`

### Audit Log
Mutations in these areas write an audit record (user, action, entity, metadata, IP): invoices and the other document types, payments, parties, items and item images, expenses, shipments, sales targets, bank accounts, recurring invoices, and business settings.

Not covered by the audit log today: authentication and sessions, tenant membership changes, API-key creation/revocation, journal entries and chart of accounts, GST/e-invoice/e-way-bill/ITC/GSTR-2B/bank-reconciliation actions, data import, and tenant self-export/self-import. Security-relevant events in some of these areas (failed logins, lockouts, rate limits, CSRF/origin blocks) go to the structured `sec` application log instead. Audit writes are best-effort: a failed write is logged and does not fail the user's operation.

### Online Store
- Cloudflare Turnstile for bot protection on orders and phone lookup (`TURNSTILE_SECRET_KEY`; in production a missing key rejects requests rather than skipping the check)
- The phone lookup endpoint is Turnstile-gated and deliberately returns a uniform response, so it does not reveal whether a number belongs to an existing customer. **There is no OTP/phone verification**: a phone number on an order is self-asserted, and orders are throttled per IP and per number.
- Public catalog endpoint never exposes: purchase prices, exact stock quantities, HSN codes, SKUs, or internal business fields

### API Keys
- Keys (`hisaabo_key_…`) are shown once, stored only as a SHA-256 hash, and identified by a 20-character prefix
- **Expiry:** 90 days by default; a custom expiry is accepted up to 365 days. Expired keys are rejected at authentication.
- **Role inheritance:** a key has no scopes of its own. It acts as the user who created it, in the tenant it was created for, with that user's *current* role. A key made by an owner has owner power; demoting or removing the user immediately constrains or disables the key. Create keys from a least-privileged account for integrations.
- Only owners/admins can list, create or revoke keys, and a key (or any non-interactive credential) cannot create or revoke keys
- Plan limits apply to the number of keys per tenant

### MCP Server (`@hisaabo/mcp`)
The MCP server lets an AI agent act on a business with a user's API key, so it is read-only by default.

| Variable | Purpose |
|---|---|
| `HISAABO_API_URL`, `HISAABO_API_KEY`, `HISAABO_TENANT_ID`, `HISAABO_BUSINESS_ID` | Required connection settings |
| `HISAABO_MCP_MODE` | `readonly` (default), `write`, or `admin` — which tiers of tools are registered |
| `HISAABO_MCP_ENABLE_ADMIN=1` | Additionally required (with `mode=admin`) to expose admin-tier tools |
| `HISAABO_ALLOW_INSECURE=1` | Allow plain `http://` to a non-loopback host (off by default) |
| `HISAABO_ALLOW_SESSION_TOKEN=1` | Accept a session token instead of an API key (off by default) |
| `HISAABO_MCP_MAX_FIELD_LENGTH` | Max characters per string field returned to the agent (default 500), limiting prompt-injection and data-spill surface |

Treat everything an agent reads from your data as untrusted input to the model. Prefer `readonly`, use a dedicated key with an expiry, and do not enable `write`/`admin` on agents that also read untrusted content. Procedures excluded from MCP for security reasons are listed with a `[security]` tag in `parity-exceptions.yaml`.

### CLI and MCP Credential Handling
- **CLI:** `hisaabo login` stores the API URL, token and active business in a per-user config file with mode `0600` inside a `0700` directory. For CI or shared machines prefer the `HISAABO_TOKEN` (and `HISAABO_API_URL`, `HISAABO_TENANT_ID`, `HISAABO_BUSINESS_ID`) environment variables over a stored config; `hisaabo logout` clears the file.
- **MCP:** credentials come only from environment variables set in the MCP host's configuration; the server stores nothing. Anyone who can read that host config can use the key, so keep it out of shared dotfiles and repositories.
- Both clients refuse plain `http://` to non-loopback hosts unless explicitly overridden, and the CLI strips terminal control characters from server-supplied text before printing.
- Revoke a leaked key immediately from Settings → API Keys (or `apiKey.revoke`).

### Backups
`scripts/backup.sh` (the `backup` sidecar in `docker-compose.prod.yml`) writes a base backup plus per-database SQL dumps:

- Files are created with `umask 077`; the sidecar's `/etc/backup.env` and `rclone.conf` are `0600`.
- When `BACKUP_ENCRYPTION_KEY` is set, every file is encrypted with `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` (suffix `.enc`) and the plaintext is removed. AES-CBC is not authenticated; each file is also gzip-checked after decryption on restore, and you should protect the bucket against tampering.
- **Offsite (R2/S3) upload is refused when `BACKUP_ENCRYPTION_KEY` is unset**: the job fails with a clear error and keeps the local backup. Local-only backups without a key are stored unencrypted, so protect the volume.
- If a run fails before completing, plaintext and partial files from that run are deleted.
- Remote retention only deletes under the `base/` and `dumps/` prefixes.
- `scripts/restore-db.sh` restores into a scratch database, verifies it, then swaps it in, so a bad dump never replaces a good database. It decrypts `.enc` files and still reads legacy `.age` files (age prompts for its passphrase interactively).
- Keep `BACKUP_ENCRYPTION_KEY` somewhere other than the server; without it backups cannot be restored.

### Self-Hosting Hardening
`docker-compose.prod.yml` ships with: API published on loopback only, API container running as the unprivileged `node` user with a read-only root filesystem and all capabilities dropped, `no-new-privileges` on every service, Postgres receiving only its own three environment variables, and `POSTGRES_PASSWORD` required. The release workflow signs published images with cosign (keyless) and attaches provenance and an SBOM. CI runs dependency audit, CodeQL, secret scanning and Trivy (`.github/workflows/security.yml`); GitHub Actions are pinned by commit SHA and kept current by Dependabot.

For production self-hosted deployments also:

```
- UFW firewall: allow only SSH (22), HTTP (80), HTTPS (443)
- fail2ban (SSH and the Hisaabo jails; see docs/fail2ban/README.md for the DOCKER-USER chain caveat)
- SSH key-only auth (disable password login)
- PostgreSQL not published on a public interface (the dev compose file binds 127.0.0.1)
- TLS via Caddy or nginx with Let's Encrypt in front of the API
- TRUST_PROXY_HOPS / TRUST_CLOUDFLARE set to match your proxy topology
- WAL archiving for point-in-time recovery
```

## Scope

The following are **in scope** for security reports:
- Authentication/authorization bypasses
- SQL injection, XSS, CSRF
- Data exposure (accessing another business's data)
- Session fixation or hijacking
- Rate limiting bypasses
- Sensitive data in logs or error messages

The following are **out of scope**:
- Denial of service (volumetric)
- Social engineering
- Vulnerabilities in dependencies (report to the upstream project)
- Issues requiring physical access to the server
