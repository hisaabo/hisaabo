#!/usr/bin/env bash
# Decide what the `docker` job of release.yml does about images that already
# exist for the release tag. Release images are immutable (self-hosters pin
# `:vX.Y.Z` and expect the same bytes forever), so the options are:
#
#   neither image exists          -> reuse=false: build, push and sign them
#   BOTH exist, FORCE is not true -> reuse=true:  do NOT build or push anything.
#                                    Their digests are emitted; the caller
#                                    verifies the existing cosign signatures and
#                                    carries on (this is what makes "Re-run all
#                                    jobs" and a dispatch on the tag, e.g. with
#                                    skip_api_wait, work after a first run)
#   only ONE exists, no FORCE     -> fail: a partial publish needs a human, and
#                                    `force` is the explicit act that repairs it
#   any exist, FORCE is true      -> reuse=false: re-push over them, loudly
#
# Only a clear "not found" counts as absent; any other failure (network,
# registry error) fails closed, so a blip can never allow an overwrite.
# ("denied" means the package does not exist yet, i.e. the first release of an
# image; a genuine auth problem fails the push later instead.)
#
# Environment: API_IMAGE, ONCE_IMAGE (names without a tag), REF_NAME (the tag),
#              FORCE ("true" to overwrite); GITHUB_OUTPUT when set receives
#              reuse=true|false and, on reuse, api_digest / once_digest.
set -uo pipefail

: "${API_IMAGE:?API_IMAGE is required}" "${ONCE_IMAGE:?ONCE_IMAGE is required}" "${REF_NAME:?REF_NAME is required}"

output() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; return 0; }

existing=()
api_digest=""
once_digest=""

for kind in api once; do
  if [ "$kind" = api ]; then image="$API_IMAGE"; else image="$ONCE_IMAGE"; fi
  ref="${image}:${REF_NAME}"
  if out=$(docker buildx imagetools inspect "$ref" 2>&1); then
    digest=$(awk '/^Digest:/ { print $2; exit }' <<<"$out")
    if ! [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "::error title=Cannot read image digest::${ref} exists but its digest could not be read (failing closed)."
      exit 1
    fi
    existing+=("$ref")
    if [ "$kind" = api ]; then api_digest="$digest"; else once_digest="$digest"; fi
    echo "${ref} exists (${digest})"
  elif grep -qiE 'not found|manifest unknown|name unknown|denied|unauthorized' <<<"$out"; then
    echo "${ref} does not exist yet"
  else
    echo "::error title=Cannot verify release tag::Could not determine whether ${ref} exists (failing closed): ${out}"
    exit 1
  fi
done

if [ "${#existing[@]}" -eq 0 ]; then
  output reuse false
  exit 0
fi

if [ "${FORCE:-}" = "true" ]; then
  echo "::warning title=Overwriting release tag::force=true: re-pushing ${existing[*]}. Digest pins stay valid; tag pins will move."
  output reuse false
  exit 0
fi

if [ "${#existing[@]}" -eq 2 ]; then
  echo "::notice title=Release images already published::${existing[*]} already exist, so nothing is rebuilt or pushed. Their cosign signatures are verified next, and this run continues with these exact digests."
  output reuse true
  output api_digest "$api_digest"
  output once_digest "$once_digest"
  exit 0
fi

echo "::error title=Release images partially published::Only ${existing[*]} exists; the other image for ${REF_NAME} is missing. Release images are immutable, so this needs a deliberate repair: run this workflow on the tag via workflow_dispatch with force=true (that re-pushes BOTH images), or cut a new version."
exit 1
