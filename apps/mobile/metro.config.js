const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Expo SDK 55 auto-detects the pnpm monorepo and sets watchFolders +
// nodeModulesPaths correctly.  No manual overrides needed.

// Condition names for export map resolution.  Metro's module system is
// CommonJS-based, so we must use "require" (not "import").  Including
// "import" causes @babel/runtime helpers (e.g. interopRequireDefault) to
// resolve to their ESM wrapper which exports `{ default: fn }` instead
// of the function directly, producing the runtime error:
//   "_interopRequireDefault is not a function (it is Object)"
// "react-native" is listed first so packages that ship RN-specific
// bundles via their exports map are picked up correctly.
config.resolver.unstable_conditionNames = [
  "react-native",
  "require",
];

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
