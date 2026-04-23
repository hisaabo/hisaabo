/**
 * Resolve an API path to a full URL based on the build-time VITE_API_URL.
 *
 * - When VITE_API_URL is unset (dev + single-origin deploys): returns the
 *   path unchanged, relying on Vite's dev-server proxy or same-origin nginx.
 * - When VITE_API_URL is set (split-host deploys like app.hisaabo.in +
 *   api.hisaabo.in): prefixes the path with the API origin so fetches hit
 *   the API directly instead of falling through the web host's SPA fallback.
 *
 * Mirrors the logic in trpc.ts — keep this helper in sync with that resolver.
 */
export function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  return base ? `${base}${path}` : path;
}
