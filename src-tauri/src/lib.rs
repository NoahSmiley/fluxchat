mod activity;
mod capture;
#[cfg(windows)]
mod global_keys;

use std::io::{Read, Write};
use std::net::TcpListener;
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

#[cfg(windows)]
#[tauri::command]
fn get_system_idle_ms() -> u64 {
    use windows::Win32::UI::WindowsAndMessaging::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::System::SystemInformation::GetTickCount;
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        let _ = GetLastInputInfo(&mut lii);
        let now = GetTickCount();
        now.wrapping_sub(lii.dwTime) as u64
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn get_system_idle_ms() -> u64 {
    0
}

#[tauri::command]
fn detect_activity() -> Option<activity::DetectedActivity> {
    activity::detect_activity()
}

/// One-shot HTTP server on 127.0.0.1:29170 that catches an OAuth redirect.
/// Spotify redirects the browser here; we extract code+state, then redirect
/// the browser to the backend's GET /api/spotify/callback for token exchange.
#[tauri::command]
async fn start_oauth_listener(server_url: String) -> Result<serde_json::Value, String> {
    let handle = std::thread::spawn(move || -> Result<serde_json::Value, String> {
        let listener = TcpListener::bind("127.0.0.1:29170").map_err(|e| format!("bind: {e}"))?;

        // Block until Spotify redirects here (frontend has its own 5-min timeout)
        let (mut stream, _) = listener.accept().map_err(|e| format!("accept: {e}"))?;

        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        let request = String::from_utf8_lossy(&buf[..n]);

        // Parse "GET /callback?code=...&state=... HTTP/1.1"
        let path = request.lines().next().unwrap_or("")
            .split_whitespace().nth(1).unwrap_or("");
        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

        let mut code = String::new();
        let mut state = String::new();
        let mut error = String::new();
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                match k {
                    "code" => code = urldecode(v),
                    "state" => state = urldecode(v),
                    "error" => error = urldecode(v),
                    _ => {}
                }
            }
        }

        // Redirect browser to backend's GET callback (which does the token exchange)
        let response = if !error.is_empty() {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
                <html><body style=\"background:#1a1a2e;color:#fff;font-family:system-ui;\
                display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
                <div style=\"text-align:center\"><h2>Spotify Authorization Failed</h2>\
                <p>{error}</p><p>You can close this tab.</p></div></body></html>"
            )
        } else {
            let backend_url = format!(
                "{}/api/spotify/callback?code={}&state={}",
                server_url.trim_end_matches('/'),
                urlencode(&code),
                urlencode(&state),
            );
            format!("HTTP/1.1 302 Found\r\nLocation: {backend_url}\r\nConnection: close\r\n\r\n")
        };

        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        Ok(serde_json::json!({ "code": code, "state": state, "error": error }))
    });

    // Await the thread on the async runtime without blocking it
    tauri::async_runtime::spawn_blocking(move || {
        handle.join().map_err(|_| "listener thread panicked".to_string())?
    })
    .await
    .map_err(|e| format!("spawn: {e}"))?
}

fn urldecode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        match b {
            b'%' => {
                let hi = bytes.next().unwrap_or(b'0');
                let lo = bytes.next().unwrap_or(b'0');
                if let Ok(val) = u8::from_str_radix(&format!("{}{}", hi as char, lo as char), 16) {
                    out.push(val as char);
                }
            }
            b'+' => out.push(' '),
            _ => out.push(b as char),
        }
    }
    out
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => { out.push_str(&format!("%{:02X}", b)); }
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            set_titlebar_color,
            open_popout_window,
            close_popout_window,
            get_capture_sources,
            detect_activity,
            get_system_idle_ms,
            start_oauth_listener,
            #[cfg(windows)]
            global_keys::start_global_key_listen,
            #[cfg(windows)]
            global_keys::stop_global_key_listen,
        ])
        .setup(|app| {
            #[cfg(windows)]
            global_keys::init(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
