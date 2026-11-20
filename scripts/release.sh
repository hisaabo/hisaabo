#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo version bump ─────────────────────────────────────────────────
# Usage: pnpm release <version>
# Example: pnpm release 0.5.0
#
# Updates the version in every manifest listed in scripts/versions.mjs
# (package.json files, Expo app.json, Tauri conf, desktop Cargo.toml/lock)
# and commits the change.
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
# scripts/versions.mjs holds the list of every version-bearing file (all
# package.json files, Expo app.json, tauri.conf.json, the desktop Cargo.toml
# and Cargo.lock). CI and the release workflow check the same list, so a tag
# whose version differs from any of them is rejected before anything ships.

echo "Bumping all manifests to $VERSION..."
echo ""

BUMPED=$(node scripts/versions.mjs set "$VERSION")
mapfile -t CHANGED_FILES <<< "$BUMPED"
printf '  %s\n' "${CHANGED_FILES[@]}"

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
