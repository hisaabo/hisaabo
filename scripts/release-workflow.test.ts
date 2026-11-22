// Run: node --experimental-strip-types --test scripts/release-workflow.test.ts
//
// Guards the release-ordering invariants of the GitHub workflows that the
// 0.10.0 release broke, as plain text checks (no YAML parser in the repo
// root): web/store never reach production ahead of the API, only a release tag
// reaches production at all, and exactly one job creates the GitHub release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

/** The text of one top-level job (from `  name:` to the next job or EOF). */
function job(workflow: string, name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Job names listed in a job's `needs:` (inline list or single value). */
function needs(block: string): string[] {
  const m = /^ {4}needs:\s*(.+)$/m.exec(block);
  assert.ok(m, "job has no needs:");
  return m[1]!.replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

const release = read("release.yml");

test("web, store and API docs deploy only after wait-for-api", () => {
  for (const name of ["deploy-web", "deploy-store", "deploy-api-docs"]) {
    const block = job(release, name);
    assert.ok(needs(block).includes("wait-for-api"), `${name} must need wait-for-api`);
    assert.doesNotMatch(block, /always\(\)/, `${name} must not run past a failed or skipped wait (no always())`);
    assert.match(block, /uses: \.\/\.github\/workflows\/deploy-/, `${name} must call the deploy workflow`);
  }
});

test("wait-for-api starts only after the images are built, pushed and signed", () => {
  const wait = job(release, "wait-for-api");
  assert.ok(needs(wait).includes("docker"), "wait-for-api must need docker");
  assert.doesNotMatch(wait, /always\(\)/);
  // GitHub stops a hosted job at 360 minutes; the wait must fit under it.
  const timeout = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(wait)?.[1]);
  assert.ok(timeout > 0 && timeout < 360, `wait-for-api timeout-minutes ${timeout} must be under 360`);

  const docker = job(release, "docker");
  const sign = docker.indexOf("cosign sign --yes");
  const lastSign = docker.lastIndexOf("cosign sign --yes");
  const verify = docker.indexOf("Verify image signatures");
  assert.ok(sign !== -1 && verify > lastSign, "signatures are verified after BOTH images are signed");
});

test("the wait has an emergency bypass that defaults to off", () => {
  assert.match(release, /skip_api_wait:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
  assert.match(job(release, "wait-for-api"), /SKIP_API_WAIT:/);
});

test("exactly one job creates the GitHub release", () => {
  assert.doesNotMatch(release, /uses:\s*softprops\/action-gh-release/, "no action may create a release behind prepare-release");
  assert.doesNotMatch(release, /^\s*(run:\s*)?gh release create/m);
  assert.doesNotMatch(release, /^\s+tagName:/m, "tauri-action must upload by releaseId, not create by tagName");
  assert.match(job(release, "desktop"), /releaseId: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/);
  for (const name of ["docker", "desktop", "mobile", "release-notes"]) {
    assert.ok(needs(job(release, name)).includes("prepare-release"), `${name} must need prepare-release`);
  }
  assert.match(job(release, "prepare-release"), /scripts\/ensure-release\.sh/);
  // The notes job patches the prepared release by id (in publish-release.sh); it never creates one.
  assert.match(step(job(release, "release-notes"), "Publish release"), /RELEASE_ID: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/);
  assert.match(readFileSync(new URL("./publish-release.sh", import.meta.url), "utf8"), /releases\/\$\{RELEASE_ID\}/);
  assert.doesNotMatch(readFileSync(new URL("./publish-release.sh", import.meta.url), "utf8"), /--method POST/);
});

test("production Pages deploys happen only for a release tag; main goes to the preview alias", () => {
  for (const name of ["deploy-web.yml", "deploy-store.yml", "deploy-api-docs.yml"]) {
    const wf = read(name);
    // The Pages branch is production only when called with a ref (a tag) ...
    assert.match(
      wf,
      /--branch=\$\{\{ inputs\.ref && \(vars\.CF_PAGES_PRODUCTION_BRANCH \|\| 'main'\) \|\| 'preview' \}\}/,
      `${name}: --branch must be preview unless inputs.ref is set`,
    );
    // ... in the `production` environment (required reviewers) ...
    assert.match(wf, /environment: \$\{\{ inputs\.ref && 'production' \|\| 'preview' \}\}/, `${name}: environment`);
    // ... and a production ref must be a release tag.
    assert.match(wf, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/, `${name}: ref must be checked as a release tag`);
  }
});

/** The text of one step of a job, found by its `name:`. */
function step(block: string, name: string): string {
  const lines = block.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `step "${name}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}- /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("a second run on the tag reuses the published images instead of failing, and re-verifies them", () => {
  const docker = job(release, "docker");
  // The decision comes from the script; force is the only way to overwrite.
  assert.match(step(docker, "Check for already-published release images"), /scripts\/check-existing-images\.sh/);
  assert.doesNotMatch(docker, /Refuse to overwrite/);
  const reuse = /if: steps\.existing\.outputs\.reuse != 'true'/;
  for (const name of [
    "Image metadata (API)",
    "Build & push API image",
    "Sign API image (cosign, keyless)",
    "Image metadata (ONCE)",
    "Build & push ONCE image",
    "Sign ONCE image (cosign, keyless)",
  ]) {
    assert.match(step(docker, name), reuse, `"${name}" must be skipped when the images are reused`);
  }
  // Verification is NOT skipped: a reused image is proven, with the existing digests.
  const verify = step(docker, "Verify image signatures");
  assert.doesNotMatch(verify, /^\s+if:/m);
  assert.match(verify, /steps\.existing\.outputs\.api_digest/);
  assert.match(verify, /steps\.existing\.outputs\.once_digest/);
  assert.match(verify, /--certificate-github-workflow-sha/);
  // The job outputs carry the existing digests when nothing was built.
  assert.match(docker, /api_digest: \$\{\{ steps\.build_api\.outputs\.digest \|\| steps\.existing\.outputs\.api_digest \}\}/);
  assert.match(docker, /once_digest: \$\{\{ steps\.build_once\.outputs\.digest \|\| steps\.existing\.outputs\.once_digest \}\}/);
});

test("a timed-out API wait cannot publish the release", () => {
  const notes = job(release, "release-notes");
  // The decision is in the script and receives the wait result ...
  assert.match(step(notes, "Publish release"), /WAIT_RESULT: \$\{\{ needs\.wait-for-api\.result \}\}/);
  assert.match(step(notes, "Publish release"), /scripts\/publish-release\.sh/);
  // ... and the script publishes only for success / skipped.
  const script = readFileSync(new URL("./publish-release.sh", import.meta.url), "utf8");
  assert.match(script, /success \| skipped\)\n\s+args\+=\(-F draft=false/);
});
