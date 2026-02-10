mod capture;

use tauri::Manager;

#[tauri::command]
fn set_titlebar_color(window: tauri::Window, color: String) {
    let _ = (window, color);
}

#[tauri::command]
async fn open_popout_window(app: tauri::AppHandle, window_type: String) -> Result<(), String> {
    let label = format!("popout-{}", window_type);

    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let url = format!("/?popout={}", window_type);
    let _window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title(format!("Flux - {}", window_type))
        .inner_size(800.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn close_popout_window(app: tauri::AppHandle, window_type: String) -> Result<(), String> {
    let label = format!("popout-{}", window_type);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_capture_sources() -> Vec<capture::CaptureSource> {
    capture::get_sources()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            set_titlebar_color,
            open_popout_window,
            close_popout_window,
            get_capture_sources,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
