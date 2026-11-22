#!/usr/bin/env bash
# Make sure exactly one GitHub release exists for a tag, and print its id.
#
# The `prepare-release` job of .github/workflows/release.yml runs this ONCE,
# before any job that attaches assets. Every other job (desktop installers, the
# Android APK, the final release notes) then works on that release by id, so
# nothing else ever creates one and parallel jobs cannot race into duplicates.
#
#   - no release for the tag  -> create a DRAFT (the tag already exists)
#   - one release (draft or published, e.g. a hand-made pre-release)
#                             -> reuse it; its notes are replaced at the end
#   - more than one           -> fail now, before an hour of builds, listing them
#
# Usage: scripts/ensure-release.sh <tag>
#   REPOSITORY=owner/name  optional; default is the repo of the current checkout
#   GITHUB_OUTPUT          when set, `release_id=<id>` is appended to it
set -euo pipefail

tag="${1:-}"
[ -n "$tag" ] || { echo "usage: $0 <tag>" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${REPOSITORY:-}" ]; then
  endpoint="repos/${REPOSITORY}/releases"
else
  endpoint='repos/{owner}/{repo}/releases'
fi

matches="$(bash "$here/find-release.sh" "$tag")"
count="$(printf '%s' "$matches" | grep -c . || true)"

if [ "$count" -gt 1 ]; then
  ids="$(cut -f1 <<<"$matches" | tr '\n' ' ')"
  echo "::error title=Duplicate releases::Found ${count} releases for ${tag} (ids: ${ids}). Keep one (the one that already has the assets you want), delete the others in the GitHub UI, and re-run this workflow."
  exit 1
fi

if [ "$count" -eq 1 ]; then
  IFS=$'\t' read -r id state kind url <<<"$matches"
  echo "Reusing the existing ${state} ${kind} release ${id} for ${tag} (${url}). Assets are attached to it and its notes are replaced when the builds finish." >&2
else
  # A "-" in the version marks a pre-release (-beta.1, -rc.1).
  prerelease=false
  [[ "$tag" == *-* ]] && prerelease=true
  id="$(gh api --method POST "$endpoint" \
    -f tag_name="$tag" \
    -f name="Hisaabo ${tag}" \
    -f body="Release in progress. These notes are replaced when every build has finished." \
    -F draft=true \
    -F prerelease="$prerelease" \
    --jq .id)"
  echo "Created draft release ${id} for ${tag}." >&2
fi

[ -n "$id" ] || { echo "::error title=No release id::Could not determine the release id for ${tag}." >&2; exit 1; }

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "release_id=${id}" >> "$GITHUB_OUTPUT"
fi
echo "$id"
