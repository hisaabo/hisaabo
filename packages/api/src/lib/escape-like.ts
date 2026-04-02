/** Escape LIKE/ILIKE metacharacters so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}
