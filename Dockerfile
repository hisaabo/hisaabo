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

# npm/corepack/pnpm are build-time only: the base image's global copies (and the corepack-prepared pnpm) carry unfixable CVEs and the runtime only needs `node`.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/pnpm /usr/local/bin/pnpx \
           /root/.cache /root/.local/share/pnpm /root/.npm \
           "${COREPACK_HOME:-/nonexistent}" \
    && for b in npm npx pnpm pnpx corepack; do ! command -v "$b" >/dev/null || { echo "FATAL: $b still present" >&2; exit 1; }; done

# ── Guard: no build tooling in the runtime image ──────────────
# esbuild/drizzle-kit/tsx ship Go/native binaries that Trivy flags and that the
# runtime never needs (migrations run from the pre-bundled dist/migrate.mjs).
# They are devDependencies of @hisaabo/db; fail the build if they sneak back in.
RUN if find /app -path '*/node_modules/*' \( -name esbuild -o -name '@esbuild' -o -name tsx -o -name drizzle-kit \) | grep -q .; then \
      echo "FATAL: build tooling (esbuild/tsx/drizzle-kit) present in runtime image" >&2; exit 1; \
    fi

# ── Smoke test: catch module resolution errors at build time ──
# This would have caught the control-schema.js error before deployment.
RUN node --check packages/api/dist/server.js && \
    node -e "import('file:///app/packages/api/dist/server.js').catch(e => { \
      if (e.code === 'ERR_MODULE_NOT_FOUND') { console.error('FATAL:', e.message); process.exit(1); } \
    })"

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Persistent object storage (item images, STORAGE_DRIVER=local). The API runs as
# the unprivileged `node` user (uid 1000); this is the only path it needs to
# write besides the OS temp dir. Mount a volume at /storage to persist it.
RUN mkdir -p /storage/objects && chown -R node:node /storage
VOLUME ["/storage"]

ARG VERSION=dev
LABEL org.opencontainers.image.title="Hisaabo API"
LABEL org.opencontainers.image.description="Invoicing and business management API"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/hisaabo/hisaabo"

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HISAABO_VERSION=${VERSION}
ENV STORAGE_LOCAL_DIR=/storage/objects

# Drop root: application code under /app stays root-owned and read-only to it.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:3000/health?deep=true" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
