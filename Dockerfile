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

# Build the API (tsup bundles server.ts -> dist/server.js)
# tsup only bundles the main entry; the pdf-worker needs separate compilation
RUN pnpm --filter @hisaabo/api build && \
    cd packages/api && \
    npx tsup src/lib/pdf-worker.ts --format esm --out-dir dist/lib

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

# -- DB package: source (imported at runtime via workspace:*), migrations, config
COPY packages/db/package.json packages/db/
COPY packages/db/src/ packages/db/src/
COPY packages/db/drizzle.config.ts packages/db/
COPY packages/db/tsconfig.json packages/db/

# -- Shared package: source (imported at runtime via workspace:*)
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Install all dependencies (drizzle-kit + tsx needed at runtime for schema push)
# argon2 needs a rebuild on alpine (native addon)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
