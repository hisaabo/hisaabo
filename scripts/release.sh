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

# Single node helper: the version and file path are passed as argv (never
# spliced into the JS source), and the JSON key path is a fixed argument.
#   bump_json <file> <label> [key-path]   e.g. bump_json app.json "app.json (expo)" expo.version
bump_json() {
  node -e '
    const fs = require("fs");
    const [file, label, keyPath, version] = process.argv.slice(1);
    const obj = JSON.parse(fs.readFileSync(file, "utf8"));
    const keys = keyPath.split(".");
    const last = keys.pop();
    let target = obj;
    for (const k of keys) target = target[k];
    const old = target[last];
    target[last] = version;
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
    console.log("  " + label.padEnd(40) + old + " → " + version);
  ' "$1" "$2" "${3:-version}" "$VERSION"
}

CHANGED_FILES=()

for f in "${PACKAGE_FILES[@]}"; do
  if [ -f "$f" ]; then
    bump_json "$f" "$f"
    CHANGED_FILES+=("$f")
  fi
done

# Expo app.json (version lives under expo.version)
if [ -f apps/mobile/app.json ]; then
  bump_json apps/mobile/app.json "apps/mobile/app.json (expo)" expo.version
  CHANGED_FILES+=(apps/mobile/app.json)
fi

# Tauri conf (version at top level)
if [ -f apps/desktop/src-tauri/tauri.conf.json ]; then
  bump_json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/tauri.conf.json version
  CHANGED_FILES+=(apps/desktop/src-tauri/tauri.conf.json)
fi

echo ""

# ─── Commit ────────────────────────────────────────────────────────────────

# Stage and commit exactly the files bumped above, nothing else.
git add -- "${CHANGED_FILES[@]}"
git commit -m "chore: bump version to ${VERSION}" -- "${CHANGED_FILES[@]}"

echo ""
echo "Version bumped to $VERSION and committed."
echo ""
echo "Next steps:"
echo "  1. Push your branch / merge to main"
echo "  2. Run: pnpm release:tag"
echo ""
