/**
 * Build-time generators for the files that bind the native apps to this
 * domain: Android `assetlinks.json` and iOS `apple-app-site-association`.
 */

export const ANDROID_PACKAGE = "in.hisaabo.app";
export const IOS_BUNDLE_ID = "in.hisaabo.app";
export const APP_LINK_PATHS = ["/auth/native/callback*", "/auth/verify*", "/invite/*"];

const PLACEHOLDER_SHA256 = "TODO:REPLACE_WITH_SHA256_FROM_KEYTOOL";
const PLACEHOLDER_TEAM_ID = "TEAM_ID";
const SHA256_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;

export interface WellKnownEnv {
  VITE_ANDROID_APP_CERT_SHA256?: string;
  VITE_APPLE_TEAM_ID?: string;
}

export interface WellKnownFiles {
  assetlinks: unknown;
  aasa: unknown;
  warnings: string[];
}

export function generateWellKnown(env: WellKnownEnv): WellKnownFiles {
  const warnings: string[] = [];

  const rawCerts = (env.VITE_ANDROID_APP_CERT_SHA256 ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  for (const cert of rawCerts) {
    if (!SHA256_RE.test(cert)) {
      throw new Error(
        `VITE_ANDROID_APP_CERT_SHA256 contains an invalid SHA-256 fingerprint "${cert}" (expected 32 colon-separated hex bytes).`,
      );
    }
  }
  const certs = rawCerts.length ? rawCerts : [PLACEHOLDER_SHA256];
  if (!rawCerts.length) {
    warnings.push(
      "VITE_ANDROID_APP_CERT_SHA256 is not set; assetlinks.json contains a placeholder and Android App Links will not verify.",
    );
  }

  const teamId = (env.VITE_APPLE_TEAM_ID ?? "").trim().toUpperCase();
  if (teamId && !TEAM_ID_RE.test(teamId)) {
    throw new Error(`VITE_APPLE_TEAM_ID "${teamId}" is invalid (expected 10 letters/digits).`);
  }
  if (!teamId) {
    warnings.push(
      "VITE_APPLE_TEAM_ID is not set; apple-app-site-association contains a placeholder and iOS Universal Links will not verify.",
    );
  }

  return {
    assetlinks: [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: certs,
        },
      },
    ],
    aasa: {
      applinks: {
        apps: [],
        details: [
          {
            appID: `${teamId || PLACEHOLDER_TEAM_ID}.${IOS_BUNDLE_ID}`,
            paths: APP_LINK_PATHS,
          },
        ],
      },
    },
    warnings,
  };
}
