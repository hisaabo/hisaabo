import Constants from "expo-constants";

export function getApiUrl(): string {
  // Read process.env via a local variable so the babel-preset-expo
  // inline-env-vars plugin does not bake EXPO_PUBLIC_API_URL into the bundle
  // as a compile-time constant.  The plugin only substitutes direct
  // `process.env.EXPO_PUBLIC_*` member-expression patterns; accessing through
  // an intermediate reference keeps the read dynamic.
  //
  // Why this matters for tests: babel-preset-expo inlines EXPO_PUBLIC_ vars
  // when the caller lacks `isDev: true`.  Jest runs with NODE_ENV='test', so
  // inlining would be enabled, causing per-test process.env mutations to have
  // no effect.  Using an intermediary reference avoids the pattern match.
  const env = process.env as Record<string, string | undefined>;

  // Priority 1: app.json / eas.json `extra.apiUrl` (set at EAS build time)
  // Priority 2: EXPO_PUBLIC_API_URL env var (set in .env or CI pipeline)
  // Priority 3: hardcoded production fallback
  const envUrl =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    env["EXPO_PUBLIC_API_URL"];
  if (envUrl) return envUrl;

  // Production default — the URL every Play Store / App Store user hits.
  // Changing this value is a production-impacting deployment decision.
  return "https://api.hisaabo.in";
}
