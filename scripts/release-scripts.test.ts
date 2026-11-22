// Run: node --experimental-strip-types --test scripts/release-scripts.test.ts
//
// scripts/find-release.sh, scripts/ensure-release.sh and the release-exists
// guard in scripts/release-tag.sh, driven through a fake `gh` on PATH. No
// network and nothing is created on GitHub: the fake records its calls, and
// release-tag.sh pushes only to a throwaway local bare repository.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = new URL(".", import.meta.url).pathname;

let work: string;
let fakeBin: string;
let calls: string;

type Release = { id: number; tag_name: string; draft: boolean; prerelease: boolean; html_url: string };

const release = (id: number, tag: string, draft = false, prerelease = false): Release => ({
  id,
  tag_name: tag,
  draft,
  prerelease,
  html_url: `https://github.com/example/repo/releases/${id}`,
});

before(() => {
  work = mkdtempSync(join(tmpdir(), "release-scripts-"));
  fakeBin = join(work, "bin");
  calls = join(work, "gh-calls.log");
  mkdirSync(fakeBin);
  // `gh api --paginate .../releases?per_page=100` -> $FAKE_GH_PAGES, one JSON array per line
  // (that is how --paginate concatenates pages). `gh api --method POST ...` -> a new id.
  writeFileSync(
    join(fakeBin, "gh"),
    `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_CALLS"
if [ -n "\${FAKE_GH_FAIL:-}" ]; then echo "gh: not logged in" >&2; exit 4; fi
if [[ " $* " == *" --method POST "* ]]; then echo "\${FAKE_GH_NEW_ID:-9001}"; exit 0; fi
cat "$FAKE_GH_PAGES"
`,
  );
  chmodSync(join(fakeBin, "gh"), 0o755);
  // `docker buildx imagetools inspect <ref>`: FAKE_DOCKER_API / FAKE_DOCKER_ONCE decide, per image,
  // between exists | missing | error | baddigest.
  writeFileSync(
    join(fakeBin, "docker"),
    `#!/usr/bin/env bash
ref="\${@: -1}"
if [[ "$ref" == *"/hisaabo-api:"* ]]; then mode="\${FAKE_DOCKER_API:-missing}"; digest="sha256:\${FAKE_DOCKER_API_DIGEST:-1111111111111111111111111111111111111111111111111111111111111111}"
else mode="\${FAKE_DOCKER_ONCE:-missing}"; digest="sha256:2222222222222222222222222222222222222222222222222222222222222222"; fi
case "$mode" in
  exists) printf 'Name:      %s\\nMediaType: application/vnd.oci.image.index.v1+json\\nDigest:    %s\\n' "$ref" "$digest" ;;
  baddigest) printf 'Name:      %s\\nDigest:    nonsense\\n' "$ref" ;;
  missing) echo "ERROR: $ref: not found" >&2; exit 1 ;;
  *) echo "ERROR: dial tcp: i/o timeout" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(fakeBin, "docker"), 0o755);
});

after(() => rmSync(work, { recursive: true, force: true }));

function env(pages: Release[][], extra: Record<string, string> = {}) {
  const f = join(work, `pages-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, pages.map((p) => JSON.stringify(p)).join("\n") + "\n");
  rmSync(calls, { force: true });
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    FAKE_GH_PAGES: f,
    FAKE_GH_CALLS: calls,
    ...extra,
  } as NodeJS.ProcessEnv;
}

const sh = (script: string, args: string[], e: NodeJS.ProcessEnv, cwd?: string) =>
  spawnSync("bash", [join(SCRIPTS, script), ...args], { env: e, cwd, encoding: "utf8" });

const ghCalls = () => {
  try {
    return readFileSync(calls, "utf8");
  } catch {
    return "";
  }
};

// ── find-release.sh ─────────────────────────────────────────────────────

test("find-release lists drafts and published releases for the tag across pages, and only that tag", () => {
  const r = sh(
    "find-release.sh",
    ["v1.2.3"],
    env([[release(1, "v1.2.2"), release(2, "v1.2.3", true)], [release(3, "v1.2.3", false, true), release(4, "v1.2.4")]]),
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout,
    "2\tdraft\tstable\thttps://github.com/example/repo/releases/2\n" +
      "3\tpublished\tprerelease\thttps://github.com/example/repo/releases/3\n",
  );
});

