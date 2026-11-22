#!/usr/bin/env bash
# Write the final notes into the release prepared by `prepare-release`
# (scripts/ensure-release.sh) and, when it is safe, publish it. Patches by id,
# never creates a release, so a re-run is idempotent.
#
# Publishing makes the desktop installers and the Android APK public, so it is
# held back (the release stays a draft) when the production API wait did not
# succeed: the installers would otherwise go out while production still runs the
# old API. A re-run of the failed jobs, after the operator has upgraded the API,
# publishes it.
#   WAIT_RESULT success  -> the production API reports this version: publish
#   WAIT_RESULT skipped  -> nothing needed the wait (no frontend or client changed)
#                           or the image build failed (the notes say so): publish
#   anything else        -> failure / cancelled: notes updated, NOT published
#
# Environment: REPOSITORY, RELEASE_ID, REF_NAME (the tag), BODY_PATH (notes file),
#              WAIT_RESULT (needs.wait-for-api.result), GH_TOKEN for gh.
set -euo pipefail

: "${REPOSITORY:?}" "${RELEASE_ID:?}" "${REF_NAME:?}" "${BODY_PATH:?}"
wait_result="${WAIT_RESULT:-}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A "-" in the version marks a pre-release (-beta.1, -rc.1): flagged as such and
# never "Latest". Stable uses GitHub's own ordering.
if [[ "$REF_NAME" == *-* ]]; then
  prerelease=true
  make_latest=false
else
  prerelease=false
  make_latest=legacy
fi

# A second release for the tag (made by hand mid-run) must not be papered over:
# fail and name it instead of publishing next to it.
others="$(bash "$here/find-release.sh" "$REF_NAME" | cut -f1 | grep -vxF "$RELEASE_ID" || true)"
if [ -n "$others" ]; then
  echo "::error title=Duplicate releases::${REF_NAME} has another release besides ${RELEASE_ID} (ids: $(tr '\n' ' ' <<<"$others")). Keep one, delete the others in the GitHub UI, and re-run this job."
  exit 1
fi

args=(-f name="Hisaabo ${REF_NAME}" -F body=@"$BODY_PATH" -F prerelease="$prerelease")

case "$wait_result" in
  success | skipped)
    args+=(-F draft=false -f make_latest="$make_latest")
    gh api --method PATCH "repos/${REPOSITORY}/releases/${RELEASE_ID}" "${args[@]}" --jq '"Published " + .html_url'
    ;;
  *)
    gh api --method PATCH "repos/${REPOSITORY}/releases/${RELEASE_ID}" "${args[@]}" --jq '"Notes updated, release NOT published: " + .html_url'
    echo "::warning title=Release not published::The production API wait finished '${wait_result}', so ${REF_NAME} is left as it is (a draft unless it was already published): its desktop installers and APK would go public while production runs the old API. Upgrade the API (pin HISAABO_API_IMAGE to ${REF_NAME}), then re-run the failed jobs of this workflow run; that deploys the frontends and publishes the release."
    ;;
esac
