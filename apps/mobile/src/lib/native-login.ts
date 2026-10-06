import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { vanillaTRPC } from "./trpc";
import { getAppUrl, getNativeRedirectUri } from "./app-url";
import { codeChallengeS256, generateCodeVerifier, generateState } from "./pkce";

const PENDING_KEY = "nativeAuthPending";

interface PendingNativeAuth {
  requestId: string;
  verifier: string;
  state: string;
  expiresAt: number;
}

async function readPending(): Promise<PendingNativeAuth | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingNativeAuth) : null;
  } catch {
    return null;
  }
}

async function clearPending(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // best effort
  }
}

/** Register a PKCE sign-in request and open the system browser on the handoff page. */
export async function startNativeLogin(): Promise<void> {
  const verifier = generateCodeVerifier();
  const state = generateState();
  const { requestId, expiresAt } = await vanillaTRPC.auth.nativeStart.mutate({
    client: "mobile",
    redirectUri: getNativeRedirectUri(),
    codeChallenge: codeChallengeS256(verifier),
    codeChallengeMethod: "S256",
    state,
  });
  const pending: PendingNativeAuth = {
    requestId,
    verifier,
    state,
    expiresAt: new Date(expiresAt).getTime(),
  };
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending));
  await WebBrowser.openBrowserAsync(
    `${getAppUrl()}/auth/native?request=${encodeURIComponent(requestId)}`,
  );
}

export class NativeLoginError extends Error {}

/**
 * Finish a sign-in started by `startNativeLogin`. Returns the bearer session
 * token and user. The pending record is always consumed so a code cannot be replayed.
 */
export async function completeNativeLogin(
  code: string | undefined,
  state: string | undefined,
): Promise<{ sessionToken: string; user?: { name?: string | null } | null }> {
  const pending = await readPending();
  await clearPending();
  if (!pending || !code || !state || state !== pending.state || Date.now() > pending.expiresAt) {
    throw new NativeLoginError("This sign-in link is invalid or has expired. Please try again.");
  }
  try {
    const res = await vanillaTRPC.auth.nativeExchange.mutate({
      requestId: pending.requestId,
      code,
      codeVerifier: pending.verifier,
    });
    if (!res.sessionToken) throw new Error("missing session token");
    return { sessionToken: res.sessionToken, user: res.user };
  } catch {
    throw new NativeLoginError("Sign-in failed or expired. Please try again.");
  }
}