test("find-release prints nothing when there is no release, and fails (not 'none') when gh fails", () => {
  const none = sh("find-release.sh", ["v9.9.9"], env([[release(1, "v1.2.2")]]));
  assert.equal(none.status, 0);
  assert.equal(none.stdout, "");
  const broken = sh("find-release.sh", ["v9.9.9"], env([[]], { FAKE_GH_FAIL: "1" }));
  assert.notEqual(broken.status, 0);
});

// ── ensure-release.sh ───────────────────────────────────────────────────

test("ensure-release creates one draft when none exists (pre-release flag follows the tag)", () => {
  const stable = sh("ensure-release.sh", ["v1.2.3"], env([[release(1, "v1.2.2")]], { FAKE_GH_NEW_ID: "777" }));
  assert.equal(stable.status, 0, stable.stderr);
  assert.equal(stable.stdout.trim(), "777");
  const stableCall = ghCalls().split("\n").find((l) => l.includes("--method POST"))!;
  assert.match(stableCall, /tag_name=v1\.2\.3/);
  assert.match(stableCall, /draft=true/);
  assert.match(stableCall, /prerelease=false/);

  const rc = sh("ensure-release.sh", ["v1.3.0-rc.1"], env([[]], { FAKE_GH_NEW_ID: "778" }));
  assert.equal(rc.status, 0, rc.stderr);
  assert.match(ghCalls(), /prerelease=true/);
});

test("ensure-release reuses an existing draft or published release and never creates another", () => {
  for (const existing of [release(41, "v1.2.3", true), release(42, "v1.2.3", false, true)]) {
    const r = sh("ensure-release.sh", ["v1.2.3"], env([[existing]]));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), String(existing.id));
    assert.match(r.stderr, /Reusing the existing/);
    assert.doesNotMatch(ghCalls(), /--method POST/);
  }
});

test("ensure-release fails early, naming the ids, when a tag already has two releases", () => {
  const r = sh("ensure-release.sh", ["v1.2.3"], env([[release(5, "v1.2.3", true), release(6, "v1.2.3", false, true)]]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error title=Duplicate releases::Found 2 releases for v1\.2\.3 \(ids: 5 6 \)/);
  assert.doesNotMatch(ghCalls(), /--method POST/);
});

test("ensure-release writes release_id to GITHUB_OUTPUT", () => {
  const out = join(work, "gh-output");
  rmSync(out, { force: true });
  const r = sh("ensure-release.sh", ["v1.2.3"], env([[release(55, "v1.2.3", true)]], { GITHUB_OUTPUT: out }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), "release_id=55\n");
});

// ── release-tag.sh: refuse when a release for the tag already exists ─────

function tagRepo() {
  const root = mkdtempSync(join(work, "repo-"));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", a, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", origin, clone);
  git(clone, "checkout", "-b", "main");
  writeFileSync(join(clone, "package.json"), JSON.stringify({ name: "x", version: "1.2.3" }));
  mkdirSync(join(clone, "scripts"));
  cpSync(join(SCRIPTS, "find-release.sh"), join(clone, "scripts", "find-release.sh"));
  cpSync(join(SCRIPTS, "release-tag.sh"), join(clone, "scripts", "release-tag.sh"));
  git(clone, "add", ".");
  git(clone, "commit", "-m", "chore: bump version to 1.2.3");
  git(clone, "push", "-u", "origin", "main");
  return { clone, origin, git };
}

const tagExists = (git: ReturnType<typeof tagRepo>["git"], where: string) => {
  try {
    git(where, "rev-parse", "-q", "--verify", "refs/tags/v1.2.3");
    return true;
  } catch {
    return false;
  }
};

