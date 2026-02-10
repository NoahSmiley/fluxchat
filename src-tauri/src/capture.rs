#[cfg(windows)]
mod platform {
    use base64::Engine;
    use serde::Serialize;
    use std::io::Cursor;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    const THUMB_WIDTH: u32 = 320;
    const THUMB_HEIGHT: u32 = 180;

    // Raw FFI — the `windows` crate has trait conflicts that prevent using wrappers directly.
    #[link(name = "user32")]
    extern "system" {
        fn PrintWindow(hwnd: isize, hdcblt: isize, nflags: u32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn GdiFlush() -> i32;
    }

    #[derive(Serialize, Clone)]
    pub struct CaptureSource {
        pub id: String,
        pub name: String,
        pub thumbnail: String,
        pub source_type: String,
    }

    pub fn get_sources() -> Vec<CaptureSource> {
        MONITOR_INDEX.store(0, std::sync::atomic::Ordering::Relaxed);
        let mut sources = Vec::new();
        enumerate_monitors(&mut sources);
        enumerate_windows(&mut sources);
        sources
    }

    fn enumerate_monitors(sources: &mut Vec<CaptureSource>) {
        unsafe {
            let ctx = sources as *mut Vec<CaptureSource>;
            let _ = EnumDisplayMonitors(
                HDC::default(),
                None,
                Some(monitor_enum_proc),
                LPARAM(ctx as isize),
            );
        }
    }

    static MONITOR_INDEX: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let sources = &mut *(lparam.0 as *mut Vec<CaptureSource>);
        let index = MONITOR_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(hmonitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
            let name = format!("Screen {}", index + 1);
            let rect = info.monitorInfo.rcMonitor;
            let thumbnail = capture_screen_region(rect);

            sources.push(CaptureSource {
                id: format!("screen:{}", index),
                name,
                thumbnail,
                source_type: "screen".into(),
            });
        }

        BOOL(1)
    }

