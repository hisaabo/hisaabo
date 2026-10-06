use tauri::Emitter;
use tauri::Listener;

mod deep_link;
mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            session::save_session_token,
            session::get_session_token,
            session::clear_session_token,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Listen for deep link events (hisaabo://verify?token=xxx).
            // The URL is parsed strictly and only the validated token is
            // forwarded to the webview as an event; the web app performs the
            // navigation. Nothing from the URL is ever evaluated as script.
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                    for url in urls {
                        if let Some(token) = deep_link::parse_verify_token(&url) {
                            let _ = handle.emit_to("main", "hisaabo://verify-token", token);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
