import Constants from "expo-constants";

export function getApiUrl(): string {
  // Check for explicit env var first (set at build time or in app.json extra)
  const envUrl =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  // Production: should be set via env
  return "https://api.hisaabo.in";
}
