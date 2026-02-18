use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::OnceLock;
use tauri::Emitter;
use windows::Win32::Foundation::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
/// Non-zero when the target is a keyboard key (stores the VK code).
static TARGET_VK: AtomicU32 = AtomicU32::new(0);
/// Non-zero when the target is a mouse button (1=left, 2=middle, 3=right, 4=X1, 5=X2).
static TARGET_MOUSE: AtomicU32 = AtomicU32::new(0);
static IS_PRESSED: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

/// Store the AppHandle so the hook callbacks can emit events.
pub fn init(app: &tauri::AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
}

/// Convert a KeyboardEvent.code string to a Windows virtual key code.
fn code_to_vk(code: &str) -> Option<u32> {
    // Letters: "KeyA" .. "KeyZ"
    if code.starts_with("Key") && code.len() == 4 {
        let ch = code.as_bytes()[3];
        if ch.is_ascii_uppercase() {
            return Some(ch as u32); // VK_A=0x41 .. VK_Z=0x5A
        }
    }
    // Digits: "Digit0" .. "Digit9"
    if code.starts_with("Digit") && code.len() == 6 {
        let ch = code.as_bytes()[5];
        if ch.is_ascii_digit() {
            return Some(ch as u32); // VK_0=0x30 .. VK_9=0x39
        }
    }
    // Function keys: "F1" .. "F24"
    if code.starts_with('F') && code.len() >= 2 {
        if let Ok(n) = code[1..].parse::<u32>() {
            if (1..=24).contains(&n) {
                return Some(0x70 + n - 1); // VK_F1=0x70
            }
        }
    }
    // Named keys
    match code {
        "Space" => Some(0x20),
        "Enter" => Some(0x0D),
        "Tab" => Some(0x09),
        "CapsLock" => Some(0x14),
        "ShiftLeft" | "ShiftRight" => Some(0x10),
        "ControlLeft" | "ControlRight" => Some(0x11),
        "AltLeft" | "AltRight" => Some(0x12),
        "Backquote" => Some(0xC0),    // ` ~
        "Minus" => Some(0xBD),
        "Equal" => Some(0xBB),
        "BracketLeft" => Some(0xDB),
        "BracketRight" => Some(0xDD),
        "Backslash" => Some(0xDC),
        "Semicolon" => Some(0xBA),
        "Quote" => Some(0xDE),
        "Comma" => Some(0xBC),
        "Period" => Some(0xBE),
        "Slash" => Some(0xBF),
        "Insert" => Some(0x2D),
        "Delete" => Some(0x2E),
        "Home" => Some(0x24),
        "End" => Some(0x23),
        "PageUp" => Some(0x21),
        "PageDown" => Some(0x22),
        "ArrowUp" => Some(0x26),
        "ArrowDown" => Some(0x28),
        "ArrowLeft" => Some(0x25),
        "ArrowRight" => Some(0x27),
        "NumpadMultiply" => Some(0x6A),
        "NumpadAdd" => Some(0x6B),
        "NumpadSubtract" => Some(0x6D),
        "NumpadDecimal" => Some(0x6E),
        "NumpadDivide" => Some(0x6F),
        "Numpad0" => Some(0x60),
        "Numpad1" => Some(0x61),
        "Numpad2" => Some(0x62),
        "Numpad3" => Some(0x63),
        "Numpad4" => Some(0x64),
        "Numpad5" => Some(0x65),
        "Numpad6" => Some(0x66),
        "Numpad7" => Some(0x67),
        "Numpad8" => Some(0x68),
        "Numpad9" => Some(0x69),
        "NumLock" => Some(0x90),
        "ScrollLock" => Some(0x91),
        _ => None,
    }
}

/// Convert a "Mouse0".."Mouse4" code to our internal mouse button id (1-5).
fn code_to_mouse(code: &str) -> Option<u32> {
    match code {
        "Mouse0" => Some(1), // left
        "Mouse1" => Some(2), // middle
        "Mouse2" => Some(3), // right
        "Mouse3" => Some(4), // X1 (back / thumb)
        "Mouse4" => Some(5), // X2 (forward / thumb)
        _ => None,
    }
}

fn emit(event: &str) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(event, ());
    }
}

// ── Keyboard hook ───────────────────────────────────────────────────────────

unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let kb = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let target = TARGET_VK.load(Ordering::Relaxed);

        if target != 0 && kb.vkCode == target {
            let msg = wparam.0 as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                if !IS_PRESSED.swap(true, Ordering::Relaxed) {
                    emit("global-key-down");
                }
            } else if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                IS_PRESSED.store(false, Ordering::Relaxed);
                emit("global-key-up");
            }
        }
    }
    unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
}

// ── Mouse hook ──────────────────────────────────────────────────────────────

/// Map a WM_*BUTTON* message to our internal mouse button id, and whether it's a down event.
/// Returns (button_id, is_down).
fn classify_mouse_msg(msg: u32, mouse_data: u32) -> Option<(u32, bool)> {
    match msg {
        WM_LBUTTONDOWN => Some((1, true)),
        WM_LBUTTONUP   => Some((1, false)),
        WM_MBUTTONDOWN => Some((2, true)),
        WM_MBUTTONUP   => Some((2, false)),
        WM_RBUTTONDOWN => Some((3, true)),
        WM_RBUTTONUP   => Some((3, false)),
        WM_XBUTTONDOWN => {
            let xbutton = (mouse_data >> 16) & 0xFFFF;
            if xbutton == 1 { Some((4, true)) } else if xbutton == 2 { Some((5, true)) } else { None }
        }
        WM_XBUTTONUP => {
            let xbutton = (mouse_data >> 16) & 0xFFFF;
            if xbutton == 1 { Some((4, false)) } else if xbutton == 2 { Some((5, false)) } else { None }
        }
        _ => None,
    }
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let target = TARGET_MOUSE.load(Ordering::Relaxed);
        if target != 0 {
            let ms = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            if let Some((btn, is_down)) = classify_mouse_msg(wparam.0 as u32, ms.mouseData) {
                if btn == target {
                    if is_down {
                        if !IS_PRESSED.swap(true, Ordering::Relaxed) {
                            emit("global-key-down");
                        }
                    } else {
                        IS_PRESSED.store(false, Ordering::Relaxed);
                        emit("global-key-up");
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
}

// ── Hook lifecycle ──────────────────────────────────────────────────────────

fn start_hook() {
    // Stop any existing hook first
    stop_hook();

    IS_PRESSED.store(false, Ordering::Relaxed);

    let need_keyboard = TARGET_VK.load(Ordering::Relaxed) != 0;
    let need_mouse = TARGET_MOUSE.load(Ordering::Relaxed) != 0;
    if !need_keyboard && !need_mouse {
        return;
    }

    std::thread::spawn(move || {
        unsafe {
            let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();
            HOOK_THREAD_ID.store(thread_id, Ordering::Relaxed);

            let hmod = GetModuleHandleW(None).unwrap_or_default();

            let kb_hook = if need_keyboard {
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0).ok()
            } else {
                None
            };

            let mouse_hook = if need_mouse {
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0).ok()
            } else {
                None
            };

            // Message pump — required for low-level hooks
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                // We only need the pump running; no dispatch needed
            }

            if let Some(h) = kb_hook { let _ = UnhookWindowsHookEx(h); }
            if let Some(h) = mouse_hook { let _ = UnhookWindowsHookEx(h); }

            HOOK_THREAD_ID.store(0, Ordering::Relaxed);
            TARGET_VK.store(0, Ordering::Relaxed);
            TARGET_MOUSE.store(0, Ordering::Relaxed);
            IS_PRESSED.store(false, Ordering::Relaxed);
        }
    });
}

fn stop_hook() {
    let tid = HOOK_THREAD_ID.load(Ordering::Relaxed);
    if tid != 0 {
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)).ok();
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_global_key_listen(key_code: String) -> Result<(), String> {
    // Determine if this is a keyboard key or mouse button
    if let Some(vk) = code_to_vk(&key_code) {
        TARGET_VK.store(vk, Ordering::Relaxed);
        TARGET_MOUSE.store(0, Ordering::Relaxed);
    } else if let Some(mb) = code_to_mouse(&key_code) {
        TARGET_VK.store(0, Ordering::Relaxed);
        TARGET_MOUSE.store(mb, Ordering::Relaxed);
    } else {
        return Err(format!("Unknown key code: {key_code}"));
    }
    start_hook();
    Ok(())
}

#[tauri::command]
pub fn stop_global_key_listen() {
    stop_hook();
}
