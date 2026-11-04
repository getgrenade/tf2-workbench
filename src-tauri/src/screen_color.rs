//! A colour picked from anywhere on the screen: WebView2's eyedropper (the EyeDropper API, and the one in the colour popup) cancels at once.
//! While it waits, a small window beside the cursor shows the colour under it and its hex (as PowerToys' Color Picker does).

/// Waits for a left click anywhere on the screen and returns the colour under the cursor; Escape (or a minute without a click) gives none.
#[tauri::command]
pub async fn pick_screen_color() -> Result<Option<[u8; 3]>, String> {
    tauri::async_runtime::spawn_blocking(win::pick).await.map_err(|e| e.to_string())
}

#[cfg(windows)]
mod win {
    use std::{ffi::c_void, ptr::null_mut, time::{Duration, Instant}};
    type Handle = *mut c_void;
    #[repr(C)] #[derive(Default, Copy, Clone, PartialEq)] struct Point { x: i32, y: i32 }
    #[repr(C)] #[derive(Default, Copy, Clone)] struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)] #[derive(Default)] struct MonitorInfo { size: u32, monitor: Rect, work: Rect, flags: u32 }
    #[repr(C)] struct Message { hwnd: Handle, id: u32, wp: usize, lp: isize, time: u32, point: Point, private: u32 }
    #[repr(C)] struct WndClass {
        style: u32, proc_: unsafe extern "system" fn(Handle, u32, usize, isize) -> isize, cls_extra: i32, wnd_extra: i32,
        instance: Handle, icon: Handle, cursor: Handle, background: Handle, menu: *const u16, name: *const u16,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetDC(hwnd: Handle) -> Handle;
        fn ReleaseDC(hwnd: Handle, dc: Handle) -> i32;
        fn DefWindowProcW(hwnd: Handle, msg: u32, wp: usize, lp: isize) -> isize;
        fn RegisterClassW(class: *const WndClass) -> u16;
        fn CreateWindowExW(ex: u32, class: *const u16, name: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32, parent: Handle, menu: Handle, instance: Handle, param: Handle) -> Handle;
        fn DestroyWindow(hwnd: Handle) -> i32;
        fn SetWindowPos(hwnd: Handle, after: Handle, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
        fn SetWindowRgn(hwnd: Handle, region: Handle, redraw: i32) -> i32;
        fn PeekMessageW(msg: *mut Message, hwnd: Handle, min: u32, max: u32, remove: u32) -> i32;
        fn DispatchMessageW(msg: *const Message) -> isize;
        fn FillRect(dc: Handle, rect: *const Rect, brush: Handle) -> i32;
        fn FillRgn(dc: Handle, region: Handle, brush: Handle) -> i32;
        fn FrameRgn(dc: Handle, region: Handle, brush: Handle, w: i32, h: i32) -> i32;
        fn BeginPaint(hwnd: Handle, paint: *mut [u8; 72]) -> Handle;
        fn EndPaint(hwnd: Handle, paint: *const [u8; 72]) -> i32;
        fn InvalidateRect(hwnd: Handle, rect: *const Rect, erase: i32) -> i32;
        fn UpdateWindow(hwnd: Handle) -> i32;
        fn DrawTextW(dc: Handle, text: *const u16, len: i32, rect: *mut Rect, format: u32) -> i32;
        fn MonitorFromPoint(point: Point, flags: u32) -> Handle;
        fn GetMonitorInfoW(monitor: Handle, info: *mut MonitorInfo) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn GetPixel(dc: Handle, x: i32, y: i32) -> u32;
        fn CreateSolidBrush(color: u32) -> Handle;
        fn CreateRoundRectRgn(l: i32, t: i32, r: i32, b: i32, w: i32, h: i32) -> Handle;
        fn CreateFontW(h: i32, w: i32, esc: i32, orient: i32, weight: i32, italic: u32, under: u32, strike: u32, charset: u32, out: u32, clip: u32, quality: u32, pitch: u32, face: *const u16) -> Handle;
        fn SelectObject(dc: Handle, object: Handle) -> Handle;
        fn DeleteObject(object: Handle) -> i32;
        fn SetTextColor(dc: Handle, color: u32) -> u32;
        fn SetBkMode(dc: Handle, mode: i32) -> i32;
    }
    #[link(name = "shcore")]
    extern "system" { fn GetDpiForMonitor(monitor: Handle, kind: u32, x: *mut u32, y: *mut u32) -> i32; }
    #[link(name = "kernel32")]
    extern "system" { fn GetModuleHandleW(name: *const u16) -> Handle; }

