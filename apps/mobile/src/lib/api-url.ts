import Constants from "expo-constants";

export function getApiUrl(): string {
  // Check for explicit env var first
  const envUrl =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  // Default: Android emulator's host alias
  if (__DEV__) return "http://10.0.2.2:3000";

  // Production: should be set via env
  return "https://api.hisaabo.in";
}
