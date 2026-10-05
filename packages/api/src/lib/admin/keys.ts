/**
 * keys.ts — Raw-mode stdin chunk → key tokens.
 *
 * Kept separate from bin/admin.ts so it can be unit-tested without
 * importing (and therefore running) the CLI entry point.
 */

/** Split a raw stdin chunk into key tokens (escape sequences kept whole). */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[") {
      let j = i + 2;
      while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++;
      keys.push(chunk.slice(i, j + 1));
      i = j + 1;
    } else if (chunk[i] === "\x1b" && chunk[i + 1] === "O" && i + 2 < chunk.length) {
      // Application cursor mode: ESC O A … → normalise to the CSI form.
      keys.push(`\x1b[${chunk[i + 2]}`);
      i += 3;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}
