#!/usr/bin/env bash
# Write the final notes into the release prepared by `prepare-release`
# (scripts/ensure-release.sh) and, when it is safe, publish it. Patches by id,
# never creates a release, so a re-run is idempotent.
#
# Publishing makes the desktop installers and the Android APK public, so the
# release stays a draft unless the API question is settled: the installers must
# not go out while production runs the old API, nor without an API image to
# match. A re-run of the failed jobs, once the cause is fixed, publishes it.
#
# Publish ONLY when the wait-for-api job RAN and succeeded, with an outcome that
# says why:
#   result=ready      production reports this release's version
#   result=not_needed nothing in the release has to wait for the API upgrade
#   result=skipped    AND skipped_by_operator=true: the operator ticked
#                     skip_api_wait and the job took its loud-bypass path
# Everything else keeps it a draft: a timed-out or failed wait, a cancelled
# one, and a wait that never ran because an upstream job (the image build)
# failed. A job-level `skipped` is NOT a deliberate skip.
#
# Environment: REPOSITORY, RELEASE_ID, REF_NAME (the tag), BODY_PATH (notes file),
#              WAIT_RESULT (needs.wait-for-api.result),
#              WAIT_OUTCOME (needs.wait-for-api.outputs.result),
#              WAIT_SKIPPED_BY_OPERATOR (needs.wait-for-api.outputs.skipped_by_operator),
#              GH_TOKEN for gh.
set -euo pipefail

: "${REPOSITORY:?}" "${RELEASE_ID:?}" "${REF_NAME:?}" "${BODY_PATH:?}"
wait_result="${WAIT_RESULT:-}"
wait_outcome="${WAIT_OUTCOME:-}"
skipped_by_operator="${WAIT_SKIPPED_BY_OPERATOR:-}"

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

# tag_name every time: a draft can carry a placeholder `untagged-<hash>` tag
# (v0.10.1 was published under one), and publishing by id keeps whatever the
# draft has. The tag already exists (this workflow runs on its push).
args=(-f tag_name="$REF_NAME" -f name="Hisaabo ${REF_NAME}" -F body=@"$BODY_PATH" -F prerelease="$prerelease")

publish=false
if [ "$wait_result" = success ]; then
  case "$wait_outcome" in
    ready | not_needed) publish=true ;;
    skipped)
      if [ "$skipped_by_operator" = true ]; then publish=true; fi
      ;;
  esac
fi

if [ "$publish" = true ]; then
  args+=(-F draft=false -f make_latest="$make_latest")
  gh api --method PATCH "repos/${REPOSITORY}/releases/${RELEASE_ID}" "${args[@]}" --jq '"Published " + .html_url'
  tag="$(gh api "repos/${REPOSITORY}/releases/${RELEASE_ID}" --jq .tag_name)"
  if [ "$tag" != "$REF_NAME" ]; then
    echo "::error title=Release tag mismatch::Release ${RELEASE_ID} is published with tag '${tag}', expected '${REF_NAME}'. Set it with: gh api -X PATCH repos/${REPOSITORY}/releases/${RELEASE_ID} -f tag_name=${REF_NAME}"
    exit 1
  fi
  exit 0
fi

gh api --method PATCH "repos/${REPOSITORY}/releases/${RELEASE_ID}" "${args[@]}" --jq '"Notes updated, release NOT published: " + .html_url'
if [ "$wait_result" = skipped ]; then
  why="The production API wait never ran because an earlier job did not succeed (the image build, most likely), so there may be no API image to match the installers."
else
  why="The production API wait did not succeed (result '${wait_result}', outcome '${wait_outcome:-none}'): the installers and APK would go public while production runs the old API."
fi
echo "::warning title=Release not published::${why} ${REF_NAME} is left as it is (a draft unless it was already published). Fix the cause (for the API: pin HISAABO_API_IMAGE to ${REF_NAME}), then re-run the failed jobs of this workflow run; that publishes the release."
