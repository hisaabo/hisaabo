'use strict';

/**
 * Node.js preload script (--require) for Vitest forks pool.
 *
 * This script patches Node's module resolution so that react-dom@19 (at the
 * workspace root) sees react@19 (at apps/web/node_modules/react) instead of
 * the conflicting react@18.3.1 that pnpm hoisted to the root for apps/mobile.
 *
 * Problem context
 * ───────────────
 * pnpm node-linker=hoisted:
 *   root/node_modules/react       → 18.3.1  (from apps/mobile)
 *   root/node_modules/react-dom   → 19.2.4  (from apps/web)
 *   apps/web/node_modules/react   → 19.2.4  (kept local because root has 18)
 *
 * When react-dom@19's CJS bundle calls require("react") it walks the directory
 * tree starting from root/node_modules/react-dom/ and finds root/react@18 first.
 * react-dom@19 uses React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
 * as its shared dispatcher object. react@18 does not export this property, so
 * ReactSharedInternals becomes undefined and every hook call that reads
 * ReactSharedInternals.H crashes with "Cannot read properties of null/undefined".
 *
 * Fix
 * ───
 * Before any test modules load, we:
 * 1. Resolve the exact file path that root/react-dom would use for "react".
 * 2. Load react@19 (from apps/web/node_modules/react) into require.cache.
 * 3. Insert the same module record under the root-react key so react-dom's
 *    CJS require("react") returns our react@19 instance.
 *
 * This must run via --require so it executes before any other module loads.
 */

const Module = require('node:module');
const path = require('node:path');

// Workspace root is 3 levels up from apps/web/scripts/.
const workspaceRoot = path.resolve(__dirname, '../../..');
const reactDomRootDir = path.join(workspaceRoot, 'node_modules', 'react-dom');
const react19Dir = path.join(workspaceRoot, 'apps', 'web', 'node_modules', 'react');

// Determine the absolute path that root/react-dom/index.js would resolve
// "react" to (i.e., root/node_modules/react/index.js → react@18).
const rootReactPath = Module._resolveFilename('react', {
  id: path.join(reactDomRootDir, 'index.js'),
  filename: path.join(reactDomRootDir, 'index.js'),
  paths: Module._nodeModulePaths(reactDomRootDir),
});

// Also determine the path for react@19 at apps/web/node_modules/react.
const react19Path = Module._resolveFilename('react', {
  id: path.join(react19Dir, 'index.js'),
  filename: path.join(react19Dir, 'index.js'),
  paths: Module._nodeModulePaths(react19Dir),
});

if (rootReactPath !== react19Path) {
  // Load react@19 into the module cache.
  require(react19Path);

  // Alias the root-react cache entry to our react@19 cache entry.
  // After this, any require("react") resolved from root/node_modules/react-dom/
  // will receive the react@19 exports instead of react@18.
  if (require.cache[react19Path] && !require.cache[rootReactPath]) {
    require.cache[rootReactPath] = require.cache[react19Path];
  }

  // Similarly alias the CJS main file (cjs/react.development.js).
  // When react-dom does require("react") and Node hits the conditional exports
  // it may resolve to the cjs file directly.
  const rootReactCjsPath = path.join(path.dirname(rootReactPath), 'cjs', 'react.development.js');
  const react19CjsPath = path.join(path.dirname(react19Path), 'cjs', 'react.development.js');
  try {
    require(react19CjsPath);
    if (require.cache[react19CjsPath] && !require.cache[rootReactCjsPath]) {
      require.cache[rootReactCjsPath] = require.cache[react19CjsPath];
    }
  } catch {}
}
