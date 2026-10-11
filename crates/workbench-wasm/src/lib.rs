//! The backend in a web page. The page's worker owns the module; this is the whole surface between them:
//!
//! * `alloc` / `dealloc`: memory the worker writes its arguments into.
//! * `init(index)`: the list of the files that exist (one path per line); files are then fetched on demand through the import `host_fetch`.
//! * `call(command, args)`: runs one command of the desktop app (see `workbench_core::dispatch::call`). It returns 0 when the answer is JSON,
//!   1 when it is bytes and -1 for an error (the message); the answer is then read with `result_ptr` / `result_len`.
//!
//! The worker's `host_fetch(path)` returns the size of the file (or -1) and `host_take(destination)` then copies its bytes in.
use std::{cell::RefCell, sync::Arc};

use workbench_core::{dispatch, state::AppState};
use source_formats::VpkSet;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_fetch(path: *const u8, len: usize) -> i32;
    fn host_take(destination: *mut u8);
}

thread_local! {
    static STATE: RefCell<Option<AppState>> = const { RefCell::new(None) };
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(size.max(1));
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    drop(Vec::from_raw_parts(ptr, 0, size.max(1)));
}

fn slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

#[no_mangle]
pub extern "C" fn init(index: *const u8, len: usize) {
    let text = String::from_utf8_lossy(slice(index, len)).into_owned();
    let paths: Vec<String> = text.lines().filter(|l| !l.is_empty()).map(str::to_owned).collect();
    let read: source_formats::vpk::RemoteRead = Arc::new(|path: &str| {
        let size = unsafe { host_fetch(path.as_ptr(), path.len()) };
        if size < 0 {
            return None;
        }
        let mut bytes = vec![0u8; size as usize];
        unsafe { host_take(bytes.as_mut_ptr()) };
        Some(bytes)
    });
    let state = AppState::default();
    state.set_vpk(VpkSet::remote(paths, read));
    STATE.with(|s| *s.borrow_mut() = Some(state));
}

fn finish(bytes: Vec<u8>, status: i32) -> i32 {
    RESULT.with(|r| *r.borrow_mut() = bytes);
    status
}

#[no_mangle]
pub extern "C" fn call(command: *const u8, command_len: usize, args: *const u8, args_len: usize) -> i32 {
    let command = String::from_utf8_lossy(slice(command, command_len)).into_owned();
    let args: serde_json::Value = serde_json::from_slice(slice(args, args_len)).unwrap_or(serde_json::Value::Null);
    let answer = STATE.with(|s| match s.borrow().as_ref() {
        Some(state) => dispatch::call(state, &command, &args),
        None => Err("the backend is not initialised".to_owned()),
    });
    match answer {
        Ok(dispatch::Reply::Bytes(b)) => finish(b, 1),
        Ok(dispatch::Reply::Json(v)) => finish(serde_json::to_vec(&v).unwrap_or_default(), 0),
        Err(e) => finish(e.into_bytes(), -1),
    }
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}
