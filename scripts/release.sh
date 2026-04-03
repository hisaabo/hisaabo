#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo unified release script ──────────────────────────────────────────
# Usage: pnpm release <version>
# Example: pnpm release 0.2.0
#
# This script:
#   1. Validates the version format (semver, no "v" prefix)
#   2. Bumps version in ALL package.json files, app.json, tauri.conf.json, Cargo.toml
#   3. Commits the version bump
#   4. Creates a git tag (v<version>)
#   5. Prints the push command (does NOT push automatically)

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: pnpm release <version>"
  echo "Example: pnpm release 0.2.0"
  exit 1
fi

# Validate semver format (x.y.z, optional pre-release)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: Version must be semver format (e.g., 0.2.0 or 1.0.0-beta.1)"
  exit 1
fi

TAG="v${VERSION}"

# Must be on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Releases must be created from the main branch."
  echo "  Current branch: $CURRENT_BRANCH"
  echo "  Run: git checkout main"
  exit 1
fi

# Must be up to date with remote
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "Error: Local main is not up to date with origin/main."
  echo "  Run: git pull origin main"
  exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

echo "Releasing Hisaabo $TAG"
echo ""

# ─── Bump all package.json files ─────────────────────────────────────────────
PACKAGE_FILES=(
  package.json
  packages/api/package.json
  packages/cli/package.json
  packages/db/package.json
  packages/mcp/package.json
  packages/shared/package.json
  apps/web/package.json
  apps/mobile/package.json
  apps/store/package.json
  apps/docs/package.json
  apps/api-docs/package.json
)

for f in "${PACKAGE_FILES[@]}"; do
  if [ -f "$f" ]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$f', 'utf8'));
      pkg.version = '$VERSION';
      fs.writeFileSync('$f', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "  bumped $f"
  fi
done

# ─── Bump app.json (Expo) ───────────────────────────────────────────────────
APPJSON="apps/mobile/app.json"
if [ -f "$APPJSON" ]; then
  node -e "
    const fs = require('fs');
    const app = JSON.parse(fs.readFileSync('$APPJSON', 'utf8'));
    app.expo.version = '$VERSION';
    fs.writeFileSync('$APPJSON', JSON.stringify(app, null, 2) + '\n');
  "
  echo "  bumped $APPJSON"
fi

# ─── Bump tauri.conf.json ───────────────────────────────────────────────────
TAURI_CONF="apps/desktop/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF" ]; then
  sed -i.bak "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" "$TAURI_CONF"
  rm -f "${TAURI_CONF}.bak"
  echo "  bumped $TAURI_CONF"
fi

# ─── Bump Cargo.toml ────────────────────────────────────────────────────────
CARGO_TOML="apps/desktop/src-tauri/Cargo.toml"
if [ -f "$CARGO_TOML" ]; then
  sed -i.bak "s/^version = \".*\"/version = \"${VERSION}\"/" "$CARGO_TOML"
  rm -f "${CARGO_TOML}.bak"
  echo "  bumped $CARGO_TOML"
fi

echo ""

# ─── Amend version bump into HEAD and tag ───────────────────────────────────
git add -A
git commit --amend --no-edit
git tag "$TAG"

echo "Done. Version bumped to $VERSION, amended into HEAD, and tagged as $TAG."
echo ""
echo "To publish:"
echo "  git push origin main --tags --force-with-lease"
echo ""
