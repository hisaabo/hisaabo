//! Desktop session-token storage backed by the OS credential manager.
//!
//! The desktop app uses Bearer-token auth (not HttpOnly cookies) so that
//! the Tauri webview at `tauri.localhost` can talk to `https://api.hisaabo.in`
//! cross-origin without relaxing `SameSite=Lax` on web. Tokens are stored
//! in the OS-native credential store — Keychain on macOS, Credential Manager
//! on Windows, libsecret on Linux — matching the mobile app's
//! `expo-secure-store` posture.
//!
//! Design notes:
//! - Service name is the bundle identifier `in.hisaabo.app` so OS-level
//!   ACLs isolate this token from other apps running as the same user.
//! - Account name `session_token` is a stable label; we don't version it.
//! - On Linux, if libsecret / gnome-keyring isn't available (headless or
//!   minimal distro), operations will fail. We intentionally do NOT fall
//!   back to plaintext storage — the user re-logs in each launch instead.
//!   This matches the "never silently downgrade" guidance from the P0
//!   security review.
//! - Errors are returned as `String` so the TypeScript side can surface
//!   them verbatim. The JS side treats any failure as "no token available"
//!   and prompts re-login.

use keyring::Entry;

const SERVICE: &str = "in.hisaabo.app";
const ACCOUNT: &str = "session_token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keyring init failed: {e}"))
}

#[tauri::command]
pub fn save_session_token(token: String) -> Result<(), String> {
    if token.is_empty() {
        return Err("empty token".into());
    }
    entry()?
        .set_password(&token)
        .map_err(|e| format!("keyring write failed: {e}"))
}

#[tauri::command]
pub fn get_session_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        // NoEntry means "no token stored yet" — not an error condition;
        // the user just hasn't logged in on this machine.
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring read failed: {e}")),
    }
}

#[tauri::command]
pub fn clear_session_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a non-existent entry is not an error from the caller's
        // perspective — the end state is what was requested.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}
