import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Absolute paths for the single React 19 installation we want every module to
// share.  In this pnpm monorepo (node-linker=hoisted) the root node_modules
// contains react@18.3.1 (from apps/mobile) and react-dom@19.2.4 (from
// apps/web).  pnpm kept a separate react@19.2.4 under apps/web/node_modules
// because the root version conflicts.  But react-dom@19, loaded from the root,
// calls require("react") via Node CJS resolution and finds root/react@18.
// Using the SAME react-dom we must point react to the root too — EXCEPT the
// root react is v18 so they are version-mismatched.
//
// The only clean solution without touching pnpm installs: install a local copy
// of react-dom inside apps/web/node_modules so it can find the co-located
// react@19 via Node's normal upward resolution.  Since pnpm won't do that
// automatically (react-dom@19 satisfies the root spec), we create this mapping
// at the Vite resolve level AND force both packages through Vite's transform
// pipeline with server.deps.inline so the alias intercepts their CJS require.
const REACT19_PATH = path.resolve(__dirname, "node_modules/react");
const REACT_DOM19_PATH = path.resolve(__dirname, "../../node_modules/react-dom");

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Exclude route files — they depend on TanStack Router's file-based
    // route generation which requires the full Vite plugin pipeline.
    exclude: ["**/node_modules/**", "**/routes/**"],
    // Prevent memory explosion: single fork reuses one worker for all test files
    // instead of spawning parallel jsdom environments
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 10000,
    teardownTimeout: 5000,
    server: {
      deps: {
        // Force react-dom and testing-library through Vite's transform pipeline
        // so their internal require("react") calls get intercepted by the alias
        // in resolve.alias. Without inline, these CJS modules are loaded via
        // Node's native require() which ignores Vite aliases — causing react-dom
        // to grab root/react@18 and break the hook dispatcher.
        inline: [
          /react-dom/,
          /@testing-library/,
          /vitest-axe/,
          /axe-core/,
        ],
      },
    },
  },
  resolve: {
    // Pin every "react" import — including internal require("react") calls inside
    // the inlined react-dom CJS — to the single react@19.2.4 at apps/web.
    // Both react@19 and react-dom@19 must share the same ReactSharedInternals
    // object; if they don't, the hook dispatcher (ReactSharedInternals.H) is
    // never set and hooks throw "Cannot read properties of null".
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": REACT19_PATH,
      "react-dom": REACT_DOM19_PATH,
      "react/jsx-runtime": path.join(REACT19_PATH, "jsx-runtime"),
      "react/jsx-dev-runtime": path.join(REACT19_PATH, "jsx-dev-runtime"),
    },
  },
});
