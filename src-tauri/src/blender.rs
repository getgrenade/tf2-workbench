//! Reading a rig from a .blend file: Blender (the user's own copy) is run in the background with a script that writes the rig as JSON
//! (`scripts/rig/export_rig.py`); the JSON is kept, so the same file is read once.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};
use tauri::Manager;

const EXPORT_SCRIPT: &str = include_str!("../../scripts/rig/export_rig.py");

/// The Blender executables found on this machine, newest first.
fn blender_candidates() -> Vec<PathBuf> {
    let mut found: Vec<(Vec<u32>, PathBuf)> = Vec::new();
    let version = |name: &str| -> Vec<u32> { name.split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect() };
    for root in ["C:/Program Files/Blender Foundation", "C:/Program Files (x86)/Blender Foundation"] {
        if let Ok(entries) = std::fs::read_dir(root) {
            for e in entries.flatten() {
                let exe = e.path().join("blender.exe");
                if exe.is_file() { found.push((version(&e.file_name().to_string_lossy()), exe)); }
            }
        }
    }
    for exe in ["C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe", "C:/Program Files/Steam/steamapps/common/Blender/blender.exe"] {
        let p = PathBuf::from(exe);
        if p.is_file() { found.push((vec![0], p)); }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let exe = dir.join(if cfg!(windows) { "blender.exe" } else { "blender" });
            if exe.is_file() { found.push((vec![0], exe)); }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, p)| p).collect()
}

#[tauri::command]
pub fn find_blender() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in blender_candidates() {
        let s = p.to_string_lossy().into_owned();
        if !out.contains(&s) { out.push(s); }
    }
    out
}

fn cache_file(app: &tauri::AppHandle, blend: &Path) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(blend).map_err(|e| format!("{}: {e}", blend.display()))?;
    let stamp = meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let mut h = DefaultHasher::new();
    (blend.to_string_lossy().to_lowercase(), meta.len(), stamp, EXPORT_SCRIPT.len(), EXPORT_SCRIPT).hash(&mut h);
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("rigs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{:016x}.json", h.finish())))
}

/// The rig of a .blend file as JSON text (read again only when the file changed). `blender` is the executable to use (empty: the newest found).
#[tauri::command]
pub async fn export_blend_rig(app: tauri::AppHandle, blend: String, blender: String) -> Result<String, String> {
    let blend_path = PathBuf::from(&blend);
    let cached = cache_file(&app, &blend_path)?;
    if let Ok(text) = std::fs::read_to_string(&cached) {
        if text.starts_with('{') { return Ok(text); }
    }
    let exe = if blender.trim().is_empty() {
        blender_candidates().into_iter().next().ok_or("Blender was not found. Set its path in Settings.")?
    } else {
        PathBuf::from(blender.trim())
    };
    if !exe.is_file() { return Err(format!("{} is not a program", exe.display())); }
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let script = std::env::temp_dir().join("tf2workbench_export_rig.py");
        std::fs::write(&script, EXPORT_SCRIPT).map_err(|e| e.to_string())?;
        let out = cached.with_extension("part");
        let _ = std::fs::remove_file(&out);
        let mut child = Command::new(&exe)
            .arg("--factory-startup").arg("-b").arg(&blend_path).arg("--python").arg(&script).arg("--").arg("auto").arg(&out)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("could not start Blender: {e}"))?;
        let started = Instant::now();
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? { break s; }
            if started.elapsed() > Duration::from_secs(240) { let _ = child.kill(); return Err("Blender took too long to read the file".into()); }
            std::thread::sleep(Duration::from_millis(100));
        };
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !status.success() || !out.is_file() {
            if stdout.contains("NO_TF2_SKELETON") { return Err("No armature with the game's skeleton (the bip_ bones) is in that file.".into()); }
            let tail: String = String::from_utf8_lossy(&output.stderr).lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ");
            return Err(format!("Blender could not read the rig ({}). {}", status, tail));
        }
        std::fs::rename(&out, &cached).map_err(|e| e.to_string())?;
        std::fs::read_to_string(&cached).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
