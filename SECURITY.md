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

### Authentication
- **Magic link (passwordless)** as primary auth method — tokens are SHA-256 hashed before storage, single-use, 15-minute expiry
- **Argon2id** password hashing for password-based auth (memory-hard, GPU-resistant)
- **Session-based auth** with HttpOnly, Secure, SameSite=Lax cookies
- 30-day session expiry with server-controlled invalidation
- Rate limiting on magic link requests (5 per email per 15 minutes)

### Authorization
- **CASL-based RBAC** with 5 roles and granular per-resource permissions
- Business isolation middleware scopes all queries to the authenticated user's business
- Sellers cannot modify tax rates or discounts (enforced server-side)

### Transport & Headers
- HTTPS enforced in production (HSTS)
- Content-Security-Policy, X-Frame-Options, X-Content-Type-Options headers
- CORS restricted to configured origins

### Rate Limiting
- 600 requests/min for authenticated users
- 60 requests/min for anonymous requests
- Per-IP enforcement via Hono middleware

### Input Validation
- Every tRPC procedure validates input with Zod schemas from `@hisaabo/shared`
- SQL injection prevented by Drizzle ORM parameterized queries
- XSS prevented by React's default escaping + explicit `escapeHtml()` in email templates

### Data
- All monetary values use PostgreSQL `NUMERIC(15,2)` — no floating point
- Fixed-point `money` module for all server-side arithmetic (integer paise internally)
- Audit log tracks every mutation with user ID, entity, action, and IP address

### Online Store
- Cloudflare Turnstile for bot protection on orders and phone verification
- Phone verification before checkout (no anonymous orders)
- Public catalog endpoint never exposes: purchase prices, exact stock quantities, HSN codes, SKUs, or internal business fields

### VPS Hardening (self-hosted)

For production self-hosted deployments:

```
- UFW firewall: allow only SSH (22), HTTP (80), HTTPS (443)
- fail2ban for SSH brute force protection
- SSH key-only auth (disable password login)
- PostgreSQL bound to localhost only
- TLS via Caddy or nginx with Let's Encrypt
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
