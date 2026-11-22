#!/usr/bin/env bash
# List the GitHub releases for a tag, drafts included.
#
# One tab-separated line per release: <id> <draft|published> <prerelease|stable> <url>
# No output means no release exists for the tag. A failure to ask (gh missing,
# not logged in, network) is a non-zero exit, never "no releases", so callers
# can fail closed.
#
# Why not `gh release view`: the releases-by-tag API never returns drafts, and
# a draft is exactly what a half-finished release.yml run leaves behind. Listing
# needs push access to see drafts, which anyone who can tag has.
#
# Used by scripts/release-tag.sh (refuse to tag over an existing release) and
# by the `prepare-release` job of .github/workflows/release.yml (one release per
# tag, reused by every job that attaches assets).
#
# Usage: scripts/find-release.sh <tag>
#   REPOSITORY=owner/name  optional; default is the repo of the current checkout
set -euo pipefail

tag="${1:-}"
[ -n "$tag" ] || { echo "usage: $0 <tag>" >&2; exit 2; }

if [ -n "${REPOSITORY:-}" ]; then
  endpoint="repos/${REPOSITORY}/releases"
else
  endpoint='repos/{owner}/{repo}/releases'
fi

gh api --paginate "${endpoint}?per_page=100" \
  | jq -r --arg tag "$tag" '.[]
      | select(.tag_name == $tag)
      | [.id, (if .draft then "draft" else "published" end), (if .prerelease then "prerelease" else "stable" end), .html_url]
      | @tsv'
