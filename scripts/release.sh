#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo version bump ─────────────────────────────────────────────────
# Usage: pnpm release <version>
# Example: pnpm release 0.5.0
#
# Updates the version in ALL package.json files, app.json (Expo),
# tauri.conf.json (Desktop), and commits the change.
# Run `pnpm release:tag` afterwards to tag and push.

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: pnpm release <version>"
  echo "Example: pnpm release 0.5.0"
  exit 1
fi

# Validate semver format (x.y.z, optional pre-release)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: Version must be semver format (e.g., 0.5.0 or 1.0.0-beta.1)"
  exit 1
fi

TAG="v${VERSION}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# ─── Bump versions ─────────────────────────────────────────────────────────

# All package.json files (root + apps + packages)
PACKAGE_FILES=(
  package.json
  apps/api-docs/package.json
  apps/docs/package.json
  apps/mobile/package.json
  apps/store/package.json
  apps/web/package.json
  packages/api/package.json
  packages/cli/package.json
  packages/db/package.json
  packages/mcp/package.json
  packages/shared/package.json
)

echo "Bumping all packages to $VERSION..."
echo ""

for f in "${PACKAGE_FILES[@]}"; do
  if [ -f "$f" ]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$f', 'utf8'));
      const old = pkg.version;
      pkg.version = '$VERSION';
      fs.writeFileSync('$f', JSON.stringify(pkg, null, 2) + '\n');
      console.log('  ' + '$f'.padEnd(42) + old + ' → $VERSION');
    "
  fi
done

# Expo app.json (version lives under expo.version)
if [ -f apps/mobile/app.json ]; then
  node -e "
    const fs = require('fs');
    const app = JSON.parse(fs.readFileSync('apps/mobile/app.json', 'utf8'));
    const old = app.expo.version;
    app.expo.version = '$VERSION';
    fs.writeFileSync('apps/mobile/app.json', JSON.stringify(app, null, 2) + '\n');
    console.log('  apps/mobile/app.json (expo)'.padEnd(42) + old + ' → $VERSION');
  "
fi

# Tauri conf (version at top level)
if [ -f apps/desktop/src-tauri/tauri.conf.json ]; then
  node -e "
    const fs = require('fs');
    const conf = JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
    const old = conf.version;
    conf.version = '$VERSION';
    fs.writeFileSync('apps/desktop/src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
    console.log('  apps/desktop/src-tauri/tauri.conf.json'.padEnd(42) + old + ' → $VERSION');
  "
fi

echo ""

# ─── Commit ────────────────────────────────────────────────────────────────

git add -A '*.json'
git commit -m "chore: bump version to ${VERSION}"

echo ""
echo "Version bumped to $VERSION and committed."
echo ""
echo "Next steps:"
echo "  1. Push your branch / merge to main"
echo "  2. Run: pnpm release:tag"
echo ""
