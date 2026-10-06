//! Tauri commands for the browser sign-in handoff (RFC 8252 loopback flow).

use std::net::TcpListener;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

use crate::external_url::is_allowed_external_url;
use crate::native_login::{serve_one_callback, CALLBACK_TIMEOUT};

const CALLBACK_EVENT: &str = "hisaabo://native-callback";

/// Bind a one-shot loopback listener, return its port, and emit
/// `hisaabo://native-callback` `{code,state}` to the main window when the
/// browser lands on `/callback` with the expected `state`.
#[tauri::command]
pub fn start_native_login(app: AppHandle, state: String) -> Result<u16, String> {
    if state.len() < 16 || state.len() > 128 {
        return Err("invalid state".into());
    }
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("could not open listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read listener address: {e}"))?
        .port();
    std::thread::spawn(move || {
        if let Some(callback) = serve_one_callback(&listener, &state, CALLBACK_TIMEOUT) {
            let _ = app.emit_to("main", CALLBACK_EVENT, callback);
        }
    });
    Ok(port)
}

/// Open an https URL (or loopback http in debug builds) in the system browser.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url, cfg!(debug_assertions)) {
        return Err("url not allowed".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler").arg(&url);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open browser: {e}"))
}
