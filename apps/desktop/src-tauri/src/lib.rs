use tauri::Listener;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Listen for deep link events (hisaabo://auth/verify?token=xxx)
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                if let Some(urls) = serde_json::from_str::<Vec<String>>(event.payload()).ok() {
                    for url in urls {
                        if url.contains("/auth/verify") {
                            if let Some(window) = handle.get_webview_window("main") {
                                let query = url.split('?').nth(1).unwrap_or("");
                                let js = format!(
                                    "window.location.href = '/auth/verify?{}'",
                                    query
                                );
                                let _ = window.eval(&js);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
