//! Valve's particle globals live in a child process, never inside the viewer.
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;

#[derive(Clone, Deserialize, Serialize)]
pub struct NativeNode {
    id: usize,
    name: String,
    capacity: usize,
    time: f64,
    dt: f64,
    particles: Vec<[f64; 17]>,
}

#[derive(Serialize)]
pub struct NativeStart {
    handle: u64,
    nodes: Vec<NativeNode>,
}

/// What a helper sends back: the first frames (and the ones of tests) as parsed JSON, the steps of the viewer as the helper's own bytes.
enum Frame { Json(Vec<NativeNode>), Binary(Vec<u8>) }

struct Helper {
    /// The floor of the viewer (z in the space of the control points) that the helper's world traces hit, if there is one.
    floor: Option<f64>,
    child: Child,
    input: ChildStdin,
    frames: mpsc::Receiver<Result<Frame, String>>,
}

impl Drop for Helper {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}

impl Helper {
    #[cfg(test)]
    fn start(executable: &Path, game: &Path, file: &str, system: &str) -> Result<Self, String> {
        Self::start_with_refire(executable, game, file, system, 0.0)
    }
    #[cfg(test)]
    fn start_with_refire(executable: &Path, game: &Path, file: &str, system: &str, refire: f64) -> Result<Self, String> {
        Self::start_slots(executable, game, file, system, refire, 1)
    }
    fn start_slots(executable: &Path, game: &Path, file: &str, system: &str, refire: f64, slots: u32) -> Result<Self, String> {
        Self::start_extra(executable, game, None, file, system, refire, slots)
    }
    /// `extra` is a folder with more of the game's tree (the unpacked files of a custom effect), searched after the game's own files.
    fn start_extra(executable: &Path, game: &Path, extra: Option<&Path>, file: &str, system: &str, refire: f64, slots: u32) -> Result<Self, String> {
        Self::start_seeded(executable, game, extra, file, system, refire, slots, 273)
    }
    /// `seed` is the collections' random seed: the same seed, control points and ticks give the same particles every time.
    fn start_seeded(executable: &Path, game: &Path, extra: Option<&Path>, file: &str, system: &str, refire: f64, slots: u32, seed: u32) -> Result<Self, String> {
        if !(1..=32).contains(&slots) {return Err("Invalid particle slot count".into());}
        if !refire.is_finite() || refire < 0.0 || refire > 600.0 { return Err("Invalid particle refire interval".into()); }
        if !file.starts_with("particles/") || !file.ends_with(".pcf") || file.contains("..")
            || system.is_empty() || system.len() > 256 || system.contains(['\n', '\r', '"']) {
            return Err("Invalid particle definition request".into());
        }
        let bin = game.parent().ok_or("Invalid TF2 folder")?.join("bin/x64");
        let mut paths = vec![bin];
        if let Some(path) = std::env::var_os("PATH") { paths.extend(std::env::split_paths(&path)); }
        let mut command = Command::new(executable);
        command.args([file, system, "-stdio", "-slots", &slots.to_string(), "-refire", &refire.to_string(), "-seed", &(seed & 0x7fff_ffff).to_string(), "-game"])
            .arg(game);
        if let Some(extra) = extra { command.arg("-extra").arg(extra); }
        command.env("PATH", std::env::join_paths(paths).map_err(|e| e.to_string())?)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e| format!("Cannot start native particles: {e}"))?;
        let input = child.stdin.take().ok_or("No native input pipe")?;
        let output = child.stdout.take().ok_or("No native output pipe")?;
        let (sender, frames) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            // how many particles each collection may have (from the first frame): the bound of the binary frames
            let mut capacities: Vec<usize> = Vec::new();
            loop {
                let mut line = String::new();
                // Bound an engine/helper bug before it can exhaust the viewer's memory.
                match reader.by_ref().take(8 * 1024 * 1024).read_line(&mut line) {
                    Ok(0) => { let _ = sender.send(Err("Native particle helper exited".into())); break; }
                    Ok(_) if !line.ends_with('\n') => { let _ = sender.send(Err("Native particle frame is too large".into())); break; }
                    Ok(_) => if let Some(json) = line.strip_prefix("FRAME ") {
                        let parsed = serde_json::from_str::<Vec<NativeNode>>(json).map_err(|e| e.to_string())
                            .and_then(validate_frame);
                        if let Ok(nodes) = &parsed { capacities = nodes.iter().map(|n| n.capacity).collect(); }
                        if sender.send(parsed.map(Frame::Json)).is_err() { break; }
                    } else if let Some(size) = line.strip_prefix("BIN ") {
                        let size = size.trim().parse::<usize>().unwrap_or(usize::MAX);
                        if size > 16 * 1024 * 1024 { let _ = sender.send(Err("Native particle frame is too large".into())); break; }
                        let mut bytes = vec![0u8; size];
                        if reader.read_exact(&mut bytes).is_err() { let _ = sender.send(Err("Native particle helper exited".into())); break; }
                        if sender.send(validate_binary(&bytes, &capacities).map(|_| Frame::Binary(bytes))).is_err() { break; }
                    },
                    Err(e) => { let _ = sender.send(Err(e.to_string())); break; }
                }
            }
        });
        Ok(Self { floor: None, child, input, frames })
    }

    fn frame(&self, timeout: Duration) -> Result<Vec<NativeNode>, String> {
        match self.frames.recv_timeout(timeout).map_err(|_| "Native particle helper stopped responding".to_string())?? {
            Frame::Json(nodes) => Ok(nodes),
            Frame::Binary(_) => Err("Unexpected binary frame".into()),
        }
    }
    fn frame_binary(&self, timeout: Duration) -> Result<Vec<u8>, String> {
        match self.frames.recv_timeout(timeout).map_err(|_| "Native particle helper stopped responding".to_string())?? {
            Frame::Binary(bytes) => Ok(bytes),
            Frame::Json(_) => Err("Unexpected text frame".into()),
        }
    }

    fn step(&mut self, ticks: u32, cp: &[f64; 12], boxes: &[[f64; 18]]) -> Result<Vec<NativeNode>, String> {
        self.step_emission(ticks, cp, boxes, 0)
    }

    fn step_emission(&mut self, ticks: u32, cp: &[f64; 12], boxes: &[[f64; 18]], action: u32) -> Result<Vec<NativeNode>, String> {
        self.step_flame(ticks, cp, boxes, action, &[])
    }
    fn step_flame(&mut self, ticks: u32, cp: &[f64; 12], boxes: &[[f64; 18]], action: u32, flame: &[f64]) -> Result<Vec<NativeNode>, String> {
        self.step_colors(ticks, cp, boxes, action, flame, &[])
    }
    fn step_colors(&mut self, ticks: u32, cp: &[f64; 12], boxes: &[[f64; 18]], action: u32, flame: &[f64], colors: &[f64]) -> Result<Vec<NativeNode>, String> {
        self.step_instances(ticks, cp, boxes, action, flame, colors, &[])
    }
    fn step_instances(&mut self, ticks: u32, cp: &[f64; 12], boxes: &[[f64; 18]], action: u32, flame: &[f64], colors: &[f64], instances: &[Vec<f64>]) -> Result<Vec<NativeNode>, String> {
        self.step_target(ticks,cp,boxes,action,flame,colors,instances,&[])
    }
    fn step_target(&mut self,ticks:u32,cp:&[f64;12],boxes:&[[f64;18]],action:u32,flame:&[f64],colors:&[f64],instances:&[Vec<f64>],target:&[f64])->Result<Vec<NativeNode>,String> {
        self.send_step(ticks,cp,boxes,action,flame,colors,instances,target,false)?;
        self.frame(Duration::from_secs(3))
    }
    /// The same step, answered with the helper's binary frame (see `validate_binary`).
    fn step_target_binary(&mut self,ticks:u32,cp:&[f64;12],boxes:&[[f64;18]],action:u32,flame:&[f64],colors:&[f64],instances:&[Vec<f64>],target:&[f64])->Result<Vec<u8>,String> {
        self.send_step(ticks,cp,boxes,action,flame,colors,instances,target,true)?;
        self.frame_binary(Duration::from_secs(3))
    }
    fn send_step(&mut self,ticks:u32,cp:&[f64;12],boxes:&[[f64;18]],action:u32,flame:&[f64],colors:&[f64],instances:&[Vec<f64>],target:&[f64],binary:bool)->Result<(),String> {
        if (!target.is_empty() && target.len()!=3) || target.iter().any(|v|!v.is_finite()) {return Err("Invalid beam target".into());}
        if instances.len()>32 || instances.iter().any(|row| row.len()!=13 || row.iter().any(|v| !v.is_finite()) || ![0.,1.,2.,3.].contains(&row[12])) {return Err("Invalid projectile particle instances".into());}
        if (!colors.is_empty() && colors.len()!=6) || colors.iter().any(|v| !v.is_finite() || *v<0. || *v>1.) { return Err("Invalid particle colors".into()); }
        if (!flame.is_empty() && flame.len()!=10) || flame.iter().any(|v|!v.is_finite() || v.abs()>100000.) {return Err("Invalid flame manager settings".into());}
        if action > 3 { return Err("Invalid emission command".into()); }
        if ticks > 6 || cp.iter().any(|x| !x.is_finite()) || boxes.len() > 128
            || boxes.iter().flatten().any(|x| !x.is_finite()) { return Err("Invalid native particle step".into()); }
        let mut line = ticks.to_string();
        for value in cp { line.push(' '); line.push_str(&value.to_string()); }
        line.push(' '); line.push_str(&boxes.len().to_string());
        for value in boxes.iter().flatten() { line.push(' '); line.push_str(&value.to_string()); }
        line.push(' '); line.push_str(&action.to_string());
        line.push(' '); line.push_str(&flame.len().to_string());
        for value in flame {line.push(' ');line.push_str(&value.to_string());}
        line.push(' '); line.push_str(&colors.len().to_string());
        for value in colors {line.push(' ');line.push_str(&value.to_string());}
        line.push(' '); line.push_str(&instances.len().to_string());
        for value in instances.iter().flatten() {line.push(' ');line.push_str(&value.to_string());}
        line.push(' ');line.push_str(&target.len().to_string());for value in target {line.push(' ');line.push_str(&value.to_string());}
        match self.floor { Some(z) if z.is_finite() => {line.push_str(" 1 ");line.push_str(&z.to_string());} _ => line.push_str(" 0") }
        line.push_str(if binary { " 1" } else { " 0" });
        writeln!(self.input, "{line}").and_then(|_| self.input.flush()).map_err(|e| e.to_string())
    }
}

