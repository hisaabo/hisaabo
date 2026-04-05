/**
 * Spinner utility for long-running CLI operations.
 *
 * Uses a simple ANSI spinner that works cross-platform. No external deps
 * needed — just stdout.write with cursor control.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

/**
 * Run an async function with a terminal spinner. The spinner is only shown
 * when stdout is a TTY (skipped in pipes/CI).
 *
 * Usage:
 *   const result = await withSpinner("Loading invoices...", () => client.invoice.list(input));
 */
export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  // No spinner in non-interactive environments
  if (!process.stdout.isTTY) return fn();

  let frame = 0;
  const timer = setInterval(() => {
    const spinner = FRAMES[frame % FRAMES.length];
    process.stdout.write(`\r  ${spinner} ${label}`);
    frame++;
  }, INTERVAL);

  try {
    const result = await fn();
    clearInterval(timer);
    process.stdout.write(`\r${" ".repeat(label.length + 6)}\r`); // clear spinner line
    return result;
  } catch (err) {
    clearInterval(timer);
    process.stdout.write(`\r${" ".repeat(label.length + 6)}\r`);
    throw err;
  }
}
