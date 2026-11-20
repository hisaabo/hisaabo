/**
 * Whether this web build uses a Cloudflare Turnstile challenge on sign-in.
 *
 * The API enforces Turnstile only when TURNSTILE_SECRET_KEY is set. A web build
 * made without VITE_TURNSTILE_SITE_KEY (a self-hosted install that does not use
 * Turnstile) has nothing to render, so the sign-in form must not open the
 * challenge modal: it would show an error and the form could never be
 * submitted. Such a build submits without a token; if the server does require
 * one it answers "Turnstile verification required", which the form shows.
 *
 * Dev builds keep using the Cloudflare always-pass test key (see TurnstileModal).
 */
export function isTurnstileConfigured(
  env: { VITE_TURNSTILE_SITE_KEY?: string; PROD?: boolean } = import.meta.env,
): boolean {
  return Boolean(env.VITE_TURNSTILE_SITE_KEY) || !env.PROD;
}