fn validate_frame(nodes: Vec<NativeNode>) -> Result<Vec<NativeNode>, String> {
    if nodes.len() > 1024 || nodes.iter().enumerate().any(|(i, n)| n.id != i || n.capacity > 5000
        || n.particles.len() > n.capacity || !n.time.is_finite() || !n.dt.is_finite() || n.dt < 0.0
        || n.particles.iter().flatten().any(|v| !v.is_finite())) {
        return Err("Invalid native particle frame".into());
    }
    if nodes.iter().flat_map(|n| &n.particles).any(|p| p[11] < 0.0 || p[11] > 65535.0 || p[11].fract() != 0.0) {
        return Err("Invalid sprite sequence from native helper".into());
    }
    Ok(nodes)
}

/// A binary frame is u32 node count, then for every node f64 time, f64 dt, u32 particle count and 17 f32 per particle. It must hold exactly the
/// nodes of the first frame, no more particles than a node's capacity, and finite numbers (and whole sprite sequences), as a text frame must.
fn validate_binary(bytes: &[u8], capacities: &[usize]) -> Result<(), String> {
    let bad = || "Invalid native particle frame".to_string();
    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
    let f64_at = |at: usize| bytes.get(at..at + 8).map(|b| f64::from_le_bytes(b.try_into().unwrap()));
    if u32_at(0).ok_or_else(bad)? as usize != capacities.len() { return Err(bad()); }
    let mut at = 4;
    for capacity in capacities {
        let (time, dt, count) = (f64_at(at).ok_or_else(bad)?, f64_at(at + 8).ok_or_else(bad)?, u32_at(at + 16).ok_or_else(bad)? as usize);
        if !time.is_finite() || !dt.is_finite() || dt < 0.0 || count > *capacity { return Err(bad()); }
        at += 20;
        let end = at + count * 68;
        let particles = bytes.get(at..end).ok_or_else(bad)?;
        for particle in particles.chunks_exact(68) {
            for (i, v) in particle.chunks_exact(4).enumerate() {
                let value = f32::from_le_bytes(v.try_into().unwrap());
                if !value.is_finite() { return Err(bad()); }
                if i == 11 && (value < 0.0 || value > 65535.0 || value.fract() != 0.0) { return Err("Invalid sprite sequence from native helper".into()); }
            }
        }
        at = end;
    }
    if at != bytes.len() { return Err(bad()); }
    Ok(())
}

