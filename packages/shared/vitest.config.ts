import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The money / inclusive-price / price-propagation suites are deterministic sweeps over
    // hundreds of thousands of cases. CI runners are 2-3x slower than a laptop, and the
    // 5 s default timed one out (2-dp parse sweep: ~5 s on CI, ~1.5 s locally).
    testTimeout: 30_000,
  },
});
