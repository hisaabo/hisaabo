const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for shared packages
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and monorepo root node_modules.
// Expo's getDefaultConfig already detects the monorepo, but we set this
// explicitly to be safe with pnpm's hoisting layout.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Enable package.json "exports" field resolution. Many modern packages
// (copy-anything, is-what, etc.) only declare entry points via "exports"
// and have no "main" field. Without this, Metro cannot resolve them.
config.resolver.unstable_enablePackageExports = true;

// Condition names for export map resolution. "require" and "import" are
// the defaults from Expo; we add "react-native" so packages that ship
// React Native-specific bundles are picked up correctly on all platforms.
config.resolver.unstable_conditionNames = [
  "require",
  "import",
  "react-native",
];

// Do NOT enable disableHierarchicalLookup. In a pnpm monorepo the
// transitive deps of hoisted packages (e.g. superjson -> copy-anything)
// live as siblings in root node_modules. Hierarchical lookup is needed
// so Metro can walk up from a package's directory and find its deps.

// Resolve .js imports to .ts source files (shared package uses Node ESM
// .js extensions in its imports, e.g. import { x } from './validators.js')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only intercept relative .js imports from workspace packages (not node_modules)
  if (
    moduleName.startsWith("./") &&
    moduleName.endsWith(".js") &&
    context.originModulePath &&
    !context.originModulePath.includes("node_modules")
  ) {
    const tsName = moduleName.replace(/\.js$/, ".ts");
    try {
      return context.resolveRequest(context, tsName, platform);
    } catch {
      // Fall through to default resolution
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
