#!/usr/bin/env bash
set -euo pipefail

# ─── Hisaabo release tag ──────────────────────────────────────────────────
# Usage: pnpm release:tag
#
# Reads the version from root package.json, creates a git tag, and pushes
# both the commit and tag to origin. Must be run from the main branch.
# Run `pnpm release <version>` first to bump versions.
#
# Signed tags: set SIGN_TAG=1 (or pass --sign) to create a GPG/SSH-signed tag
# (`git tag -s`). Requires user.signingkey to be configured; the script aborts
# if it is not rather than silently creating an unsigned tag.
#
# Refuses to tag when a GitHub release (draft, pre-release or published) for
# the tag already exists: release.yml owns the one release for a tag, and a
# hand-made one next to it broke the 0.10.0 release notes. The check needs the
# gh CLI and jq; if you cannot run them, check
# https://github.com/hisaabo/hisaabo/releases by hand and pass
# --skip-release-check (or SKIP_RELEASE_CHECK=1).
#
# After the push, release.yml builds and signs the images, then WAITS until the
# production API reports this version. Upgrade the API (pin HISAABO_API_IMAGE)
# when the images are out; web and store deploy after that. See
# docs/DEPLOYMENT.md, "Release runbook".

SIGN="${SIGN_TAG:-0}"
SKIP_RELEASE_CHECK="${SKIP_RELEASE_CHECK:-0}"
for arg in "$@"; do
  case "$arg" in
    --sign) SIGN=1 ;;
    --skip-release-check) SKIP_RELEASE_CHECK=1 ;;
    *) echo "Error: unknown argument: $arg"; exit 1 ;;
  esac
done

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

# No GitHub release may exist for the tag yet (drafts included; see
# scripts/find-release.sh). Fails closed: if we cannot ask, we do not tag.
if [ "$SKIP_RELEASE_CHECK" != "1" ]; then
  if ! command -v gh >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    echo "Error: cannot check whether a GitHub release for $TAG already exists."
    echo "  This check needs the gh CLI (logged in: gh auth login) and jq."
    echo "  Install them, or check https://github.com/hisaabo/hisaabo/releases by hand"
    echo "  and re-run with --skip-release-check."
    exit 1
  fi
  if ! EXISTING_RELEASES=$(bash scripts/find-release.sh "$TAG"); then
    echo "Error: could not list the GitHub releases to check for $TAG (see the error above)."
    echo "  Fix gh (gh auth status), or re-run with --skip-release-check after checking by hand."
    exit 1
  fi
  if [ -n "$EXISTING_RELEASES" ]; then
    echo "Error: a GitHub release for $TAG already exists:"
    while IFS=$'\t' read -r rel_id rel_state rel_kind rel_url; do
      echo "  $rel_url  (id $rel_id, $rel_state, $rel_kind)"
    done <<< "$EXISTING_RELEASES"
    echo ""
    echo "  release.yml creates the single release for a tag; a second one is what broke"
    echo "  the 0.10.0 release notes. Nothing was tagged or pushed."
    echo "  Delete it first (this keeps any git tag):  gh release delete $TAG --yes"
    echo "  Or, if $TAG was already released, cut a new version with: pnpm release <version>"
    exit 1
  fi
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
if [ "$SIGN" = "1" ]; then
  if [ -z "$(git config --get user.signingkey || true)" ]; then
    echo "Error: signed tag requested but git user.signingkey is not configured."
    exit 1
  fi
  git tag -s "$TAG" -m "Release $TAG"
else
  git tag "$TAG"
fi
git push origin main "$TAG"

echo ""
echo "Tagged $(git rev-parse --short HEAD) as $TAG and pushed to origin."
echo "CI will now build and sign the Docker images, then wait for the production"
echo "API to report $VERSION before it deploys web and store."
echo ""
echo "Next: when the images are published, upgrade the API:"
echo "  set HISAABO_API_IMAGE=ghcr.io/hisaabo/hisaabo-api:$TAG in .env.prod, then"
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml pull api"
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api"
echo "Then approve the pending 'production' deployments in the workflow run, and"
echo "purge /store/* on the CDN. Runbook: docs/DEPLOYMENT.md#release-runbook"
echo ""
echo "Track progress: https://github.com/hisaabo/hisaabo/actions"
echo ""
