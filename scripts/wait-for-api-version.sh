#!/usr/bin/env bash
# Wait for (or check) the version the production API reports.
#
# Two modes, both reading the public `GET /api/version` of the production API:
#
#   MODE=wait   (default) Used by the `wait-for-api` job of release.yml. The API
#               runs on a separate server and the operator upgrades it by hand
#               (pins HISAABO_API_IMAGE to the new tag), so CI cannot deploy it;
#               it can only wait until the API returns the tagged version, and
#               only then let the frontends and npm packages go out. Polls with
#               backoff (10 s growing to 60 s) until the deadline.
#
#   MODE=check  Used at the start of every production deploy job
#               (deploy-web.yml, deploy-store.yml, deploy-api-docs.yml): ONE
#               look (a few retries only for a network blip) that decides whether
#               deploying the tag is safe right now. It passes only when
#               production reports exactly the tagged version. It refuses when
#               production is OLDER (the frontend would run ahead of its API) and
#               when production is NEWER (an older tag would downgrade the
#               frontend: a stale approval, or a rollback). A reviewer's approval
#               can sit for days, so this runs after it, not only before it.
#
# Exit codes: 0 ok (or explicitly bypassed), 1 timed out / refused, 2 bad config.
#
# Environment:
#   EXPECTED_VERSION         required; the release tag or version ("v0.10.1" or "0.10.1")
#   MODE                     wait (default) | check
#   API_URL                  default https://api.hisaabo.in
#   VERSION_PATH             default /api/version
#   SKIP_API_WAIT            "true" bypasses the wait/check (emergencies and rollbacks only;
#                            logged loudly). The job still RUNS and succeeds, and reports
#                            skipped_by_operator=true, so a deliberate bypass is
#                            distinguishable from a job that never ran
#   WAIT_NEEDED              wait mode: "false" when nothing in this release needs the API
#                            to be upgraded first (no frontend or client changed); the job
#                            then succeeds at once with result=not_needed. Default true
#   OVERRIDE_NAME            the input a human sets to bypass, named in messages; default skip_api_wait
#   -- wait mode --
#   TIMEOUT_MINUTES          default 350. Capped at MAX_TIMEOUT_MINUTES
#   TIMEOUT_SECONDS          optional; overrides TIMEOUT_MINUTES (used by the tests)
#   MAX_TIMEOUT_MINUTES      default 350 (GitHub stops a hosted job at 360 minutes)
#   INITIAL_INTERVAL_SECONDS default 10
#   MAX_INTERVAL_SECONDS     default 60
#   API_IMAGE                optional image name (no tag) for the operator instructions,
#                            default ghcr.io/<owner>/hisaabo-api
#   API_DIGEST               optional sha256:... digest of that image; adds a digest-pinned line
#   -- check mode --
#   CHECK_ATTEMPTS           default 3 (tries before "cannot determine")
#   CHECK_RETRY_SECONDS      default 5
#   -- both --
#   REQUEST_TIMEOUT_SECONDS  default 10
#   GITHUB_OUTPUT / GITHUB_STEP_SUMMARY  written when set (as in GitHub Actions)
#
# Outputs (GITHUB_OUTPUT): result = ready | not_needed | skipped | timeout (wait mode)
#                                 | ready | skipped | older | newer | unknown (check mode),
#                          skipped_by_operator = true only on the loud bypass (result=skipped),
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

# Order two release versions. Prints lt, eq or gt for $1 relative to $2. A
# pre-release sorts before its release (0.10.1-rc.1 < 0.10.1) via the "~" that
# `sort -V` ranks below everything; build metadata (+...) is ignored.
cmp_versions() {
  local a b first tilde='~'
  a="${1%%+*}"; a="${a/-/$tilde}"
  b="${2%%+*}"; b="${b/-/$tilde}"
  if [ "$a" = "$b" ]; then echo eq; return; fi
  first=$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n 1)
  if [ "$first" = "$a" ]; then echo lt; else echo gt; fi
}

expected="${EXPECTED_VERSION:-${1:-}}"
expected="${expected#v}"
[ -n "$expected" ] || die "EXPECTED_VERSION is required (the release tag, e.g. v0.10.1)"
[[ "$expected" =~ ^[0-9A-Za-z.+-]{1,64}$ ]] || die "EXPECTED_VERSION '${expected}' is not a plain version string"

mode="${MODE:-wait}"
[ "$mode" = wait ] || [ "$mode" = check ] || die "MODE must be 'wait' or 'check', got '${mode}'"
override="${OVERRIDE_NAME:-skip_api_wait}"

base="${API_URL:-https://api.hisaabo.in}"
base="${base%/}"
url="${base}${VERSION_PATH:-/api/version}"

