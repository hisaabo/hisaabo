#!/usr/bin/env bash
# Wait until the production API reports the version being released.
#
# Used by the `wait-for-api` job of .github/workflows/release.yml. The API runs
# on a separate server and the operator upgrades it by hand (pins
# HISAABO_API_IMAGE to the new tag), so CI cannot deploy it; it can only wait
# until `GET /api/version` returns the tagged version, and only then let the
# web and store frontends go to production.
#
# Polls with backoff (10 s growing to 60 s) until the deadline. Exit codes:
#   0  the API reports the expected version (or the wait was explicitly skipped)
#   1  timed out
#   2  bad configuration
#
# Environment:
#   EXPECTED_VERSION         required; the release tag or version ("v0.10.1" or "0.10.1")
#   API_URL                  default https://api.hisaabo.in
#   VERSION_PATH             default /api/version
#   TIMEOUT_MINUTES          default 350. Capped at MAX_TIMEOUT_MINUTES
#   TIMEOUT_SECONDS          optional; overrides TIMEOUT_MINUTES (used by the tests)
#   MAX_TIMEOUT_MINUTES      default 350 (GitHub stops a hosted job at 360 minutes)
#   INITIAL_INTERVAL_SECONDS default 10
#   MAX_INTERVAL_SECONDS     default 60
#   REQUEST_TIMEOUT_SECONDS  default 10
#   SKIP_API_WAIT            "true" bypasses the wait (emergencies only; logged loudly)
#   API_IMAGE                optional image name (no tag) for the operator instructions,
#                            default ghcr.io/<owner>/hisaabo-api
#   API_DIGEST               optional sha256:... digest of that image; adds a digest-pinned line
#   GITHUB_OUTPUT / GITHUB_STEP_SUMMARY  written when set (as in GitHub Actions)
#
# Outputs (GITHUB_OUTPUT): result = ready | skipped | timeout,
#                          observed_version = last version the API reported
set -uo pipefail

die() { echo "::error title=wait-for-api::$*"; exit 2; }

is_uint() { [[ "$1" =~ ^[0-9]+$ ]]; }

hms() {
  local s=$1
  printf '%02d:%02d:%02d' $((s / 3600)) $((s % 3600 / 60)) $((s % 60))
}

output() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; return 0; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }

expected="${EXPECTED_VERSION:-${1:-}}"
expected="${expected#v}"
[ -n "$expected" ] || die "EXPECTED_VERSION is required (the release tag, e.g. v0.10.1)"
[[ "$expected" =~ ^[0-9A-Za-z.+-]{1,64}$ ]] || die "EXPECTED_VERSION '${expected}' is not a plain version string"

base="${API_URL:-https://api.hisaabo.in}"
base="${base%/}"
url="${base}${VERSION_PATH:-/api/version}"

timeout_min="${TIMEOUT_MINUTES:-350}"
max_timeout_min="${MAX_TIMEOUT_MINUTES:-350}"
interval="${INITIAL_INTERVAL_SECONDS:-10}"
max_interval="${MAX_INTERVAL_SECONDS:-60}"
request_timeout="${REQUEST_TIMEOUT_SECONDS:-10}"
for v in "$timeout_min" "$max_timeout_min" "$interval" "$max_interval" "$request_timeout"; do
  is_uint "$v" || die "numeric setting expected, got '${v}'"
done
[ "$timeout_min" -ge 1 ] || die "TIMEOUT_MINUTES must be at least 1"
[ "$interval" -ge 1 ] || die "INITIAL_INTERVAL_SECONDS must be at least 1"
if [ "$timeout_min" -gt "$max_timeout_min" ]; then
  echo "::warning title=wait-for-api::TIMEOUT_MINUTES=${timeout_min} exceeds the ${max_timeout_min}-minute cap (a GitHub-hosted job is stopped at 360 minutes); using ${max_timeout_min}."
  timeout_min="$max_timeout_min"
fi
timeout_s=$((timeout_min * 60))
timeout_label="${timeout_min} min"
if [ -n "${TIMEOUT_SECONDS:-}" ]; then
  is_uint "$TIMEOUT_SECONDS" || die "TIMEOUT_SECONDS must be a number, got '${TIMEOUT_SECONDS}'"
  timeout_s="$TIMEOUT_SECONDS"
  timeout_label="${timeout_s} s"
fi

if [ "${SKIP_API_WAIT:-false}" = "true" ]; then
  echo "::warning title=API wait SKIPPED::skip_api_wait=true: NOT checking that production runs ${expected}. The frontends will deploy against whatever API version is live. Emergency use only."
  echo "################################################################"
  echo "#  API WAIT BYPASSED (skip_api_wait=true)                       #"
  echo "#  Production API version was NOT verified for ${expected}"
  echo "################################################################"
  summary "### :warning: API wait bypassed"
  summary ""
  summary "\`skip_api_wait=true\`: the production API was **not** checked for \`${expected}\`. Web and store deploy against whatever API version is live."
  output result skipped
  output observed_version ""
  exit 0
