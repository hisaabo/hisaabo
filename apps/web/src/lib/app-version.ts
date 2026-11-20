/**
 * Build identity shown in the sidebar footer (`v0.9.0 · abc1234`).
 *
 * `__APP_VERSION__` / `__APP_COMMIT__` are Vite `define`s set in
 * vite.config.ts, which also imports `shortCommit` from here so the config and
 * the UI normalise the SHA identically. Pure functions: no globals are read at
 * import time (vite.config.ts runs in Node, where the defines do not exist).
 */

/** Characters of the commit SHA shown in the UI (a prefix of the API's 12-char short form). */
export const COMMIT_DISPLAY_LENGTH = 7;

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/**
 * Short, display-ready commit from a full or abbreviated SHA. Returns "" for
 * anything that is not a plausible hex SHA (absent, `unknown`, junk) so the
 * label simply omits it rather than showing noise.
 */
export function shortCommit(raw: string | undefined | null): string {
  const c = raw?.trim().toLowerCase();
  return c && COMMIT_RE.test(c) ? c.slice(0, COMMIT_DISPLAY_LENGTH) : "";
}

/** `v0.9.0 · abc1234`, or just `v0.9.0` when there is no commit. */
export function versionLabel(version: string, commit: string | undefined | null): string {
  const short = shortCommit(commit);
  return short ? `v${version} · ${short}` : `v${version}`;
}

/**
 * Label for the running build. `__APP_COMMIT__` is guarded with `typeof`
 * because it only exists in Vite builds (tests, storybooks and tools that
 * evaluate the source without the define must not throw).
 */
export function appVersionLabel(): string {
  return versionLabel(__APP_VERSION__, typeof __APP_COMMIT__ === "undefined" ? undefined : __APP_COMMIT__);
}