    /// Helper: build a BITMAPINFO for THUMB_WIDTH x THUMB_HEIGHT, 32-bit top-down DIB.
    fn thumb_bitmapinfo() -> BITMAPINFO {
        BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: THUMB_WIDTH as i32,
                biHeight: -(THUMB_HEIGHT as i32), // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            },
            ..Default::default()
        }
    }

    /// Encode raw BGRA pixels (from a DIB section) into a data:image/png;base64,… string.
    fn encode_bgra_as_png(ptr: *const u8, width: u32, height: u32) -> String {
        let size = (width * height * 4) as usize;
        let mut pixels = unsafe { std::slice::from_raw_parts(ptr, size) }.to_vec();

        // BGRA → RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let img = image::RgbaImage::from_raw(width, height, pixels)
            .unwrap_or_else(|| image::RgbaImage::new(width, height));
        let mut png_buf = Cursor::new(Vec::new());
        let encoder = image::codecs::png::PngEncoder::new_with_quality(
            &mut png_buf,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Sub,
        );
        if image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .is_err()
        {
            return String::new();
        }

        let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
        format!("data:image/png;base64,{}", b64)
    }

    fn capture_screen_region(rect: RECT) -> String {
        unsafe {
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width <= 0 || height <= 0 {
                return String::new();
            }

            let hdc_screen = GetDC(HWND::default());
            let hdc_mem = CreateCompatibleDC(hdc_screen);

            // Use a DIB section so pixels are directly accessible (no GetDIBits needed).
            let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            let bmi = thumb_bitmapinfo();
            let hbitmap = CreateDIBSection(
                hdc_mem,
                &bmi,
                DIB_RGB_COLORS,
                &mut bits_ptr,
                HANDLE::default(),
                0,
            );

            let hbitmap = match hbitmap {
                Ok(bmp) if !bmp.is_invalid() && !bits_ptr.is_null() => bmp,
                _ => {
                    let _ = DeleteDC(hdc_mem);
                    ReleaseDC(HWND::default(), hdc_screen);
                    return String::new();
                }
            };

            let old = SelectObject(hdc_mem, hbitmap);
            let _ = SetStretchBltMode(hdc_mem, HALFTONE);
            let _ = StretchBlt(
                hdc_mem,
                0,
                0,
                THUMB_WIDTH as i32,
                THUMB_HEIGHT as i32,
                hdc_screen,
                rect.left,
                rect.top,
                width,
                height,
                SRCCOPY,
            );

            // Flush GDI pipeline before reading pixel memory directly.
            GdiFlush();

            let thumbnail = encode_bgra_as_png(bits_ptr as *const u8, THUMB_WIDTH, THUMB_HEIGHT);

            SelectObject(hdc_mem, old);
            let _ = DeleteObject(hbitmap);
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(HWND::default(), hdc_screen);

            thumbnail
        }
    }

    fn enumerate_windows(sources: &mut Vec<CaptureSource>) {
        unsafe {
            let ctx = sources as *mut Vec<CaptureSource>;
            let _ = EnumWindows(
                Some(window_enum_proc),
                LPARAM(ctx as isize),
            );
        }
    }

    unsafe extern "system" fn window_enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let sources = &mut *(lparam.0 as *mut Vec<CaptureSource>);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        if IsIconic(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title_buf) as usize;
        if len == 0 {
            return BOOL(1);
        }
        let title = String::from_utf16_lossy(&title_buf[..len]);

        if title.is_empty()
            || title == "Program Manager"
            || title == "Windows Input Experience"
            || title == "MSCTFIME UI"
            || title == "Default IME"
        {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return BOOL(1);
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 1 || h <= 1 {
            return BOOL(1);
        }

        let ex_style = WINDOW_EX_STYLE(GetWindowLongW(hwnd, GWL_EXSTYLE) as u32);
        if ex_style.contains(WS_EX_TOOLWINDOW) {
            return BOOL(1);
        }

        if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
            if !owner.is_invalid() && !ex_style.contains(WS_EX_APPWINDOW) {
                return BOOL(1);
            }
        }

        let thumbnail = capture_window(hwnd, w, h);

        sources.push(CaptureSource {
            id: format!("window:{}", hwnd.0 as usize),
            name: title,
            thumbnail,
            source_type: "window".into(),
        });

        BOOL(1)
    }

    fn capture_window(hwnd: HWND, width: i32, height: i32) -> String {
        unsafe {
            if width <= 0 || height <= 0 {
                return String::new();
            }

            let hdc_screen = GetDC(HWND::default());

            // Full-size DC for PrintWindow to render into
            let hdc_src = CreateCompatibleDC(hdc_screen);
            let hbm_src = CreateCompatibleBitmap(hdc_screen, width, height);
            let old_src = SelectObject(hdc_src, hbm_src);

            // PW_RENDERFULLCONTENT = 2: captures DirectComposition/DWM content
            let pw_ok = PrintWindow(hwnd.0 as isize, hdc_src.0 as isize, 2) != 0;

            // Thumbnail DIB section for direct pixel access
            let hdc_thumb = CreateCompatibleDC(hdc_screen);
            let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            let bmi = thumb_bitmapinfo();
            let hbm_thumb = CreateDIBSection(
                hdc_thumb,
                &bmi,
                DIB_RGB_COLORS,
                &mut bits_ptr,
                HANDLE::default(),
                0,
            );

            let hbm_thumb = match hbm_thumb {
                Ok(bmp) if !bmp.is_invalid() && !bits_ptr.is_null() => bmp,
                _ => {
                    SelectObject(hdc_src, old_src);
                    let _ = DeleteObject(hbm_src);
                    let _ = DeleteDC(hdc_src);
                    let _ = DeleteDC(hdc_thumb);
                    ReleaseDC(HWND::default(), hdc_screen);
                    return String::new();
                }
            };

            let old_thumb = SelectObject(hdc_thumb, hbm_thumb);
            let _ = SetStretchBltMode(hdc_thumb, HALFTONE);

            if pw_ok {
                let _ = StretchBlt(
                    hdc_thumb, 0, 0, THUMB_WIDTH as i32, THUMB_HEIGHT as i32,
                    hdc_src, 0, 0, width, height,
                    SRCCOPY,
                );
            } else {
                // Fallback: BitBlt from screen at window position
                let mut rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut rect);
                let _ = StretchBlt(
                    hdc_thumb, 0, 0, THUMB_WIDTH as i32, THUMB_HEIGHT as i32,
                    hdc_screen, rect.left, rect.top, width, height,
                    SRCCOPY,
                );
            }

            GdiFlush();

            let thumbnail = encode_bgra_as_png(bits_ptr as *const u8, THUMB_WIDTH, THUMB_HEIGHT);

            // Cleanup
            SelectObject(hdc_src, old_src);
            let _ = DeleteObject(hbm_src);
            let _ = DeleteDC(hdc_src);
            SelectObject(hdc_thumb, old_thumb);
            let _ = DeleteObject(hbm_thumb);
            let _ = DeleteDC(hdc_thumb);
            ReleaseDC(HWND::default(), hdc_screen);

            thumbnail
        }
    }
}

#[cfg(windows)]
pub use platform::*;

#[cfg(not(windows))]
mod fallback {
    use serde::Serialize;

    #[derive(Serialize, Clone)]
    pub struct CaptureSource {
        pub id: String,
        pub name: String,
        pub thumbnail: String,
        pub source_type: String,
    }

    pub fn get_sources() -> Vec<CaptureSource> {
        Vec::new()
    }
}

#[cfg(not(windows))]
pub use fallback::*;