fi

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

echo "Waiting for the production API to report version ${expected}"
echo "  endpoint : ${url}"
echo "  deadline : ${timeout_label} (poll every ${interval}s, backing off to ${max_interval}s)"
echo ""
image="${API_IMAGE:-ghcr.io/<owner>/hisaabo-api}"
echo "Operator: upgrade the API to ${expected} now. In .env.prod set"
echo "  HISAABO_API_IMAGE=${image}:v${expected}"
if [ -n "${API_DIGEST:-}" ]; then
  echo "or pin the exact bytes:"
  echo "  HISAABO_API_IMAGE=${image}:v${expected}@${API_DIGEST}"
fi
echo "then run:"
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml pull api"
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api"
echo ""
summary "### Waiting for the production API"
summary ""
summary "Expected version: \`${expected}\` from \`${url}\`. Timeout: ${timeout_label}."
summary ""
summary "The operator upgrades the API by pinning \`HISAABO_API_IMAGE=${image}:v${expected}\` and recreating the \`api\` container."
if [ -n "${API_DIGEST:-}" ]; then
  summary ""
  summary "Exact bytes: \`HISAABO_API_IMAGE=${image}:v${expected}@${API_DIGEST}\`"
fi

start=$(date +%s)
deadline=$((start + timeout_s))
attempt=0
observed=""

while true; do
  attempt=$((attempt + 1))
  now=$(date +%s)
  elapsed=$((now - start))

  observed_now=""
  detail=""
  : > "$body_file"
  http_code=$(curl -sS --max-time "$request_timeout" -H 'Accept: application/json' -H 'Cache-Control: no-cache' \
    -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null)
  curl_rc=$?

  if [ "$curl_rc" -ne 0 ]; then
    detail="API not reachable (curl exit ${curl_rc}); it may be restarting"
  elif [ "$http_code" = "200" ]; then
    candidate=$(jq -r '.version // empty' "$body_file" 2>/dev/null || true)
    # The body comes from the network: only plain version strings are echoed
    # into the log, so a hostile response can never smuggle a workflow command.
    if [[ "$candidate" =~ ^[0-9A-Za-z.+-]{1,64}$ ]]; then
      observed_now="$candidate"
    else
      detail="HTTP 200 without a usable \"version\" field"
    fi
  elif [ "$http_code" = "404" ]; then
    detail="HTTP 404: the running API predates ${VERSION_PATH:-/api/version}, so it is not ${expected} yet"
  else
    detail="HTTP ${http_code}"
  fi

  if [ -n "$observed_now" ]; then
    observed="$observed_now"
    if [ "$observed" = "$expected" ]; then
      echo "[$(hms "$elapsed")] #${attempt}: production reports ${observed}, expected ${expected}: MATCH"
      echo "::notice title=Production API is on ${expected}::Production reported ${observed} after $(hms "$elapsed"). Releasing the frontends."
      summary ""
      summary ":white_check_mark: Production reported \`${observed}\` after $(hms "$elapsed"); frontends released."
      output result ready
      output observed_version "$observed"
      exit 0
    fi
    hint=""
    # Compare release cores only (a -rc.N suffix is ignored): a production API
    # that is already ahead of this tag will never match, so say so.
    exp_core="${expected%%[-+]*}"
    obs_core="${observed%%[-+]*}"
    if [ "$obs_core" != "$exp_core" ] && [ "$(printf '%s\n%s\n' "$exp_core" "$obs_core" | sort -V | tail -n 1)" = "$obs_core" ]; then
      hint=" (production is NEWER than this release; if that is intended, re-run with skip_api_wait)"
    fi
    detail="production reports ${observed}, expected ${expected}${hint}"
  fi

  now=$(date +%s)
  remaining=$((deadline - now))
  if [ "$remaining" -le 0 ]; then
    echo "[$(hms "$elapsed")] #${attempt}: ${detail}"
    echo "::error title=Timed out waiting for the production API::After ${timeout_label} ${url} still did not report ${expected} (last: ${observed:-nothing usable}). Upgrade the API (pin HISAABO_API_IMAGE to v${expected}) and re-run the failed jobs of this workflow run; the images are already published and are not rebuilt."
    summary ""
    summary ":x: Timed out after ${timeout_label} waiting for \`${expected}\` (last seen: \`${observed:-nothing usable}\`). Upgrade the API, then re-run the failed jobs."
    output result timeout
    output observed_version "$observed"
    exit 1
  fi

  sleep_for=$interval
  [ "$sleep_for" -gt "$remaining" ] && sleep_for=$remaining
  echo "[$(hms "$elapsed")] #${attempt}: ${detail}; next check in ${sleep_for}s"
  sleep "$sleep_for"

  interval=$((interval * 3 / 2 + 1))
  [ "$interval" -gt "$max_interval" ] && interval=$max_interval
done
