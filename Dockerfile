# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# pnpm via corepack (pinned to match packageManager field)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config + lockfile first (cache layer for deps)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/api/package.json packages/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# Install ALL deps (need devDependencies for build)
# Mount pnpm store cache to avoid re-downloading packages across builds
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code for backend packages only
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY packages/api/ packages/api/

# Build the API (tsup bundles server.ts + pdf-worker via tsup.config.ts)
RUN pnpm --filter @hisaabo/api build

# Bundle the migration runner into a standalone JS file (no tsx needed at runtime).
# External: node_modules (resolved at runtime), built-ins handled by node.
# Output goes to packages/db/dist/migrate.mjs alongside the migration SQL dirs.
# Entry is migrate-cli.ts (thin wrapper) — migrate.ts itself has no top-level
# side effects so importing it from application code does NOT run migrations.
RUN pnpm --filter @hisaabo/db exec esbuild src/migrate-cli.ts \
      --bundle --platform=node --format=esm \
      --target=node22 \
      --outfile=dist/migrate.mjs \
      --external:postgres --external:drizzle-orm --external:dotenv

# ── Stage 2: Production runtime ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace scaffolding
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# -- API package: built output + fonts
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/api/dist/ packages/api/dist/
COPY packages/api/fonts/ packages/api/fonts/

# -- DB package: compiled migration runner + migration SQL files
COPY packages/db/package.json packages/db/
COPY --from=builder /app/packages/db/dist/migrate.mjs packages/db/dist/
COPY packages/db/drizzle/ packages/db/drizzle/
COPY packages/db/drizzle-control/ packages/db/drizzle-control/
COPY packages/db/drizzle-tenant/ packages/db/drizzle-tenant/

# -- Shared package: package.json only (code is inlined by tsup)
COPY packages/shared/package.json packages/shared/

# Install production deps only — keeps the image lean (no tsup, vitest, etc.)
# argon2 needs a rebuild on alpine (native addon).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── Smoke test: catch module resolution errors at build time ──
# This would have caught the control-schema.js error before deployment.
RUN node --check packages/api/dist/server.js && \
    node -e "import('file:///app/packages/api/dist/server.js').catch(e => { \
      if (e.code === 'ERR_MODULE_NOT_FOUND') { console.error('FATAL:', e.message); process.exit(1); } \
    })"

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ARG VERSION=dev
LABEL org.opencontainers.image.title="Hisaabo API"
LABEL org.opencontainers.image.description="Invoicing and business management API"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/hisaabo/hisaabo"

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HISAABO_VERSION=${VERSION}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
