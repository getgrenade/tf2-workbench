//! SDK item_import.cpp::AddTauntToAsset excludes QC/MDL from submissions. Compile
//! the packed DMX + expanded QCI with TF2's own studiomdl into a private game root.
//! Never install class_user_animations.mdl into TF2: each ZIP gets its own namespace.
use std::{collections::hash_map::DefaultHasher, fs, hash::{Hash, Hasher}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use crate::{anim::AnimSet, items, kv::{self, Node}, mdl, vpk::VpkSet, zipfs::ZipFile};

static COMPILER: Mutex<()> = Mutex::new(());
static ACTIVE_CACHE: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub struct CacheCleanup { pub removed: usize, pub deferred: usize, pub bytes: u64 }

/// Only compiler-generated hash directories are eligible. Never follow links/junctions.
fn cache_bytes(path: &Path) -> Result<u64, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() { return Err("Linked cache entry was skipped".into()); }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err("Linked cache entry was skipped".into()); }
    }
    if meta.is_file() { return Ok(meta.len()); }
    fs::read_dir(path).map_err(|e| e.to_string())?.try_fold(0, |sum, entry| {
        cache_bytes(&entry.map_err(|e| e.to_string())?.path()).map(|bytes| sum + bytes)
    })
}

/// None clears all entries; otherwise remove entries unused for the given age.
/// Mounted files remain available until restart, when their deletion marker is honored.
pub fn cleanup_cache(cache: &Path, max_age: Option<Duration>) -> Result<CacheCleanup, String> {
    let _lock = COMPILER.lock().map_err(|e| e.to_string())?;
    let mut result = CacheCleanup { removed: 0, deferred: 0, bytes: 0 };
    if !cache.exists() { return Ok(result); }
    // Validate the root itself before considering any recursive deletion.
    cache_bytes(cache)?;
    let root = cache.canonicalize().map_err(|e| e.to_string())?;
    let active = ACTIVE_CACHE.lock().map_err(|e| e.to_string())?;
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name(); let name = name.to_string_lossy();
        if name.len() != 16 || !name.bytes().all(|b| b.is_ascii_hexdigit()) || !entry.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
        let path = entry.path();
        let bytes = cache_bytes(&path)?;
        let resolved = path.canonicalize().map_err(|e| e.to_string())?;
        if resolved.parent() != Some(root.as_path()) { return Err("Cache entry escaped its root".into()); }
        let used = fs::metadata(path.join("last-used")).or_else(|_| fs::metadata(path.join("complete"))).or_else(|_| fs::metadata(&path))
            .and_then(|m| m.modified()).map_err(|e| e.to_string())?;
        let stale = max_age.map_or(true, |age| used.elapsed().is_ok_and(|elapsed| elapsed >= age));
        if !stale && !path.join("delete-on-restart").is_file() { continue; }
        if active.contains(&resolved) {
            fs::write(path.join("delete-on-restart"), "").map_err(|e| e.to_string())?;
            result.deferred += 1;
        } else {
            fs::remove_dir_all(&resolved).map_err(|e| e.to_string())?;
            result.removed += 1; result.bytes += bytes;
        }
    }
    Ok(result)
}

#[derive(Debug, Clone)]
pub struct PreparedTaunt {
    pub animation: String,
    pub sequence: String,
    pub prop: Option<String>,
}

fn block<'a>(n: &'a [Node], k: &str) -> Option<&'a [Node]> { kv::find(n, k)?.block() }
fn string<'a>(n: &'a [Node], k: &str) -> Option<&'a str> { kv::find(n, k)?.as_str() }

/// Reject traversal and absolute archive paths before extracting anything.
fn safe_path(s: &str) -> Result<String, String> {
    let p = s.replace("\\\\", "/").replace('\\', "/");
    if p.is_empty() || p.split('/').any(|c| c.is_empty() || c == "." || c == "..") || p.contains([':', '"', '\n', '\r']) {
        return Err(format!("Invalid Workshop source path: {s}"));
    }
    Ok(p.to_ascii_lowercase())
}

fn quoted(p: &Path) -> Result<String, String> {
    let p = p.to_string_lossy().replace('\\', "/");
    if p.contains(['"', '\n', '\r']) { return Err("Unsupported quote/newline in compiler path".into()); }
    Ok(format!("\"{p}\""))
}