/// The helpers, each behind a lock of its own: the pool's lock is only held to find or add one, never while a helper works. A helper takes
/// 100 ms or more to start and a few milliseconds to answer a step, and with one lock for all of them every effect in the scene stood still
/// whenever any other one started (and the steps of many characters' effects queued up one behind another).
#[derive(Default)]
struct Pool { next: u64, generation: u64, /** helpers that are being started (they count towards the limit) */ starting: usize, helpers: HashMap<u64, Arc<Mutex<Helper>>> }

#[derive(Default)]
pub struct NativeParticles(Arc<Mutex<Pool>>);

/// Unpacks the files of a custom effect zip into `<cache>/<name>-<size>-<modified>` (once) and returns that folder.
fn unpack_effect(cache: &Path, zip: &source_formats::zipfs::ZipFile) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(&zip.path).map_err(|e| e.to_string())?;
    let stamp = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let stem = zip.path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = cache.join(format!("{stem}-{}-{stamp}", meta.len()));
    let done = dir.join(".unpacked");
    if done.is_file() { return Ok(dir); }
    let _ = std::fs::remove_dir_all(&dir);
    for path in zip.paths() {
        if path.contains("..") || path.starts_with('/') { continue; }
        let Some(bytes) = zip.read(path) else { continue };
        let target = dir.join(path);
        if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::write(&target, bytes).map_err(|e| format!("Cannot unpack {path}: {e}"))?;
    }
    std::fs::write(&done, b"").map_err(|e| e.to_string())?;
    Ok(dir)
}

fn executable() -> Option<PathBuf> {
    // Development build stays ignored. Release packaging must explicitly supply the helper.
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/particle-probe/particle-probe.exe");
    if cfg!(debug_assertions) && development.is_file() { return Some(development); }
    let packaged = std::env::current_exe().ok()?.parent()?.join("native/particle-probe.exe");
    packaged.is_file().then_some(packaged)
}