timeout_min="${TIMEOUT_MINUTES:-350}"
max_timeout_min="${MAX_TIMEOUT_MINUTES:-350}"
interval="${INITIAL_INTERVAL_SECONDS:-10}"
max_interval="${MAX_INTERVAL_SECONDS:-60}"
request_timeout="${REQUEST_TIMEOUT_SECONDS:-10}"
check_attempts="${CHECK_ATTEMPTS:-3}"
check_retry="${CHECK_RETRY_SECONDS:-5}"
for v in "$timeout_min" "$max_timeout_min" "$interval" "$max_interval" "$request_timeout" "$check_attempts" "$check_retry"; do
  is_uint "$v" || die "numeric setting expected, got '${v}'"
done
[ "$timeout_min" -ge 1 ] || die "TIMEOUT_MINUTES must be at least 1"
[ "$interval" -ge 1 ] || die "INITIAL_INTERVAL_SECONDS must be at least 1"
[ "$check_attempts" -ge 1 ] || die "CHECK_ATTEMPTS must be at least 1"
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

if [ "$mode" = wait ] && [ "${WAIT_NEEDED:-true}" = "false" ]; then
  echo "::notice title=No API wait needed::No frontend, npm package or API reference changed in this release, so nothing has to wait for the API upgrade."
  summary "### API wait not needed"
  summary ""
  summary "No frontend, npm package or API reference changed in this release."
  output result not_needed
  output skipped_by_operator false
  output observed_version ""
  exit 0
fi

if [ "${SKIP_API_WAIT:-false}" = "true" ]; then
  if [ "$mode" = check ]; then what="API check"; else what="API wait"; fi
  echo "::warning title=${what} SKIPPED::${override}=true: NOT checking that production runs ${expected}. This deploys against whatever API version is live. Emergency or rollback use only."
  echo "################################################################"
  echo "#  ${what^^} BYPASSED (${override}=true)"
  echo "#  Production API version was NOT verified for ${expected}"
  echo "################################################################"
  summary "### :warning: ${what} bypassed"
  summary ""
  summary "\`${override}=true\`: the production API was **not** checked for \`${expected}\`. The deploy goes ahead against whatever API version is live."
  output result skipped
  output skipped_by_operator true
  output observed_version ""
  exit 0
fi

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

# One request. Sets observed_now (a version, or empty) and detail (why not).
probe() {
  local http_code curl_rc candidate
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
}

# ── MODE=check: one decision, no waiting ─────────────────────────────────
if [ "$mode" = check ]; then
  echo "Checking that the production API runs ${expected} before deploying"
  echo "  endpoint : ${url}"
  observed=""
  for ((attempt = 1; attempt <= check_attempts; attempt++)); do
    probe
    [ -n "$observed_now" ] && break
    echo "#${attempt}: ${detail}"
    [ "$attempt" -lt "$check_attempts" ] && sleep "$check_retry"
  done

  if [ -z "$observed_now" ]; then
    echo "::error title=Cannot verify the production API::${url} did not report a version after ${check_attempts} tries (last: ${detail}). Refusing to deploy ${expected} without knowing which API it will run against. Retry when the API is up, or set ${override} to deploy anyway."
    summary ":x: Could not read the production API version; deploy refused."
    output result unknown
    output observed_version ""
    exit 1
  fi

  observed="$observed_now"
  output observed_version "$observed"
  case "$(cmp_versions "$observed" "$expected")" in
    eq)
      echo "production reports ${observed}, deploying ${expected}: MATCH"
      summary ":white_check_mark: Production API reports \`${observed}\`; deploying \`${expected}\`."
      output result ready
      exit 0
      ;;
    lt)
      echo "::error title=Production API is older than this release::Production reports ${observed}, but ${expected} is being deployed. The frontend would run ahead of the API it was built against. Upgrade the API first (the release workflow waits for that), or set ${override} to deploy anyway."
      summary ":x: Deploy refused: production API is \`${observed}\`, older than \`${expected}\`."
      output result older
      exit 1
      ;;
    *)
      echo "::error title=Production API is newer than this release::Production reports ${observed}, newer than ${expected}. Deploying this older release would downgrade the frontend below its API: a stale approval after a newer release, or a rollback. If this is an intentional rollback, set ${override} to deploy anyway."
      summary ":x: Deploy refused: production API is \`${observed}\`, newer than \`${expected}\` (would downgrade the frontend)."
      output result newer
      exit 1
      ;;
  esac
fi

# ── MODE=wait: poll until the API reports the version ────────────────────
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

  probe

  if [ -n "$observed_now" ]; then
    observed="$observed_now"
    if [ "$observed" = "$expected" ]; then
      echo "[$(hms "$elapsed")] #${attempt}: production reports ${observed}, expected ${expected}: MATCH"
      echo "::notice title=Production API is on ${expected}::Production reported ${observed} after $(hms "$elapsed"). Releasing the frontends."
      summary ""
      summary ":white_check_mark: Production reported \`${observed}\` after $(hms "$elapsed"); frontends released."
      output result ready
      output skipped_by_operator false
      output observed_version "$observed"
      exit 0
    fi
    hint=""
    # A production API that is already ahead of this tag will never match: say so.
    if [ "$(cmp_versions "$observed" "$expected")" = gt ]; then
      hint=" (production is NEWER than this release; if that is intended, re-run with ${override})"
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
    output skipped_by_operator false
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
