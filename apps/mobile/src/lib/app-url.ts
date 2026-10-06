import Constants from "expo-constants";

// Web origin that hosts the sign-in handoff page and the verified App Links /
// Universal Links. Must match the API's APP_URL exactly because the server
// only accepts `${APP_URL}/auth/native/callback` as the mobile redirect URI.
function assertSecureAppUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (__DEV__ && /^http:\/\//i.test(trimmed)) return trimmed;
  throw new Error("Insecure app URL: release builds require https://");
}

export function getAppUrl(): string {
  // Read via an intermediate reference so babel-preset-expo does not inline
  // EXPO_PUBLIC_APP_URL at compile time (see getApiUrl).
  const env = process.env as Record<string, string | undefined>;
  const envUrl =
    (Constants.expoConfig?.extra?.appUrl as string | undefined) ||
    env["EXPO_PUBLIC_APP_URL"];
  if (envUrl) return assertSecureAppUrl(envUrl);
  return "https://app.hisaabo.in";
}

export const NATIVE_CALLBACK_PATH = "/auth/native/callback";

export function getNativeRedirectUri(): string {
  return `${getAppUrl()}${NATIVE_CALLBACK_PATH}`;
}