fn extract(zip: &ZipFile, path: &str, root: &Path) -> Result<PathBuf, String> {
    let path = safe_path(path)?;
    if !path.starts_with("content/") { return Err("Workshop source must be inside content/".into()); }
    let bytes = zip.read(&path).ok_or_else(|| format!("ZIP is missing {path}"))?;
    let dest = root.join(path);
    fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

fn compile(exe: &Path, game: &Path, qc: &Path) -> Result<(), String> {
    let log_path = qc.with_extension("log");
    let log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.current_dir(exe.parent().unwrap()).arg("-nop4").arg("-game").arg(game).arg(qc)
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(log));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Cannot start TF2 studiomdl: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if status.success() { return Ok(()); }
            let log = fs::read_to_string(&log_path).unwrap_or_default();
            return Err(format!("Taunt compilation failed: {}\n{}", log_path.display(), log.chars().rev().take(3000).collect::<String>().chars().rev().collect::<String>()));
        }
        if start.elapsed() > Duration::from_secs(90) {
            let _ = child.kill(); let _ = child.wait();
            return Err(format!("Taunt compilation timed out; see {}", log_path.display()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn prepare(vpk: &VpkSet, item_id: u32, class: &str, cache: &Path) -> Result<PreparedTaunt, String> {
    let _lock = COMPILER.lock().map_err(|e| e.to_string())?;
    let db = items::load(vpk).map_err(|e| e.to_string())?;
    let item = db.taunts.iter().find(|i| i.id == item_id && i.workshop).ok_or("Workshop taunt no longer exists")?;
    if !item.classes.iter().any(|c| c == class) { return Err("Taunt is not available for this class".into()); }
    let folder = if class == "demoman" { "demo" } else { class };
    let (zip, session) = vpk.workshop_archives().into_iter().find_map(|z| {
        let root = kv::parse(&z.manifest()?).ok()?;
        let session = root.iter().filter_map(Node::block).find_map(|b| block(b, "ImportSession"))?;
        let schema = block(session, "ItemSchema")?;
        let name = string(schema, "import_name").or_else(|| string(session, "name"))?;
        (name == item.name).then(|| (z, session.to_vec()))
    }).ok_or("Cannot find taunt source ZIP")?;
    let class_data = block(&session, "classes").and_then(|b| block(b, folder).or_else(|| block(b, class))).ok_or("Missing class import data")?;
    let animation_source = block(class_data, "animation").and_then(|b| string(b, "source_file")).ok_or("Missing taunt animation source")?;
    let source_path = safe_path(animation_source)?;
    let qci_path = Path::new(&source_path).with_extension("qci").to_string_lossy().replace('\\', "/");
    let qci = String::from_utf8(zip.read(&qci_path).ok_or("Taunt ZIP is missing its expanded animation QCI")?).map_err(|e| e.to_string())?;
    // These directives can redirect compiler reads/writes outside our generated project.
    // Packed animation QCIs contain bone/sequence definitions, not a top-level QC.
    for line in qci.lines() {
        let command = line.split("//").next().unwrap_or("").trim().to_ascii_lowercase();
        if ["$modelname", "$cd", "$pushd", "$popd", "$include", "$write", "$appendblankbodygroup"].iter().any(|k| command.starts_with(k)) {
            return Err(format!("Unsupported path/output directive in taunt QCI: {line}"));
        }
    }
    let tf = vpk.game_root().ok_or("TF2 game directory is unavailable")?;
    // The 32-bit tool ships with its mdllib.dll; some installs have an incomplete x64 tool set.
    let exe = tf.parent().ok_or("Invalid TF2 directory")?.join("bin/studiomdl.exe");
    if !exe.is_file() { return Err("TF2's bin/studiomdl.exe is required to preview source-only taunt ZIPs".into()); }
    let mut hash = DefaultHasher::new();
    fs::read(&zip.path).map_err(|e| e.to_string())?.hash(&mut hash);
    class.hash(&mut hash);
    "workbench-taunt-compiler-v1".hash(&mut hash);
    let key = format!("{:016x}", hash.finish());
    // Source's compiler predates Windows verbatim paths returned by canonicalize.
    let cache_text = cache.to_string_lossy();
    let root = Path::new(cache_text.strip_prefix("\\\\?\\").unwrap_or(&cache_text)).join(&key);
    let game = root.join("game");
    let prefix = format!("models/workshop/workbench/{key}/{folder}");
    let animation = format!("{prefix}/animation.mdl");
    let prop = item.per_class.get(class).or(item.model.as_ref()).map(|_| format!("{prefix}/prop.mdl"));
    let marker = root.join("complete");
    if !marker.is_file() || !game.join(&animation).is_file() || prop.as_ref().is_some_and(|p| !game.join(p).is_file()) {
        fs::create_dir_all(&game).map_err(|e| e.to_string())?;
        fs::write(game.join("gameinfo.txt"), format!("\"GameInfo\" {{ \"game\" \"TF2 Workbench compiler\" \"FileSystem\" {{ \"SteamAppId\" \"440\" \"SearchPaths\" {{ \"Game\" \"|gameinfo_path|.\" \"Game\" {} }} }} }}", quoted(tf)?)).map_err(|e| e.to_string())?;
        let dmx = extract(&zip, &source_path, &root)?;
        let qci_file = extract(&zip, &qci_path, &root)?;
        // Use the same class bind skeleton as the importer. Derive it from the MDL
        // when the importer has not yet unpacked its workshop/content resources.
        let defines = tf.join(format!("workshop/content/models/player/{folder}/{folder}_definebones.qci"));
        let bones = if defines.is_file() { fs::read_to_string(defines).map_err(|e| e.to_string())? } else {
            let data = vpk.read(&format!("models/player/{folder}.mdl")).map_err(|e| e.to_string())?;
            let m = mdl::parse(&data).map_err(|e| e.to_string())?;
            m.bones.iter().map(|b| {
                let parent = if b.parent < 0 { "" } else { &m.bones[b.parent as usize].name };
                format!("$definebone \"{}\" \"{}\" {} {} {} {} {} {} 0 0 0 0 0 0\n", b.name, parent, b.pos[0], b.pos[1], b.pos[2], b.rot[0].to_degrees(), b.rot[1].to_degrees(), b.rot[2].to_degrees())
            }).collect::<String>()
        };
        let qc = dmx.with_extension("qc");
        fs::write(&qc, format!("$upaxis Y\n$modelname \"{}\"\n{bones}\n$include {}\n", animation.trim_start_matches("models/"), quoted(&qci_file)?)).map_err(|e| e.to_string())?;
        compile(&exe, &game, &qc)?;
        if let Some(prop_path) = &prop {
            let source = block(class_data, "LOD0").and_then(|b| string(b, "file")).ok_or("Taunt prop is missing its LOD0 source")?;
            let dmx = extract(&zip, source, &root)?;
            let qc = dmx.with_extension("qc");
            // Importer DMXs already contain game-relative material names. Empty cdmaterials
            // preserves them without prepending the directory a second time.
            fs::write(&qc, format!("$upaxis Y\n$modelname \"{}\"\n$body \"default\" {}\n$cdmaterials \"\"\n$sequence \"ref\" {}\n", prop_path.trim_start_matches("models/"), quoted(&dmx)?, quoted(&dmx)?)).map_err(|e| e.to_string())?;
            compile(&exe, &game, &qc)?;
        }
        if !game.join(&animation).is_file() { return Err("Compiler did not produce the taunt animation".into()); }
        fs::write(&marker, "ok").map_err(|e| e.to_string())?;
    }
    let mut files = vec![(animation.clone(), game.join(&animation))];
    if let Some(p) = &prop {
        for suffix in ["mdl", "vvd", "dx90.vtx"] {
            let path = format!("{}.{}", p.trim_end_matches(".mdl"), suffix);
            if !game.join(&path).is_file() { return Err(format!("Compiler did not produce {path}")); }
            files.push((path.clone(), game.join(path)));
        }
    }
    fs::write(root.join("last-used"), "").map_err(|e| e.to_string())?;
    let resolved = root.canonicalize().map_err(|e| e.to_string())?;
    {
        let mut active = ACTIVE_CACHE.lock().map_err(|e| e.to_string())?;
        if !active.contains(&resolved) { active.push(resolved); }
    }
    vpk.mount_compiled(files);
    let set = AnimSet::load(vpk, &animation).map_err(|e| e.to_string())?;
    let sequences = set.sequences();
    let wanted = item.taunt_scenes.get(class).map(String::as_str).unwrap_or("");
    let sequence = sequences.iter().find(|s| s.name.eq_ignore_ascii_case(wanted))
        .or_else(|| sequences.iter().find(|s| !s.hidden && s.frames > 1))
        .ok_or("Compiled taunt has no playable sequence")?.name.clone();
    Ok(PreparedTaunt { animation, sequence, prop })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_cleanup_expires_old_entries_and_defers_mounted_files() {
        let root = std::env::temp_dir().join(format!("workbench-cache-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        let old = root.join("1111111111111111");
        let recent = root.join("2222222222222222");
        let mounted = root.join("3333333333333333");
        let unknown = root.join("keep-this-folder");
        for path in [&old, &recent, &mounted, &unknown] {
            fs::create_dir(path).unwrap();
            fs::write(path.join("complete"), "1234").unwrap();
        }
        let old_time = std::time::SystemTime::now() - Duration::from_secs(31 * 86400);
        fs::File::options().write(true).open(old.join("complete")).unwrap()
            .set_times(fs::FileTimes::new().set_modified(old_time)).unwrap();
        let age = Duration::from_secs(30 * 86400);
        let expired = cleanup_cache(&root, Some(age)).unwrap();
        assert_eq!((expired.removed, expired.bytes), (1, 4));
        assert!(!old.exists()); assert!(recent.exists());
        let mounted_path = mounted.canonicalize().unwrap();
        ACTIVE_CACHE.lock().unwrap().push(mounted_path.clone());
        let cleared = cleanup_cache(&root, None).unwrap();
        assert_eq!((cleared.removed, cleared.deferred), (1, 1));
        assert!(mounted.join("delete-on-restart").exists());
        assert!(unknown.exists()); assert!(!recent.exists());
        ACTIVE_CACHE.lock().unwrap().retain(|p| p != &mounted_path);
        let restarted = cleanup_cache(&root, Some(age)).unwrap();
        assert_eq!(restarted.removed, 1);
        assert!(unknown.join("complete").exists());
        // The unique, absolute test directory was created here, never a user path.
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn source_paths_stay_inside_cache() {
        for p in ["../file", "content/../../file", "C:/file", "/file", "content/evil\".dmx"] { assert!(safe_path(p).is_err(), "{p}"); }
        assert_eq!(safe_path("content\\models\\Taunt.dmx").unwrap(), "content/models/taunt.dmx");
    }
}