test("release-tag refuses to tag or push when a draft release for the tag exists", () => {
  const { clone, origin, git } = tagRepo();
  const r = sh("release-tag.sh", [], env([[release(9, "v1.2.3", true)]]), clone);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /a GitHub release for v1\.2\.3 already exists/);
  assert.match(r.stdout, /releases\/9/);
  assert.match(r.stdout, /Nothing was tagged or pushed/);
  assert.equal(tagExists(git, clone), false);
  assert.equal(tagExists(git, origin), false);
});

test("release-tag also refuses for a published release", () => {
  const { clone, git } = tagRepo();
  const r = sh("release-tag.sh", [], env([[release(10, "v1.2.3", false, true)]]), clone);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /already exists/);
  assert.equal(tagExists(git, clone), false);
});

test("release-tag fails closed when it cannot list releases", () => {
  const { clone, git } = tagRepo();
  const r = sh("release-tag.sh", [], env([[]], { FAKE_GH_FAIL: "1" }), clone);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /could not list the GitHub releases/);
  assert.equal(tagExists(git, clone), false);
});

test("release-tag tags and pushes when no release exists", () => {
  const { clone, origin, git } = tagRepo();
  const r = sh("release-tag.sh", [], env([[release(1, "v1.2.2")]]), clone);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(tagExists(git, clone), true);
  assert.equal(tagExists(git, origin), true);
  assert.match(r.stdout, /wait for the production/);
});

test("release-tag --skip-release-check bypasses the check", () => {
  const { clone, git } = tagRepo();
  const r = sh("release-tag.sh", ["--skip-release-check"], env([[release(9, "v1.2.3", true)]]), clone);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(tagExists(git, clone), true);
  assert.equal(ghCalls(), "");
});

// ── check-existing-images.sh: what the docker job does about existing images ──

const API = "ghcr.io/o/hisaabo-api";
const ONCE = "ghcr.io/o/hisaabo";
const DIGEST_API = "sha256:" + "1".repeat(64);
const DIGEST_ONCE = "sha256:" + "2".repeat(64);

function images(modes: { api: string; once: string }, extra: Record<string, string> = {}) {
  const out = join(work, "images-output");
  rmSync(out, { force: true });
  const e = env([[]], {
    API_IMAGE: API,
    ONCE_IMAGE: ONCE,
    REF_NAME: "v1.2.3",
    FAKE_DOCKER_API: modes.api,
    FAKE_DOCKER_ONCE: modes.once,
    GITHUB_OUTPUT: out,
    ...extra,
  });
  const r = sh("check-existing-images.sh", [], e);
  let outputs = "";
  try {
    outputs = readFileSync(out, "utf8");
  } catch {
    // no outputs written
  }
  return { ...r, outputs };
}

test("check-existing-images: no image yet -> build (reuse=false)", () => {
  const r = images({ api: "missing", once: "missing" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.outputs, "reuse=false\n");
});

test("check-existing-images: both exist and no force -> reuse them, emit their digests, build nothing", () => {
  const r = images({ api: "exists", once: "exists" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.outputs, `reuse=true\napi_digest=${DIGEST_API}\nonce_digest=${DIGEST_ONCE}\n`);
  assert.match(r.stdout, /nothing is rebuilt or pushed/);
});

test("check-existing-images: force=true re-pushes over existing images, loudly", () => {
  const r = images({ api: "exists", once: "exists" }, { FORCE: "true" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.outputs, "reuse=false\n");
  assert.match(r.stdout, /::warning title=Overwriting release tag::force=true/);
});

test("check-existing-images: a partial publish fails and names force as the explicit repair", () => {
  for (const modes of [
    { api: "exists", once: "missing" },
    { api: "missing", once: "exists" },
  ]) {
    const r = images(modes);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /partially published/);
    assert.match(r.stdout, /force=true/);
    assert.equal(r.outputs, "");
  }
  // ... and force really does repair it.
  assert.equal(images({ api: "exists", once: "missing" }, { FORCE: "true" }).outputs, "reuse=false\n");
});

test("check-existing-images: fails closed on a registry error or an unreadable digest", () => {
  const net = images({ api: "error", once: "missing" });
  assert.equal(net.status, 1);
  assert.match(net.stdout, /failing closed/);
  const bad = images({ api: "baddigest", once: "exists" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /digest could not be read/);
});