#[tauri::command]
pub async fn native_particle_reset(native: State<'_, NativeParticles>) -> Result<u64, String> {
    let pool = native.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut pool = pool.lock().map_err(|e| e.to_string())?;
        pool.helpers.clear();
        pool.generation += 1;
        Ok(pool.generation)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn native_particle_start(app: tauri::AppHandle, state: State<'_, AppState>, native: State<'_, NativeParticles>,
    cp: [f64; 12], generation: u64, file: String, system: String, boxes: Vec<[f64; 18]>, refire: f64, slots: Option<u32>, seed: Option<u32>) -> Result<Option<NativeStart>, String> {
    let Some(executable) = executable() else { return Ok(None); };
    let vpk = state.vpk()?;
    let game = vpk.game_root().ok_or("No mounted TF2 folder")?.to_owned();
    // a custom effect's files are unpacked once, for the helper to find them
    let extra = match vpk.effect_archives().into_iter().find(|z| z.contains(&file.to_ascii_lowercase())) {
        Some(zip) => Some(unpack_effect(&crate::commands::effects_cache_dir(&app)?, &zip)?),
        None => None,
    };
    let pool = native.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut pool = pool.lock().map_err(|e| e.to_string())?;
            if pool.generation != generation { return Err("Particle preview was reloaded".into()); }
            if pool.helpers.len() + pool.starting >= 32 { return Err("Too many native particle effects (at most 32 run at once): switch some off".into()); }
            pool.starting += 1;
        }
        // the slow part (a process that loads the effect) runs without the pool
        let started = (|| -> Result<(Helper, Vec<NativeNode>), String> {
            let mut helper = Helper::start_seeded(&executable, &game, extra.as_deref(), &file, &system, refire, slots.unwrap_or(1), seed.unwrap_or(273))?;
            helper.frame(Duration::from_secs(15))?;
            let nodes = helper.step(0, &cp, &boxes)?;
            Ok((helper, nodes))
        })();
        let mut pool = pool.lock().map_err(|e| e.to_string())?;
        pool.starting -= 1;
        let (helper, nodes) = started?;
        // a webview that reloaded meanwhile does not want it (dropping the helper ends its process)
        if pool.generation != generation { return Err("Particle preview was reloaded".into()); }
        pool.next += 1; let handle = pool.next;
        pool.helpers.insert(handle, Arc::new(Mutex::new(helper)));
        Ok(Some(NativeStart { handle, nodes }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn native_particle_step(native: State<'_, NativeParticles>, handle: u64, ticks: u32,
    cp: [f64; 12], boxes: Vec<[f64; 18]>, action: Option<u32>, flame: Option<Vec<f64>>, colors: Option<Vec<f64>>, instances: Option<Vec<Vec<f64>>>,target:Option<Vec<f64>>,floor:Option<f64>) -> Result<tauri::ipc::Response, String> {
    let pool = native.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let helper = pool.lock().map_err(|e| e.to_string())?.helpers.get(&handle).cloned().ok_or("Native effect has been removed")?;
        let result = {
            let mut helper = helper.lock().map_err(|e| e.to_string())?;
            helper.floor = floor;
            helper.step_target_binary(ticks, &cp, &boxes, action.unwrap_or(0), &flame.unwrap_or_default(), &colors.unwrap_or_default(), &instances.unwrap_or_default(),&target.unwrap_or_default())
        };
        if result.is_err() { pool.lock().map_err(|e| e.to_string())?.helpers.remove(&handle); }
        result.map(tauri::ipc::Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn native_particle_stop(native: State<'_, NativeParticles>, handle: u64) -> Result<(), String> {
    let pool = native.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        pool.lock().map_err(|e| e.to_string())?.helpers.remove(&handle);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_blood_effects() {
        let game=source_formats::steam::find_tf2().unwrap();let vpk=source_formats::VpkSet::open_folder(&game).unwrap();
        let mut files=HashMap::new();for path in vpk.search("particles/",usize::MAX).into_iter().filter(|p|p.ends_with(".pcf")){for name in workbench_core::game::pcf_system_names(&vpk.read(path).unwrap()).unwrap(){files.insert(name,path.to_owned());}}
        for system in ["blood_impact_red_01","blood_spray_red_01","blood_spray_red_01_far"] {
            let file=files.get(system).expect("installed blood system");eprintln!("{system}: {file}");
            let mut helper=Helper::start(&executable().unwrap(),&game,file,system).unwrap();helper.frame(Duration::from_secs(15)).unwrap();
            let cp=[1.,0.,0.,0.,-1.,0.,0.,0.,1.,100.,0.,50.];let mut count=0;let mut frame=vec![];
            for _ in 0..100 {frame=helper.step(6,&cp,&[]).unwrap();for node in &frame {count+=node.particles.len();assert!(node.particles.iter().all(|p|p.iter().all(|v|v.is_finite())));}}
            assert!(count>0,"{system} must emit");assert!(frame.iter().all(|n|n.particles.is_empty()),"blood must finish before cleanup");
        }
    }
    /// Hit blood shares one helper per system: independent slots restart on their action flag and expire.
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_blood_pools() {
        let game=source_formats::steam::find_tf2().unwrap();
        let vpk=source_formats::VpkSet::open_folder(&game).unwrap();
        let mut files=HashMap::new();
        for path in vpk.search("particles/",usize::MAX).into_iter().filter(|p|p.ends_with(".pcf") && !p.contains("_dx80") && !p.contains("_high")) {
            for name in workbench_core::game::pcf_system_names(&vpk.read(path).unwrap()).unwrap() {files.insert(name,path.to_owned());}
        }
        let cp=[1.,0.,0.,0.,-1.,0.,0.,0.,1.,0.,0.,0.];
        for system in ["blood_impact_red_01","blood_spray_red_01","blood_spray_red_01_far"] {
            let file=files.get(system).expect(system);
            let mut helper=Helper::start_slots(&executable().unwrap(),&game,file,system,0.,16).unwrap();
            let initial=helper.frame(Duration::from_secs(15)).unwrap();
            let mut rows:Vec<Vec<f64>>=(0..16).map(|_|[cp.as_slice(),&[0.]].concat()).collect();
            assert!(helper.step_instances(6,&cp,&[],0,&[],&[],&rows).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: idle slots emit nothing");
            rows[0][9]=100.;rows[0][12]=1.;rows[5][9]=-400.;rows[5][12]=1.;
            let mut near=false;let mut far=false;
            for _ in 0..20 {
                let frame=helper.step_instances(1,&cp,&[],0,&[],&[],&rows).unwrap();
                assert_eq!(frame.len(),initial.len(),"{system}: stable pooled graph");
                let ps:Vec<_>=frame.iter().flat_map(|n|&n.particles).collect();
                near |= ps.iter().any(|p|p[0]>0.);far |= ps.iter().any(|p|p[0]< -200.);
                rows.iter_mut().for_each(|r|r[12]=0.);
            }
            assert!(near && far,"{system}: two hits from independent origins");
            for _ in 0..80 {helper.step_instances(6,&cp,&[],0,&[],&[],&rows).unwrap();}
            assert!(helper.step_instances(6,&cp,&[],0,&[],&[],&rows).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: blood must expire");
            rows[0][12]=1.;
            let mut again=false;
            for _ in 0..6 {again |= helper.step_instances(6,&cp,&[],0,&[],&[],&rows).unwrap().iter().any(|n|!n.particles.is_empty());rows[0][12]=0.;}
            assert!(again,"{system}: a recycled slot must splash again");
        }
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_projectile_pools() {
        let game=source_formats::steam::find_tf2().unwrap();
        let vpk=source_formats::VpkSet::open_folder(&game).unwrap();
        let mut files=HashMap::new();
        for path in vpk.search("particles/",usize::MAX).into_iter().filter(|p|p.ends_with(".pcf") && !p.contains("_dx80") && !p.contains("_high")) {
            for name in workbench_core::game::pcf_system_names(&vpk.read(path).unwrap()).unwrap() {files.insert(name,path.to_owned());}
        }
        let cp=[1.,0.,0.,0.,-1.,0.,0.,0.,1.,100.,20.,60.];
        for system in ["rockettrail","rockettrail_airstrike","pipebombtrail_red","pipebombtrail_blue","nailtrails_medic_red","nailtrails_medic_blue",
            "drg_cow_rockettrail_normal","drg_cow_rockettrail_normal_blue","drg_bison_projectile"] {
            let file=files.get(system).expect(system);
            let mut helper=Helper::start_slots(&executable().unwrap(),&game,file,system,0.,2).unwrap();
            let initial=helper.frame(Duration::from_secs(15)).unwrap();
            assert!(helper.step(6,&cp,&[]).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: pooled idle emission");
            let mut rows=vec![[cp.as_slice(),&[1.]].concat(),[cp.as_slice(),&[1.]].concat()];rows[1][10]=500.;
            let colors=[0.72,0.22,0.23,0.5,0.18,0.125];
            let mut visible=0; let mut origins=[false,false];
            for _ in 0..60 {
                rows[0][9]+=20.;rows[1][9]+=20.;
                let frame=helper.step_instances(1,&cp,&[],0,&[],&colors,&rows).unwrap();
                assert_eq!(frame.len(),initial.len(),"Stable pooled graph");
                visible+=frame.iter().flat_map(|n|&n.particles).filter(|p|p[6]>0. && p[7]>0.).count();
                let ps:Vec<_>=frame.iter().flat_map(|n|&n.particles).collect();
                origins[0] |= ps.iter().any(|p|p[1]<200.);
                origins[1] |= ps.iter().any(|p|p[1]>300.);
                rows.iter_mut().for_each(|r|r[12]=0.);
            }
            assert!(origins[0] && origins[1],"{system}: independent moving origins");
            assert!(visible>0,"{system}: no visible trail particles");
            rows.iter_mut().for_each(|r|r[12]=2.);
            helper.step_instances(0,&cp,&[],0,&[],&colors,&rows).unwrap();rows.iter_mut().for_each(|r|r[12]=0.);
            for _ in 0..80 {helper.step_instances(6,&cp,&[],0,&[],&colors,&rows).unwrap();}
            assert!(helper.step_instances(6,&cp,&[],0,&[],&colors,&rows).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: trails must expire");
            rows.iter_mut().for_each(|r|r[12]=1.);
            helper.step_instances(0,&cp,&[],0,&[],&colors,&rows).unwrap();rows.iter_mut().for_each(|r|r[12]=0.);
            let mut emitted=false;
            for _ in 0..6 {emitted |= helper.step_instances(6,&cp,&[],0,&[],&colors,&rows).unwrap().iter().any(|n|!n.particles.is_empty());}
            assert!(emitted,"{system}: recycled slots must emit again");
            eprintln!("Verified {system} in {file}");
        }
        for system in ["drg_cow_muzzleflash_normal","drg_cow_muzzleflash_normal_blue","drg_bison_muzzleflash", "ExplosionCore_Wall", "ExplosionCore_MidAir", "drg_cow_explosioncore_normal", "drg_cow_explosioncore_normal_blue", "drg_pomson_impact"] {
            let mut helper=Helper::start(&executable().unwrap(),&game,files.get(system).unwrap_or_else(||panic!("Missing {system}; available: {:?}",files.keys().filter(|n|n.contains("ExplosionCore")).collect::<Vec<_>>())),system).unwrap();
            helper.frame(Duration::from_secs(15)).unwrap();
            let frame=helper.step_colors(6,&cp,&[],1,&[],&[0.72,0.22,0.23,0.5,0.18,0.125]).unwrap();
            assert!(frame.iter().any(|n|!n.particles.is_empty()),"{system}: muzzle flash");
        }
        for system in ["stickybombtrail_red","stickybombtrail_blue","stickybomb_pulse_red","stickybomb_pulse_blue","medicgun_beam_red","medicgun_beam_blue","loose_cannon_sparks","loose_cannon_buildup_smoke3"] {
            let mut helper=Helper::start(&executable().unwrap(),&game,files.get(system).expect(system),system).unwrap();
            helper.frame(Duration::from_secs(15)).unwrap();
            let mut visible=false;
            for i in 0..20 {
                let frame=helper.step_target(6,&cp,&[],0,&[],&[],&[],&[300.+i as f64*10.,20.,60.]).unwrap();
                visible |= frame.iter().any(|n|!n.particles.is_empty());
                if system.starts_with("medicgun") && i==19 {assert!(frame.iter().flat_map(|n|&n.particles).any(|p|p[0]>400.),"Moving healing CP1 endpoint");}
            }
            assert!(visible,"{system}: visible emission");
        }
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_weapon_emission_lifecycle() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let cp = [1.,0.,0.,0.,-1.,0.,0.,0.,1.,100.,20.,60.];
        for (file,system) in [("particles/muzzle_flash.pcf","muzzle_pistol"), ("particles/muzzle_flash.pcf","muzzle_shotgun"),
            ("particles/muzzle_flash.pcf","muzzle_minigun_constant"), ("particles/shellejection.pcf","eject_minigunbrass"),
            ("particles/flamethrower.pcf","new_flame")] {
            let mut h = Helper::start(&executable().expect("helper"),&game,file,system).unwrap();
            h.frame(Duration::from_secs(15)).unwrap();
            h.step_emission(0,&cp,&[],2).unwrap();
            assert!(h.step(6,&cp,&[]).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: idle must not emit");
            let first = h.step_emission(6,&cp,&[],1).unwrap();
            assert!(first.iter().any(|n|!n.particles.is_empty()),"{system}: firing must emit");
            h.step_emission(0,&cp,&[],2).unwrap();
            for _ in 0..120 {h.step(6,&cp,&[]).unwrap();}
            assert!(h.step(6,&cp,&[]).unwrap().iter().all(|n|n.particles.is_empty()),"{system}: stopped particles must expire");
            assert!(h.step_emission(6,&cp,&[],3).unwrap().iter().any(|n|!n.particles.is_empty()),"{system}: second burst must resume");
        }
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_weapon_flame_manager() {
        let game=source_formats::steam::find_tf2().unwrap();
        let mut helper=Helper::start(&executable().unwrap(),&game,"particles/flamethrower.pcf","new_flame").unwrap();
        helper.frame(Duration::from_secs(15)).unwrap();
        let cp=[1.,0.,0.,0.,-1.,0.,0.,0.,1.,100.,20.,60.];
        let config=[2450.,0.6,0.1,8.5,0.,50.,2.8,1.,1.,0.];
        helper.step_flame(0,&cp,&[],2,&config).unwrap();
        helper.step_flame(0,&cp,&[],3,&config).unwrap();
        let mut furthest=0_f64;
        let mut visible=0;
        for _ in 0..12 {
            for node in helper.step_flame(6,&cp,&[],0,&config).unwrap() {
                for p in node.particles {if p[6]>0.1 && p[7]>1. {visible+=1;furthest=furthest.max(p[0]-cp[9]);}}
            }
        }
        assert!(visible>20,"Flame manager must feed visible particles");
        assert!(furthest>100. && furthest<600.,"Flames must travel along the authored stream: {furthest}");
        helper.step_flame(0,&cp,&[],2,&config).unwrap();
        for _ in 0..120 {helper.step_flame(6,&cp,&[],0,&config).unwrap();}
        assert!(helper.step_flame(6,&cp,&[],0,&config).unwrap().iter().all(|n|n.particles.is_empty()));
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_binary_frames_carry_the_same_particles_as_text_frames() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let start = || { let mut h = Helper::start(&executable().expect("helper"), &game, "particles/halloween2026_unusuals.pcf", "utaunt_electropulse_teamc_teamcolor_red").unwrap(); h.frame(Duration::from_secs(15)).unwrap(); h };
        let (mut text, mut binary) = (start(), start());
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 0.];
        let boxes = [[-12., -12., -35., 12., 12., 35., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 40.]];
        let (mut nodes, mut bytes) = (Vec::new(), Vec::new());
        for _ in 0..150 {
            nodes = text.step(1, &cp, &boxes).unwrap();
            bytes = binary.step_target_binary(1, &cp, &boxes, 0, &[], &[], &[], &[]).unwrap();
        }
        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize, nodes.len(), "every collection is in the frame");
        let total: usize = nodes.iter().map(|n| n.particles.len()).sum();
        assert!(total > 100);
        assert_eq!(bytes.len(), 4 + 20 * nodes.len() + 68 * total, "17 float32 for every particle");
        // the first collection that has particles: the numbers are the same (the two helpers have the same random seed)
        let mut at = 4;
        for node in &nodes {
            let count = u32::from_le_bytes(bytes[at + 16..at + 20].try_into().unwrap()) as usize;
            assert_eq!(count, node.particles.len(), "{}", node.name);
            if count > 0 {
                let first: Vec<f32> = bytes[at + 20..at + 20 + 68].chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
                for (a, b) in first.iter().zip(&node.particles[0]) { assert!((*a as f64 - b).abs() < 1e-3, "{}: {a} vs {b}", node.name); }
                break;
            }
            at += 20 + 68 * count;
        }
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_floor_stops_the_footprints_of_electrocution() {
        // The footprint parents fall under 500000 gravity and rely on "Collision via traces" to stop: without a floor they leave the world.
        let game = source_formats::steam::find_tf2().expect("TF2");
        let low = |floor: Option<f64>| {
            let mut helper = Helper::start(&executable().expect("helper"), &game, "particles/summer2024_unusuals.pcf", "utaunt_demigodery_teamcolor_red").unwrap();
            helper.frame(Duration::from_secs(15)).unwrap();
            helper.floor = floor;
            let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 0.];
            let boxes = [[-10., -10., 0., 10., 10., 70., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0.]];
            // the frame after four seconds (the first frames have particles that spawn before the constraint has stopped their parent)
            let mut lowest = f64::MAX;
            for tick in 0..240 {
                let frame = helper.step(1, &cp, &boxes).unwrap();
                if tick < 239 { continue; }
                for node in frame.iter().filter(|n| n.name.contains("footprints")) {
                    for p in &node.particles { lowest = lowest.min(p[2]); }
                }
            }
            lowest
        };
        assert!(low(None) < -1000., "no world to land on");
        let landed = low(Some(0.));
        assert!(landed > -10. && landed < 10., "the floor holds them: {landed}");
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_electric_impulse_render_transport() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let mut helper = Helper::start(&executable().expect("helper"), &game,
            "particles/halloween2026_unusuals.pcf", "utaunt_electropulse_teamc_teamcolor_red").unwrap();
        helper.frame(Duration::from_secs(15)).unwrap();
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 0.];
        let boxes = [[-12., -12., -35., 12., 12., 35., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 40.]];
        let mut rays = 0;
        for _ in 0..180 {
            let frame = helper.step(1, &cp, &boxes).unwrap();
            assert_eq!(frame.len(), 97, "Keep every collection instance and child");
            for node in frame {
                if node.name.ends_with("_ropespawn") || node.name.ends_with("_spawnglow") {
                    assert!(node.particles.is_empty(), "Invisible driver particles must stay inside Source");
                }
                if node.name.ends_with("_rope1") || node.name.ends_with("_trail1") { rays += node.particles.len(); }
            }
        }
        assert!(rays > 100, "Source drivers must still produce their visible electric rays");
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_sequence_lifetime_splash() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let mut helper = Helper::start(&executable().expect("helper"), &game,
            "particles/halloween2026_unusuals.pcf", "utaunt_waste_yellow_parent").unwrap();
        helper.frame(Duration::from_secs(15)).unwrap();
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 0.];
        let mut sequences = std::collections::BTreeSet::new();
        let mut samples = 0;
        for _ in 0..60 {
            let frame = helper.step(6, &cp, &[]).unwrap();
            let splash = frame.iter().find(|n| n.name == "utaunt_waste_acid_splash").expect("Splash child");
            for p in &splash.particles {
                // drink_goop3's four authored sequences contain 14 frames at 30 FPS.
                assert!((p[10] - 14. / 30.).abs() < 0.0001, "Lifetime must come from the original VTF sheet");
                assert!(p[2] >= -1. && p[2] < 40., "Splash must remain near the ground");
                sequences.insert(p[11] as i32);
                samples += 1;
            }
        }
        assert!(samples > 50, "The splash must emit living particles, not just an empty child node");
        assert_eq!(sequences, [0, 1, 2, 3].into_iter().collect());
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_refire_reemits() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let mut helper = Helper::start_with_refire(&executable().expect("helper"), &game,
            "particles/taunt_fx.pcf", "utaunt_firework_teamcolor_red", 2.6).unwrap();
        helper.frame(Duration::from_secs(15)).unwrap();
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 0.];
        let mut frame = vec![];
        for _ in 0..32 { frame = helper.step(6, &cp, &[]).unwrap(); }
        assert!(frame.iter().flat_map(|n| &n.particles).any(|p| p[9] > 2.6), "Repeating taunts must emit another burst after the schema interval");
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_unusual_catalog_smoke() {
        use source_formats::{items, kv, VpkSet};
        let game = source_formats::steam::find_tf2().expect("TF2");
        let vpk = VpkSet::open_folder(&game).unwrap();
        let mut files = HashMap::new();
        for path in vpk.search("particles/", usize::MAX).into_iter().filter(|p| p.ends_with(".pcf")) {
            for name in workbench_core::game::pcf_system_names(&vpk.read(path).unwrap()).unwrap() { files.insert(name, path.to_owned()); }
        }
        let nodes = kv::parse(&items::decode_text(&vpk.read("scripts/items/items_game.txt").unwrap())).unwrap();
        let root = kv::find(&nodes, "items_game").unwrap().block().unwrap();
        let catalog = kv::find(root, "attribute_controlled_attached_particles").unwrap().block().unwrap();
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 70.];
        let boxes = [[-5., -5., -5., 5., 5., 5., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 40.]];
        let mut visited = std::collections::HashSet::new();
        let mut errors = Vec::new();
        for category in ["cosmetic_unusual_effects", "taunt_unusual_effects"] {
            for entry in kv::find(catalog, category).unwrap().block().unwrap() {
                let Some(system) = entry.block().and_then(|b| kv::find(b, "system")).and_then(kv::Node::as_str) else { continue; };
                if !visited.insert(system.to_owned()) { continue; }
                let Some(file) = files.get(system) else { eprintln!("NOT INSTALLED: {system}"); continue; };
                let result = (|| -> Result<(), String> {
                    let mut helper = Helper::start(&executable().expect("helper"), &game, file, system)?;
                    helper.frame(Duration::from_secs(15))?;
                    let mut frame = helper.step(0, &cp, &boxes)?;
                    for _ in 0..30 { frame = helper.step(6, &cp, &boxes)?; }
                    if frame.is_empty() { return Err("No native collections".into()); }
                    Ok(())
                })();
                if let Err(error) = result { errors.push(format!("{system}: {error}")); }
                if visited.len() % 100 == 0 { eprintln!("Checked {} unusual systems", visited.len()); }
            }
        }
        eprintln!("Checked {} distinct unusual systems; {} failures", visited.len(), errors.len());
        assert!(errors.is_empty(), "{}", errors.join("\n"));
    }
    #[test]
    fn invalid_frame_is_rejected() {
        let node = NativeNode { id: 1, name: "test".into(), capacity: 1, time: 0.0, dt: 0.0, particles: vec![] };
        assert!(validate_frame(vec![node]).is_err());
        let mut particle = [0.0; 17]; particle[11] = 1065353216.0;
        let node = NativeNode { id: 0, name: "test".into(), capacity: 1, time: 0.0, dt: 0.0, particles: vec![particle] };
        assert!(validate_frame(vec![node]).is_err(), "Float bits mistaken for an integer sequence must not reach rendering");
    }
    #[test]
    #[ignore = "requires locally built SDK helper and installed TF2"]
    fn installed_silver_lifecycle() {
        let game = source_formats::steam::find_tf2().expect("TF2");
        let mut helper = Helper::start(&executable().expect("helper"), &game, "particles/smissmas2022_unusuals.pcf", "unusual_sheetmusic_silver_parent").unwrap();
        let initial = helper.frame(Duration::from_secs(15)).unwrap();
        assert_eq!(initial.len(), 36);
        let cp = [1., 0., 0., 0., -1., 0., 0., 0., 1., 0., 0., 70.];
        let mut frame = vec![];
        for _ in 0..120 { frame = helper.step(6, &cp, &[]).unwrap(); }
        assert!((frame[0].time - 12.).abs() < 0.001);
        let ropes: Vec<_> = frame.iter().filter(|n| n.name == "unusual_sheetmusic_silver_rope").collect();
        assert_eq!(ropes.len(), 5);
        assert!(ropes.iter().all(|n| n.particles.len() >= 2));
        // The actual PCF fixes the leading symbol to sheet sequence 1. Sequences are float
        // attributes, not integer bit patterns; a finite-state test alone cannot catch this.
        assert_eq!(frame[0].particles[0][11], 1.0);
        let sequences: std::collections::BTreeSet<_> = frame.iter()
            .filter(|n| n.name.contains("_note"))
            .flat_map(|n| &n.particles).map(|p| p[11] as i32).collect();
        assert!(sequences.len() >= 2, "Authored note variants must survive the bridge");
        assert!(frame.iter().flat_map(|n| &n.particles).all(|p| p[11] >= 0.0 && p[11] <= 6.0));
        // Restart creates a fresh runtime, including all child seeds and emission state.
        let mut restarted = Helper::start(&executable().expect("helper"), &game, "particles/smissmas2022_unusuals.pcf", "unusual_sheetmusic_silver_parent").unwrap();
        restarted.frame(Duration::from_secs(15)).unwrap();
        let mut replay = vec![];
        for _ in 0..120 { replay = restarted.step(6, &cp, &[]).unwrap(); }
        assert_eq!(serde_json::to_string(&frame).unwrap(), serde_json::to_string(&replay).unwrap());
        // Updating attachment orientation/position without a tick must not advance the effect.
        let moved = [0., 1., 0., 1., 0., 0., 0., 0., 1., 20., 10., 80.];
        let paused = restarted.step(0, &moved, &[]).unwrap();
        assert_eq!(serde_json::to_string(&replay).unwrap(), serde_json::to_string(&paused).unwrap());
        let moving = restarted.step(6, &moved, &[]).unwrap();
        assert!(moving[0].time > replay[0].time);
        assert!(moving.iter().flat_map(|n| &n.particles).all(|p| p.iter().all(|v| v.is_finite())));
        assert_ne!(serde_json::to_string(&moving).unwrap(), serde_json::to_string(&replay).unwrap());
        // Separate actors have separate engine globals; advancing one must leave the other alone.
        assert_eq!(serde_json::to_string(&helper.step(0, &cp, &[]).unwrap()).unwrap(), serde_json::to_string(&frame).unwrap());
    }
}
