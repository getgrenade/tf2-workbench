//! Native relative input avoids WebView2's unconfigurable pointer-lock banner.
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::Emitter;

#[derive(Default)]
pub struct PlayMouse(Mutex<Option<Capture>>);
struct Capture { id: String, stop: Arc<AtomicBool>, thread: Option<std::thread::JoinHandle<()>> }
impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{ffi::c_void, mem::size_of, ptr::null, time::{Duration, Instant}};
    type Hwnd = *mut c_void;
    #[repr(C)] #[derive(Default, Copy, Clone)] struct Point { x: i32, y: i32 }
    #[repr(C)] struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)] struct Device { page: u16, usage: u16, flags: u32, target: Hwnd }
    #[repr(C)] #[derive(Default)] struct Message { hwnd: Hwnd, id: u32, wp: usize, lp: isize, time: u32, point: Point, private: u32 }
    #[repr(C)] #[derive(Default)] struct Header { kind: u32, size: u32, device: usize, wp: usize }
    #[repr(C)] #[derive(Default)] struct Mouse { flags: u16, pad: u16, buttons: u32, raw_buttons: u32, x: i32, y: i32, extra: u32 }
    #[repr(C)] #[derive(Default)] struct Input { header: Header, mouse: Mouse }
    #[link(name="user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
        fn ClipCursor(rect: *const Rect) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn CreateWindowExW(ex: u32, class: *const u16, name: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32, parent: Hwnd, menu: Hwnd, instance: Hwnd, param: Hwnd) -> Hwnd;
        fn DestroyWindow(hwnd: Hwnd) -> i32;
        fn RegisterRawInputDevices(devices: *const Device, count: u32, size: u32) -> i32;
        fn GetRegisteredRawInputDevices(devices: *mut Device, count: *mut u32, size: u32) -> u32;
        fn PeekMessageW(msg: *mut Message, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
        fn DispatchMessageW(msg: *const Message) -> isize;
        fn GetRawInputData(handle: Hwnd, command: u32, data: *mut c_void, size: *mut u32, header: u32) -> u32;
    }

    pub fn start(window: tauri::WebviewWindow, x: f64, y: f64, id: String) -> Result<Capture, String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let mut center = Point { x: (x * scale) as i32, y: (y * scale) as i32 };
        let mut saved = Point::default();
        unsafe {
            if GetForegroundWindow() as usize != hwnd || GetCursorPos(&mut saved) == 0 || ClientToScreen(hwnd as Hwnd, &mut center) == 0 {
                return Err("The viewer must be focused to capture the mouse".into());
            }
        }
        let stop = Arc::new(AtomicBool::new(false));
        let running = stop.clone();
        let capture_id = id.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || unsafe {
            // A thread-owned message-only window receives raw motion even with a stationary cursor.
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let sink = CreateWindowExW(0, class.as_ptr(), null(), 0, 0, 0, 0, 0, -3isize as Hwnd, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
            let mut count = 0;
            GetRegisteredRawInputDevices(std::ptr::null_mut(), &mut count, size_of::<Device>() as u32);
            let mut devices: Vec<Device> = (0..count).map(|_| Device { page: 0, usage: 0, flags: 0, target: std::ptr::null_mut() }).collect();
            let previous = if count > 0 && GetRegisteredRawInputDevices(devices.as_mut_ptr(), &mut count, size_of::<Device>() as u32) != u32::MAX {
                devices.into_iter().find(|d| d.page == 1 && d.usage == 2)
            } else { None };
            let device = Device { page: 1, usage: 2, flags: 0x100, target: sink }; // RIDEV_INPUTSINK
            if sink.is_null() || RegisterRawInputDevices(&device, 1, size_of::<Device>() as u32) == 0 {
                if !sink.is_null() { DestroyWindow(sink); }
                let _ = ready_tx.send(Err("Could not register native mouse input".to_string()));
                return;
            }
            let rect = Rect { left: center.x, top: center.y, right: center.x + 1, bottom: center.y + 1 };
            let locked = SetCursorPos(center.x, center.y) != 0 && ClipCursor(&rect) != 0;
            let _ = ready_tx.send(if locked { Ok(()) } else { Err("Could not lock the cursor".into()) });
            let mut delta = [0i32; 2];
            let mut sent = Instant::now();
            while locked && !running.load(Ordering::Acquire) {
                if GetForegroundWindow() as usize != hwnd || GetAsyncKeyState(0x1b) < 0 { break; }
                let mut msg = Message::default();
                while PeekMessageW(&mut msg, sink, 0, 0, 1) != 0 {
                    if msg.id == 0xff { // WM_INPUT
                        let mut input = Input::default();
                        let mut bytes = size_of::<Input>() as u32;
                        let read = GetRawInputData(msg.lp as Hwnd, 0x10000003, &mut input as *mut _ as *mut c_void, &mut bytes, size_of::<Header>() as u32);
                        if read == size_of::<Input>() as u32 && input.header.kind == 0 {
                            if input.mouse.flags & 1 == 0 {
                                delta[0] = delta[0].saturating_add(input.mouse.x);
                                delta[1] = delta[1].saturating_add(input.mouse.y);
                            }
                            if input.mouse.buttons & 0x400 != 0 { // RI_MOUSE_WHEEL, signed WHEEL_DELTA units
                                let wheel = (input.mouse.buttons >> 16) as u16 as i16;
                                let _ = window.emit("play-mouse-wheel", (&id, wheel));
                            }
                            let buttons = input.mouse.buttons & 0xf; // left/right down/up
                            if buttons != 0 { let _ = window.emit("play-mouse-buttons", (&id, buttons)); }
                        }
                    }
                    DispatchMessageW(&msg);
                }
                if sent.elapsed() >= Duration::from_millis(8) {
                    if delta != [0, 0] { let _ = window.emit("play-mouse-motion", (&id, delta)); delta = [0, 0]; }
                    sent = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            ClipCursor(null());
            SetCursorPos(saved.x, saved.y);
            let remove = Device { page: 1, usage: 2, flags: 1, target: std::ptr::null_mut() };
            RegisterRawInputDevices(previous.as_ref().unwrap_or(&remove), 1, size_of::<Device>() as u32);
            DestroyWindow(sink);
            let _ = window.emit("play-mouse-released", &id);
        });
        let capture = Capture { id: capture_id, stop, thread: Some(thread) };
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(capture)
    }
}

#[tauri::command]
pub fn play_mouse_start(window: tauri::WebviewWindow, state: tauri::State<PlayMouse>, x: f64, y: f64, id: String) -> Result<(), String> {
    let mut capture = state.0.lock().map_err(|e| e.to_string())?;
    capture.take();
    #[cfg(windows)] { *capture = Some(win::start(window, x, y, id)?); Ok(()) }
    #[cfg(not(windows))] { let _ = (window, x, y, id); Err("Native play input requires Windows".into()) }
}

#[tauri::command]
pub fn play_mouse_stop(state: tauri::State<PlayMouse>, id: String) {
    if let Ok(mut capture) = state.0.lock() {
        if capture.as_ref().is_some_and(|c| c.id == id) { capture.take(); }
    }
}
