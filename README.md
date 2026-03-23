# Billbook

A modern, self-hosted invoicing and business management app — a lightweight, privacy-first replacement for Vyaapaar/Khatabook. Built for speed, type-safety, and reliability.

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19 + Vite + TanStack Router | Fastest dev cycle, code-splitting, Tauri-native |
| Styling | Tailwind CSS + CSS custom properties | Dark mode, design tokens, zero runtime |
| API Contract | tRPC v11 | End-to-end type safety, no codegen |
| Server | Hono on Node/Bun | 14KB, Web Standards, runs anywhere |
| ORM | Drizzle | Type-safe SQL, readable queries, no binary |
| Database | PostgreSQL 16 | ACID, NUMERIC for money, WAL for PITR |
| Auth | Session-based (Argon2id + HttpOnly cookies) | No JWT leaks, server-controlled |
| Desktop | Tauri v2 | Lightweight native shell for the web app |
| Monorepo | Turborepo + pnpm workspaces | Shared types, parallel builds |
| Deploy | Cloudflare Pages (web) + VPS (API + DB) | Free hosting for frontend, full DB control |

## Quick start

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Docker (for local PostgreSQL)

### Setup

```bash
# Clone and install
git clone <your-repo>
cd billbook
pnpm install

# Start PostgreSQL
docker compose up -d

# Set environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run database migrations
pnpm db:generate
pnpm db:migrate

# Start development servers (API + web)
pnpm dev
```

The web app runs at `http://localhost:5173` with the API proxied through Vite at `http://localhost:3000`.

## Project structure

```
billbook/
├── apps/
│   ├── web/                 # React SPA (Cloudflare Pages)
│   │   ├── src/
│   │   │   ├── routes/      # TanStack file-based routes
│   │   │   ├── lib/         # tRPC client, utils
│   │   │   └── styles/      # Global CSS + Tailwind
│   │   └── wrangler.json    # CF Pages config
│   └── desktop/             # Tauri v2 shell
│       └── src-tauri/
├── packages/
│   ├── api/                 # Hono + tRPC server
│   │   └── src/
│   │       ├── routers/     # auth, business, party, item, invoice, payment, expense, dashboard
│   │       ├── context.ts   # Session-based auth context
│   │       ├── trpc.ts      # Procedures + middleware
│   │       └── server.ts    # Hono server entry
│   ├── db/                  # Drizzle schema + client
│   │   └── src/schema.ts    # Complete data model
│   └── shared/              # Zod validators + types
│       └── src/validators.ts
├── scripts/
│   ├── backup.sh            # Automated pg_basebackup + R2
│   └── postgresql-wal.conf  # WAL archiving config
├── docker-compose.yml       # Local PostgreSQL
└── turbo.json               # Build pipeline
```

## Data model

The schema covers a complete invoicing workflow:

- **Users & sessions** — Argon2id passwords, server-side sessions
- **Businesses** — Multi-business support per user, GST/PAN, custom invoice prefixes
- **Parties** — Customers and suppliers with balance tracking
- **Items** — Products/services with HSN, stock quantities, low-stock alerts
- **Invoices** — Sale/purchase with auto-numbered invoice generation, line items, tax calculation
- **Payments** — Multi-mode (cash/bank/UPI/cheque), auto-links to invoices, auto-status updates
- **Expenses** — Categorized expenses with summaries
- **Audit log** — Every mutation is tracked with user, entity, IP

All monetary values use PostgreSQL `NUMERIC(15,2)` — no floating point rounding.

## Security

### Application layer

- **Session auth** with HttpOnly, Secure, SameSite=Lax cookies
- **Argon2id** password hashing (memory-hard, GPU-resistant)
- **CSRF protection** via SameSite cookies + origin checking
- **Rate limiting** — 120 req/min per IP via Hono middleware
- **Secure headers** — CSP, X-Frame-Options, HSTS
- **Input validation** — Every tRPC procedure uses Zod schemas from `@billbook/shared`
- **Business isolation** — All queries scoped to authenticated user's business via middleware

### VPS hardening checklist

```bash
# UFW firewall — only allow SSH, HTTP, HTTPS
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Fail2ban — block brute force
sudo apt install fail2ban
sudo systemctl enable fail2ban

# SSH hardening
# In /etc/ssh/sshd_config:
#   PasswordAuthentication no
#   PermitRootLogin no
#   AllowUsers youruser

# TLS via Caddy (auto-HTTPS)
sudo apt install caddy
# Caddyfile:
# api.yourdomain.com {
#     reverse_proxy localhost:3000
# }

# PostgreSQL — bind to localhost only
# In postgresql.conf:
#   listen_addresses = 'localhost'
```

## Backup & recovery

### Automated backups (run via cron)

```bash
# Daily at 2 AM
0 2 * * * /opt/billbook/scripts/backup.sh >> /var/log/billbook-backup.log 2>&1
```

The backup script:
1. Takes a full `pg_basebackup` (compressed)
2. Creates a portable SQL dump
3. Uploads both to Cloudflare R2 via rclone
4. Cleans up local backups older than 30 days
5. Verifies backup integrity

### WAL archiving for point-in-time recovery

Apply `scripts/postgresql-wal.conf` to your PostgreSQL config. This enables continuous WAL archiving — you can restore to any transaction, not just the last snapshot.

### Restore from backup

```bash
# From SQL dump (portable)
gunzip -c dump_20240101_020000.sql.gz | psql -U billbook -d billbook

# From base backup (full PITR)
pg_restore -U billbook -d billbook base_20240101_020000.tar.gz
```

## Deployment

### Frontend → Cloudflare Pages

```bash
# Connect your repo to Cloudflare Pages
# Build command: cd apps/web && pnpm build
# Output directory: apps/web/dist
# Environment: NODE_VERSION=20
```

### API → VPS

```bash
# On your VPS
git pull
pnpm install
pnpm db:migrate
pnpm --filter @billbook/api build

# Run with systemd or PM2
pm2 start packages/api/dist/server.js --name billbook-api
```

### Desktop → Tauri

```bash
cd apps/desktop
cargo tauri build
# Outputs .dmg (macOS), .msi (Windows), .AppImage (Linux)
```

## Development commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (DB browser) |
| `pnpm typecheck` | Type-check all packages |

## License

Private — All rights reserved.
