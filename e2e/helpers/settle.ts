/**
 * settle.ts — the suite's "the app has stopped working" signal.
 *
 * The web app keeps `<html data-busy>` set while a react-query fetch or
 * mutation is in flight or a debounced input has not been committed yet
 * (apps/web/src/lib/busy-marker.ts). `settle(page)` resolves once the attribute
 * has been absent for two consecutive animation frames, so that:
 *   - after a search `fill()` it covers the debounce AND the request that follows,
 *     without sleeping for "a bit longer than the debounce";
 *   - after `goto`/a click it lets the page finish loading before a test counts
 *     rows, decides to skip, or asserts that something is NOT there (an absence
 *     assertion made before the data arrives passes vacuously).
 *
 * It does not replace positive waits ("this element is visible"): it proves the
 * page is quiet, not that the thing you expect is on it.
 */
import type { Page } from "@playwright/test";

export async function settle(page: Page, timeout = 10_000): Promise<void> {
  await page.evaluate(
    (timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + timeoutMs;
        let quietFrames = 0;
        const tick = () => {
          if (document.documentElement.hasAttribute("data-busy")) quietFrames = 0;
          else quietFrames += 1;
          if (quietFrames >= 2) resolve();
          else if (performance.now() > deadline) {
            reject(new Error(`settle(): the app is still busy (html[data-busy]) after ${timeoutMs}ms`));
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    timeout,
  );
}
