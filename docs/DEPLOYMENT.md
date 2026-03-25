# Hisaabo Deployment Guide

## Architecture Overview

```
                  Cloudflare Pages           Cloudflare Pages
                  +--------------+           +--------------+
   Users -------> | apps/web     |           | apps/store   |
                  | (React SPA)  |           | (Store SPA)  |
                  +------+-------+           +------+-------+
                         |                          |
                         |   HTTPS (tRPC / REST)    |
                         +----------+---------------+
                                    |
                                    v
                  +-------------------------------+
                  | api.hisaabo.in (nginx)        |
                  | - /api/*   -> tRPC            |
                  | - /store/* -> public catalog  |
                  | - /health  -> health check    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | hisaabo-api (Docker / GHCR)   |
                  | packages/api + db + shared    |
                  | Runs migrations on startup    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | PostgreSQL 16                  |
                  | (managed or self-hosted)       |
                  +-------------------------------+
```

## CI/CD Pipeline

### On every PR and push to `main`

**`ci.yml`** runs typecheck, lint, and build for the entire monorepo. On PRs it also does a Docker build dry-run (no push) to catch Dockerfile issues early.

### On push to `main` (path-filtered)

| Workflow | Trigger paths | Action |
|---|---|---|
| `deploy-web.yml` | `apps/web/**`, `packages/shared/**`, `packages/api/src/index.ts` | Build web SPA, deploy to Cloudflare Pages |
| `deploy-store.yml` | `apps/store/**` | Build store SPA, deploy to Cloudflare Pages |
| `deploy-api.yml` | `packages/api/**`, `packages/db/**`, `packages/shared/**`, `Dockerfile` | Build Docker image, push to GHCR |

## Environment Variables

### Cloudflare Pages (Web App)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | API server URL (build-time) | `https://api.hisaabo.in` |

### Cloudflare Pages (Store)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | API server URL (build-time) | `https://api.hisaabo.in` |

### Backend (Docker / GHCR)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@host:5432/hisaabo` |
| `PORT` | No | API port (default 3000) | `3000` |
| `NODE_ENV` | Yes | Environment | `production` |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins | `https://app.hisaabo.in,https://store.hisaabo.in` |
| `APP_URL` | Yes | Frontend URL (for magic links) | `https://app.hisaabo.in` |
| `RESEND_API_KEY` | No | Email service API key | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Hisaabo <noreply@hisaabo.in>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only) | `postgresql://...` |

### GitHub Actions Secrets

| Secret | Used by | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy-web, deploy-store | Cloudflare API token with Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-web, deploy-store | Cloudflare account ID |
| `VITE_API_URL` | deploy-web, deploy-store | API URL injected at build time |

Note: `GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR pushes.

## Self-Hosting with Docker Compose

### Quick start

1. Clone the repo and copy the env file:

```bash
cp .env.example .env
# Edit .env with your production values
```

2. Update `docker-compose.prod.yml`:
   - Replace `ghcr.io/OWNER/hisaabo-api:latest` with your actual GHCR image path
   - Set a strong `POSTGRES_PASSWORD`

3. Start the stack:

```bash
docker compose -f docker-compose.prod.yml up -d
```

4. Verify health:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-25T..."}
```

### Updating

```bash
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

The entrypoint script runs pending migrations automatically before starting the server.

## Kamal / Once.com Compatibility

The `docker-compose.prod.yml` is compatible with Kamal's deploy model:

- Health check endpoint: `GET /health` on port 3000
- The container runs migrations on startup (idempotent)
- Graceful shutdown: entrypoint uses `exec` so Node receives SIGTERM directly
- Image is tagged with both `latest` and the commit SHA for rollback

## Nginx Reverse Proxy

The `nginx/nginx.conf` provides:

- Upstream keepalive connections to the API container
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- Gzip compression for JSON responses
- Path-based routing (`/api/*`, `/store/*`, `/health`)
- Appropriate timeouts for PDF generation endpoints (30s) and tRPC (120s)
- 10MB request body limit for bulk import operations
- Catalog response caching (60s) for store routes

### TLS Termination

TLS is expected to be terminated upstream (Cloudflare Tunnel, Caddy, or a cloud load balancer). The nginx config listens on port 80 only. If you need nginx to handle TLS directly, add an `ssl` server block with your certificate paths.
