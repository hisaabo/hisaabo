#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo release script ─────────────────────────────────────────────────
# Usage: pnpm release <version>
# Example: pnpm release 0.4.0
#
# Tags HEAD with v<version> — no file changes, no extra commits.
# CI derives the version from the git tag at build/publish time.

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: pnpm release <version>"
  echo "Example: pnpm release 0.4.0"
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

# ─── Just tag ───────────────────────────────────────────────────────────────
git tag "$TAG"

echo "Tagged $(git rev-parse --short HEAD) as $TAG"
echo ""
echo "To publish:"
echo "  git push origin $TAG"
echo ""