    const LBUTTON: i32 = 0x01;
    const ESCAPE: i32 = 0x1B;
    const CLR_INVALID: u32 = 0xFFFF_FFFF;
    const BACKGROUND: u32 = 0x002B2B2B; // COLORREF: 0x00bbggrr
    const BORDER: u32 = 0x00555555;

    const WM_PAINT: u32 = 0x000F;
    const WM_ERASEBKGND: u32 = 0x0014;

    /// What the window shows (it is painted from this on WM_PAINT, on the picking thread that owns it).
    #[derive(Clone, Copy)]
    struct Shown { color: u32, font: Handle, scale: f64, size: (i32, i32) }
    thread_local!(static SHOWN: std::cell::Cell<Option<Shown>> = const { std::cell::Cell::new(None) });

    unsafe extern "system" fn proc_(hwnd: Handle, msg: u32, wp: usize, lp: isize) -> isize {
        match msg {
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                let mut ps = [0u8; 72];
                let dc = BeginPaint(hwnd, &mut ps);
                if let Some(shown) = SHOWN.with(|s| s.get()) { paint(dc, shown); }
                EndPaint(hwnd, &ps);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }

    unsafe fn paint(dc: Handle, Shown { color, font, scale, size: (w, h) }: Shown) {
        let px = |v: f64| (v * scale).round() as i32;
        let back = CreateSolidBrush(BACKGROUND);
        FillRect(dc, &Rect { left: 0, top: 0, right: w, bottom: h }, back);
        DeleteObject(back);
        let pad = px(6.0);
        let swatch = CreateRoundRectRgn(pad, pad, h - pad, h - pad, px(6.0), px(6.0));
        let fill = CreateSolidBrush(color);
        FillRgn(dc, swatch, fill);
        let border = CreateSolidBrush(BORDER);
        FrameRgn(dc, swatch, border, 1, 1);
        DeleteObject(fill); DeleteObject(border); DeleteObject(swatch);
        let (r, g, b) = (color & 0xFF, (color >> 8) & 0xFF, (color >> 16) & 0xFF);
        let text = format!("{r:02x}{g:02x}{b:02x}").encode_utf16().collect::<Vec<u16>>();
        let old = SelectObject(dc, font);
        SetBkMode(dc, 1);
        SetTextColor(dc, 0x00FFFFFF);
        let mut area = Rect { left: h, top: 0, right: w - pad, bottom: h };
        DrawTextW(dc, text.as_ptr(), text.len() as i32, &mut area, 0x0001 | 0x0004 | 0x0020); // centred, one line
        SelectObject(dc, old);
    }

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }

    /// The window beside the cursor: no frame, no taskbar button, never focused, and clicks go through it.
    struct Loupe { hwnd: Handle, font: Handle, scale: f64, size: (i32, i32), shown: Option<(Point, u32)> }
    impl Loupe {
        unsafe fn new() -> Option<Loupe> {
            let class = wide("TF2WorkbenchColorLoupe");
            let instance = GetModuleHandleW(null_mut());
            // (registering a second time fails harmlessly: the class is there from the first pick)
            RegisterClassW(&WndClass { style: 0, proc_, cls_extra: 0, wnd_extra: 0, instance, icon: null_mut(), cursor: null_mut(), background: null_mut(), menu: null_mut(), name: class.as_ptr() });
            const EX: u32 = 0x8 | 0x20 | 0x80 | 0x0800_0000; // topmost | transparent | tool window | no activate
            let hwnd = CreateWindowExW(EX, class.as_ptr(), null_mut(), 0x8000_0000, 0, 0, 1, 1, null_mut(), null_mut(), instance, null_mut());
            if hwnd.is_null() { return None; }
            Some(Loupe { hwnd, font: null_mut(), scale: 0.0, size: (0, 0), shown: None })
        }

