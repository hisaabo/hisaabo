/**
 * True when the web bundle is running inside the Tauri desktop shell.
 *
 * Tauri v2 exposes `__TAURI_INTERNALS__` on window; v1 used `__TAURI__`.
 * Checking both keeps this robust across Tauri upgrades.
 */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || "__TAURI__" in w;
}
