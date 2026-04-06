#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo release tag ──────────────────────────────────────────────────
# Usage: pnpm release:tag
#
# Reads the version from root package.json, creates a git tag, and pushes
# both the commit and tag to origin. Must be run from the main branch.
# Run `pnpm release <version>` first to bump versions.

# Read version from root package.json
VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  echo "Error: Could not read version from package.json."
  echo "  Run 'pnpm release <version>' first."
  exit 1
fi

TAG="v${VERSION}"

# Must be on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Tags must be created from the main branch."
  echo "  Current branch: $CURRENT_BRANCH"
  echo "  Run: git checkout main && git pull"
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

# Verify the version bump commit exists
if ! git log -1 --pretty=%s | grep -q "bump version to ${VERSION}"; then
  echo "Warning: HEAD commit doesn't look like a version bump."
  echo "  HEAD: $(git log -1 --pretty=%s)"
  echo ""
  read -rp "Continue anyway? [y/N] " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ─── Tag and push ──────────────────────────────────────────────────────────
git tag "$TAG"
git push origin main "$TAG"

echo ""
echo "Tagged $(git rev-parse --short HEAD) as $TAG and pushed to origin."
echo "CI will now build and publish release artifacts."
echo ""
echo "Track progress: https://github.com/billkitaab/hisaabo/actions"
echo ""