        unsafe fn show(&mut self, cursor: Point, color: u32) {
            if self.shown == Some((cursor, color)) { return; }
            self.shown = Some((cursor, color));
            let monitor = MonitorFromPoint(cursor, 2);
            let mut info = MonitorInfo { size: std::mem::size_of::<MonitorInfo>() as u32, ..Default::default() };
            GetMonitorInfoW(monitor, &mut info);
            let (mut dpi, mut unused) = (96u32, 0u32);
            GetDpiForMonitor(monitor, 0, &mut dpi, &mut unused);
            let scale = dpi as f64 / 96.0;
            let px = |v: f64| (v * scale).round() as i32;
            let (w, h) = (px(112.0), px(36.0));
            if scale != self.scale {
                self.scale = scale;
                if !self.font.is_null() { DeleteObject(self.font); }
                self.font = CreateFontW(-px(14.0), 0, 0, 0, 600, 0, 0, 0, 0, 0, 0, 5, 0, wide("Segoe UI").as_ptr());
            }
            if (w, h) != self.size {
                self.size = (w, h);
                SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, w + 1, h + 1, px(10.0), px(10.0)), 1);
            }
            // below right of the cursor, on the other side where the screen ends
            let gap = px(18.0);
            let mut x = cursor.x + gap;
            let mut y = cursor.y + gap;
            if x + w > info.monitor.right { x = cursor.x - gap - w; }
            if y + h > info.monitor.bottom { y = cursor.y - gap - h; }
            SetWindowPos(self.hwnd, -1isize as Handle, x, y, w, h, 0x0010 | 0x0040); // topmost, no activate, show

            SHOWN.with(|s| s.set(Some(Shown { color, font: self.font, scale, size: (w, h) })));
            InvalidateRect(self.hwnd, null_mut(), 0);
            UpdateWindow(self.hwnd);
        }

        unsafe fn pump(&self) {
            let mut msg: Message = std::mem::zeroed();
            while PeekMessageW(&mut msg, null_mut(), 0, 0, 1) != 0 { DispatchMessageW(&msg); }
        }
    }
    impl Drop for Loupe {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.hwnd);
                SHOWN.with(|s| s.set(None));
                if !self.font.is_null() { DeleteObject(self.font); }
            }
        }
    }

    unsafe fn under(cursor: Point) -> u32 {
        let dc = GetDC(null_mut());
        let c = GetPixel(dc, cursor.x, cursor.y);
        ReleaseDC(null_mut(), dc);
        c
    }

    pub fn pick() -> Option<[u8; 3]> {
        let down = |key: i32| unsafe { GetAsyncKeyState(key) as u16 & 0x8000 != 0 };
        let start = Instant::now();
        // the click that started the pick is let go first
        while down(LBUTTON) && start.elapsed() < Duration::from_secs(5) { std::thread::sleep(Duration::from_millis(5)); }
        unsafe {
            let mut loupe = Loupe::new();
            while start.elapsed() < Duration::from_secs(60) {
                if down(ESCAPE) { return None; }
                let mut p = Point::default();
                if GetCursorPos(&mut p) == 0 { return None; }
                let c = under(p);
                if down(LBUTTON) {
                    // CLR_INVALID: off every screen
                    return if c == CLR_INVALID { None } else { Some([c as u8, (c >> 8) as u8, (c >> 16) as u8]) };
                }
                if let Some(l) = loupe.as_mut() {
                    if c != CLR_INVALID { l.show(p, c); }
                    l.pump();
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        None
    }
}

#[cfg(not(windows))]
mod win { pub fn pick() -> Option<[u8; 3]> { None } }
