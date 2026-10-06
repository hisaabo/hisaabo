/**
 * Desktop browser sign-in (RFC 8252 loopback + PKCE).
 *
 * The Tauri shell listens on 127.0.0.1 for the browser's redirect and emits
 * `hisaabo://native-callback`; `useDesktopDeepLink` forwards that event to
 * `handleNativeCallback`, which completes the code exchange.
 */

import { invoke } from "@tauri-apps/api/core";
import { saveDesktopToken } from "./desktop-session";
import { codeChallengeS256, generateCodeVerifier, generateState } from "./pkce";

export interface NativeLoginApi {
  start(input: {
    client: "desktop";
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    state: string;
  }): Promise<{ requestId: string }>;
  exchange(input: {
    requestId: string;
    code: string;
    codeVerifier: string;
  }): Promise<{ sessionToken?: string | null }>;
}

export class NativeLoginError extends Error {
  constructor(
    message: string,
    readonly kind: "cancelled" | "timeout" | "failed",
  ) {
    super(message);
  }
}

interface Pending {
  api: NativeLoginApi;
  requestId: string;
  verifier: string;
  state: string;
  settle: (error?: NativeLoginError) => void;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000 + 15_000;

let pending: Pending | null = null;

function appUrl(): string {
  const configured = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if ((import.meta as unknown as { env: { DEV?: boolean } }).env?.DEV) return window.location.origin;
  return "https://app.hisaabo.in";
}

export function cancelDesktopLogin(): void {
  pending?.settle(new NativeLoginError("Sign-in cancelled", "cancelled"));
}

/**
 * Starts the browser sign-in. Resolves once the session token is stored in
 * the keychain; rejects with a NativeLoginError on cancel, timeout or failure.
 */
export async function beginDesktopLogin(api: NativeLoginApi): Promise<void> {
  cancelDesktopLogin();

  const verifier = generateCodeVerifier();
  const state = generateState();
  const challenge = await codeChallengeS256(verifier);

  const port = await invoke<number>("start_native_login", { state });
  const { requestId } = await api.start({
    client: "desktop",
    redirectUri: `http://127.0.0.1:${port}/callback`,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state,
  });

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => entry.settle(new NativeLoginError("Sign-in timed out", "timeout")),
      LOGIN_TIMEOUT_MS,
    );
    const entry: Pending = {
      api,
      requestId,
      verifier,
      state,
      settle(error) {
        clearTimeout(timer);
        if (pending === entry) pending = null;
        if (error) reject(error);
        else resolve();
      },
    };
    pending = entry;
    invoke("open_external_url", {
      url: `${appUrl()}/auth/native?request=${encodeURIComponent(requestId)}`,
    }).catch(() => entry.settle(new NativeLoginError("Could not open the browser", "failed")));
  });
}

/** Called with the loopback callback payload; ignores anything unexpected. */
export async function handleNativeCallback(payload: { code: string; state: string }): Promise<void> {
  const entry = pending;
  if (!entry || payload.state !== entry.state) return;
  try {
    const result = await entry.api.exchange({
      requestId: entry.requestId,
      code: payload.code,
      codeVerifier: entry.verifier,
    });
    if (!result.sessionToken) throw new Error("missing session token");
    await saveDesktopToken(result.sessionToken);
    entry.settle();
  } catch {
    entry.settle(new NativeLoginError("Sign-in failed. Please try again.", "failed"));
  }
}

export function _resetNativeLoginForTests(): void {
  pending = null;
}
