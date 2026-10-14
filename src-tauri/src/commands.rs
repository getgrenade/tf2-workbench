use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use source_formats::{steam, VpkSet};
use tauri::State;

use crate::state::AppState;
use workbench_core::game::{gib_definitions, pcf_system_names, unusual_effects, weapon_profile, UnusualEffectDto};

#[derive(Serialize)]
pub struct ArchiveDto {
    name: String,
    files: usize,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDto {
    tf_dir: String,
    total_files: usize,
    total_bytes: u64,
    millis: u128,
    archives: Vec<ArchiveDto>,
}

#[derive(Serialize)]
pub struct FileDto {
    name: String,
    size: u64,
}

#[derive(Serialize)]
pub struct DirDto {
    dirs: Vec<String>,
    files: Vec<FileDto>,
}

#[derive(Serialize)]
pub struct PreviewDto {
    size: u64,
    /// First bytes of the file.
    head: Vec<u8>,
}

/// What the compiler tab sends to build an item (see `source_formats::itemcompile`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBuildRequest {
    name: String,
    display_name: String,
    prefab: String,
    equip_region: String,
    bodygroups: Vec<String>,
    paintable: bool,
    classes: Vec<ClassRequest>,
    materials: Vec<MaterialRequest>,
    icon: String,
    /** "none": exact textures; anything else: DXT, as the importer makes them. */
    #[serde(default)] compression: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassRequest { folder: String, #[serde(default)] qc_extra: String, #[serde(default)] lod_commands: Vec<Vec<String>>, lods: Vec<LodRequest> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LodRequest { source_path: String, smd: String, #[serde(default)] dmx: Option<Vec<u8>>, triangles: u32, vertices: u32 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueRequest { vmt: String, color: Option<String> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRequest { blue: Option<BlueRequest>, source_name: String, vmt: String, color: Option<String>, normal: Option<String>, phongexponent: Option<String>, illum: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBuildResult { zip: String, session: String, log: Vec<String>, millis: u64 }

/// What the compiler tab sends to build a prop (see `source_formats::propcompile`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropBuildRequest {
    name: String,
    folder: String,
    surfaceprop: String,
    mass: f32,
    static_prop: bool,
    #[serde(default)] collision: Option<String>,
    #[serde(default)] concave: bool,
    lods: Vec<LodRequest>,
    materials: Vec<PropMaterialRequest>,
    max_texture: u32,
    #[serde(default)] qc_extra: String,
    /** The text of the file that opens the prop again in the compiler. */
    #[serde(default)] session: String,
    /** The folder the files go to (the game's custom folder, or beside a map). */
    out_dir: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropMaterialRequest { name: String, vmt: String, color: Option<String>, normal: Option<String>, phongexponent: Option<String>, illum: Option<String>, #[serde(default)] compression: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropBuildResult { folder: String, files: Vec<String>, log: Vec<String>, millis: u64 }

/// Builds a prop into the folder the artist chose: the compiled model, the materials and the sources.
#[tauri::command]
pub async fn build_prop(app: tauri::AppHandle, state: State<'_, AppState>, request: PropBuildRequest) -> Result<PropBuildResult, String> {
    use source_formats::{itemcompile::LodSpec, propcompile::{build, PropMaterialSpec, PropSpec}};
    let vpk = state.vpk()?;
    let path = |p: Option<String>| p.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    if request.out_dir.trim().is_empty() { return Err("Choose the folder the prop is written to".into()); }
    let out = PathBuf::from(&request.out_dir);
    let spec = PropSpec {
        name: request.name, folder: request.folder, surfaceprop: request.surfaceprop, mass: request.mass, static_prop: request.static_prop,
        collision: request.collision.filter(|c| !c.trim().is_empty()), concave: request.concave,
        lods: request.lods.into_iter().map(|l| LodSpec { source_path: l.source_path, smd: l.smd, dmx: l.dmx, triangles: l.triangles, vertices: l.vertices }).collect(),
        materials: request.materials.into_iter().map(|m| PropMaterialSpec { name: m.name, vmt: m.vmt, color: path(m.color), normal: path(m.normal), phongexponent: path(m.phongexponent), illum: path(m.illum), compression: if m.compression == "none" { source_formats::vtf_write::Compression::None } else { source_formats::vtf_write::Compression::Dxt } }).collect(),
        max_texture: request.max_texture, qc_extra: request.qc_extra, session: request.session,
    };
    let work = std::env::temp_dir().join("tf2-workbench-prop-build");
    let mounted = out.clone();
    let built = tauri::async_runtime::spawn_blocking({ let vpk = vpk.clone(); move || build(&vpk, &spec, &out, &work) }).await.map_err(|e| e.to_string())??;
    // the folder it went to is mounted (or read again), so that the prop shows in the prop browser and in the scene
    if let Ok(added) = vpk.mount_custom(&mounted, false) { let _ = keep_custom_content(&app, &state, &added); }
    Ok(PropBuildResult { folder: built.folder.to_string_lossy().into_owned(), files: built.files, log: built.log, millis: built.millis as u64 })
}

/// Builds an item into the zip the game's importer would write, in the importer's own folder (tf/workshop/import_source), and mounts it.
#[tauri::command]
pub async fn build_item(state: State<'_, AppState>, request: ItemBuildRequest) -> Result<ItemBuildResult, String> {
    use source_formats::itemcompile::{build, BlueSpec, ClassSpec, ItemSpec, LodSpec, MaterialSpec};
    let vpk = state.vpk()?;
    let tf = vpk.game_root().ok_or("TF2's game folder is unavailable")?.to_path_buf();
    let path = |p: Option<String>| p.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    let spec = ItemSpec {
        name: request.name, display_name: request.display_name, prefab: request.prefab, equip_region: request.equip_region,
        bodygroups: request.bodygroups, paintable: request.paintable, icon: PathBuf::from(request.icon),
        compression: if request.compression == "none" { source_formats::vtf_write::Compression::None } else { source_formats::vtf_write::Compression::Dxt },
        classes: request.classes.into_iter().map(|c| ClassSpec { folder: c.folder, qc_extra: c.qc_extra, lod_commands: c.lod_commands, lods: c.lods.into_iter().map(|l| LodSpec { source_path: l.source_path, smd: l.smd, dmx: l.dmx, triangles: l.triangles, vertices: l.vertices }).collect() }).collect(),
        materials: request.materials.into_iter().map(|m| MaterialSpec { source_name: m.source_name, vmt: m.vmt, color: path(m.color), normal: path(m.normal), phongexponent: path(m.phongexponent), illum: path(m.illum), blue: m.blue.map(|b| BlueSpec { vmt: b.vmt, color: path(b.color) }) }).collect(),
    };
    let out = tf.join("workshop").join("import_source");
    let work = std::env::temp_dir().join("tf2-workbench-item-build");
    let built = tauri::async_runtime::spawn_blocking(move || build(&vpk, &spec, &out, &work)).await.map_err(|e| e.to_string())??;
    state.refresh_workshop()?;
    Ok(ItemBuildResult { zip: built.zip.to_string_lossy().into_owned(), session: built.session.to_string_lossy().into_owned(), log: built.log, millis: built.millis as u64 })
}

/// Shows a file in the file explorer (an item's archive), or opens a folder (where a prop was built).
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        use std::os::windows::process::CommandExt;
        let plain = p.canonicalize().unwrap_or(p).to_string_lossy().replace(r"\?\", "").replace('/', "\\");
        std::process::Command::new("explorer").raw_arg(format!("\"{plain}\"")).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    if !p.exists() || p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("zip") { return Err("Not an item archive".into()); }
    // explorer wants one backslashed path, quoted, with no \\? prefix; anything else and it opens Documents instead
    use std::os::windows::process::CommandExt;
    let plain = p.canonicalize().unwrap_or(p).to_string_lossy().replace(r"\\?\", "").replace('/', "\\");
    std::process::Command::new("explorer").raw_arg(format!("/select,\"{plain}\"")).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// The text of a prop's session file (the `.prop.txt` the prop compiler writes beside the models folder).
#[tauri::command]
pub fn read_prop_session(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.to_string_lossy().to_ascii_lowercase().ends_with(".txt") { return Err("not a prop session file (.txt)".into()); }
    let len = std::fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?.len();
    if len > 4 << 20 { return Err(format!("{path} is larger than 4 MB")); }
    std::fs::read_to_string(&p).map_err(|e| format!("{path}: {e}"))
}

/// Rescans the workshop importer's zips (new, rebuilt or removed ones) without reindexing the game.
#[tauri::command]
pub fn refresh_workshop(state: State<'_, AppState>) -> Result<(), String> {
    state.refresh_workshop()
}

/// A value that changes when the importer's zips do, so the interface can tell when a refresh is due.
#[tauri::command]
pub fn workshop_stamp(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.vpk()?.workshop_stamp().to_string())
}

#[tauri::command]
pub fn find_tf2() -> Option<String> {
    steam::find_tf2().map(|p| p.to_string_lossy().into_owned())
}

/// Indexes every `*_dir.vpk` in the given `tf` folder (runs off the UI thread).
#[tauri::command]
pub async fn index_tf2(app: tauri::AppHandle, state: State<'_, AppState>, tf_dir: String) -> Result<IndexDto, String> {
    let dir = PathBuf::from(&tf_dir);
    if !steam::is_tf_dir(&dir) {
        return Err(format!("{tf_dir} does not contain tf2_misc_dir.vpk; pick the TF2 'tf' folder"));
    }
    let started = std::time::Instant::now();
    let vpk = tauri::async_runtime::spawn_blocking(move || VpkSet::open_folder(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let s = vpk.stats();
    // the custom effects the user imported are mounted over the game's files, like the workshop's zips
    if let Ok(dir) = effects_dir(&app) { vpk.set_effects_dir(dir); }
    // the addons of the game's own custom folder, and the folders the user mounted earlier
    let _ = vpk.mount_custom(&PathBuf::from(&tf_dir).join("custom"), true);
    for saved in saved_custom_content(&app) { let _ = vpk.mount_custom(&saved, false); }
    state.set_vpk(vpk);
    Ok(IndexDto {
        tf_dir,
        total_files: s.total_files,
        total_bytes: s.total_bytes,
        millis: started.elapsed().as_millis(),
        archives: s
            .archives
            .into_iter()
            .map(|a| ArchiveDto { name: a.name, files: a.files, bytes: a.bytes })
            .collect(),
    })
}

#[tauri::command]
pub fn list_dir(state: State<'_, AppState>, dir: String) -> Result<DirDto, String> {
    let l = state.vpk()?.list_dir(&dir);
    Ok(DirDto {
        dirs: l.dirs,
        files: l.files.into_iter().map(|f| FileDto { name: f.name, size: f.size }).collect(),
    })
}

#[tauri::command]
pub fn search_paths(state: State<'_, AppState>, query: String, limit: usize) -> Result<Vec<String>, String> {
    Ok(state.vpk()?.search(&query, limit).into_iter().map(String::from).collect())
}

/// The folder the pictures kept on disk are in: `cache` beside the program (it goes where the program goes, and goes with it), or, when that
/// folder cannot be written to (the program is in Program Files), the cache folder of the user's profile. The test profile has its own.
fn thumb_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    if let Some(dir) = std::env::var_os("TF2_WORKBENCH_CONFIG_DIR") { return Ok(PathBuf::from(dir).join("cache")); }
    static BESIDE: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    let beside = BESIDE.get_or_init(|| {
        let dir = std::env::current_exe().ok()?.parent()?.join("cache");
        std::fs::create_dir_all(&dir).ok()?;
        let probe = dir.join(".write-test");
        std::fs::write(&probe, b"x").ok()?;
        let _ = std::fs::remove_file(&probe);
        Some(dir)
    });
    match beside {
        Some(dir) => Ok(dir.clone()),
        None => app.path().app_cache_dir().map_err(|e| e.to_string()),
    }
}

/// The state of the game's archives, worked out once for each game folder.
fn archive_stamp(vpk: &VpkSet) -> u64 {
    static STAMPS: std::sync::Mutex<Vec<(PathBuf, u64)>> = std::sync::Mutex::new(Vec::new());
    let root = vpk.game_root().map(PathBuf::from).unwrap_or_default();
    let mut stamps = STAMPS.lock().unwrap();
    if let Some((_, s)) = stamps.iter().find(|(r, _)| *r == root) { return *s; }
    let s = vpk.archive_stamp();
    stamps.push((root, s));
    s
}

/// A picture kept on disk (an item's icon, a prop's thumbnail), or nothing (an empty body) when there is none.
#[tauri::command]
pub fn thumb_cache_get(app: tauri::AppHandle, state: State<'_, AppState>, kind: String, key: String) -> Result<tauri::ipc::Response, String> {
    let vpk = state.vpk()?;
    let bytes = crate::thumbcache::get(&thumb_root(&app)?, archive_stamp(&vpk), &kind, &key).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

/// Keeps a picture (the raw body) of a file of the game's archives: `kind` and `key` are in the headers (percent-encoded). A file that is not in
/// the archives (a workshop item) is not kept: it can change under the same name.
#[tauri::command]
pub fn thumb_cache_put(app: tauri::AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected a raw body".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(percent_decode).ok_or_else(|| format!("missing {name} header"));
    let (kind, key) = (header("kind")?, header("key")?);
    let vpk = state.vpk()?;
    if vpk.source_game(&key).is_empty() { return Ok(()); }
    crate::thumbcache::put(&thumb_root(&app)?, archive_stamp(&vpk), &kind, &key, bytes)
}

/// The folders of loose files (addons, the output of the prop compiler) the user mounted: kept between launches.
fn custom_content_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    config_dir(app).ok().map(|d| d.join("custom_content.json"))
}

/// A path without the `\?` prefix canonicalizing puts on Windows (what is shown and kept).
fn plain_path(p: &std::path::Path) -> PathBuf {
    let text = p.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

fn saved_custom_content(app: &tauri::AppHandle) -> Vec<PathBuf> {
    custom_content_file(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok()).unwrap_or_default().into_iter().map(PathBuf::from).collect()
}

fn save_custom_content(app: &tauri::AppHandle, roots: &[PathBuf]) -> Result<(), String> {
    let file = custom_content_file(app).ok_or("no config folder")?;
    if let Some(dir) = file.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let text: Vec<String> = roots.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    std::fs::write(file, serde_json::to_vec_pretty(&text).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct CustomDto { name: String, root: String, auto: bool, files: usize, models: usize }

fn custom_dto(i: source_formats::vpk::CustomInfo) -> CustomDto {
    CustomDto { name: i.name, root: plain_path(&i.root).to_string_lossy().into_owned(), auto: i.auto, files: i.files, models: i.models }
}

/// Remembers the folders that were mounted for the next launch, and forgets what was read from files that may have changed under them.
fn keep_custom_content(app: &tauri::AppHandle, state: &State<'_, AppState>, added: &[source_formats::vpk::CustomInfo]) -> Result<(), String> {
    let mut saved = saved_custom_content(app);
    for a in added { let root = plain_path(&a.root); if !a.auto && !saved.contains(&root) { saved.push(root); } }
    save_custom_content(app, &saved)?;
    state.forget_read_files();
    Ok(())
}

/// The mounted folders of loose files.
#[tauri::command]
pub fn list_custom_content(state: State<'_, AppState>) -> Result<Vec<CustomDto>, String> {
    Ok(state.vpk()?.custom_mounts().into_iter().map(custom_dto).collect())
}

/// Mounts a folder of loose files (an addon, or a folder of them) and keeps it for the next launch; returns what was mounted.
#[tauri::command]
pub async fn add_custom_content(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<Vec<CustomDto>, String> {
    let vpk = state.vpk()?;
    let target = PathBuf::from(&path);
    let added = tauri::async_runtime::spawn_blocking({ let vpk = vpk.clone(); move || vpk.mount_custom(&target, false) }).await.map_err(|e| e.to_string())??;
    keep_custom_content(&app, &state, &added)?;
    Ok(added.into_iter().map(custom_dto).collect())
}

/// Takes a mounted folder away (and from the next launch).
#[tauri::command]
pub fn remove_custom_content(app: tauri::AppHandle, state: State<'_, AppState>, root: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    state.vpk()?.unmount_custom(&root);
    let mut saved = saved_custom_content(&app);
    let canonical = std::fs::canonicalize(&root).map(|c| plain_path(&c)).unwrap_or_else(|_| root.clone());
    saved.retain(|p| *p != root && *p != canonical);
    save_custom_content(&app, &saved)
}

/// The models of the archives with the game each comes from (`tf2`, `hl2`...): what the prop browser lists.
#[derive(Serialize)]
pub struct ModelEntry { path: String, game: String }

#[tauri::command]
pub fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelEntry>, String> {
    let vpk = state.vpk()?;
    let mut out: Vec<ModelEntry> = vpk.search(".mdl", 400_000).into_iter().filter(|p| p.ends_with(".mdl")).map(|p| ModelEntry { path: p.to_string(), game: vpk.source_game(p).to_string() }).collect();
    // and the models of the folders the user mounted, each under the name of its folder
    out.extend(vpk.custom_models().into_iter().map(|(path, folder)| ModelEntry { path, game: format!("custom:{folder}") }));
    Ok(out)
}

/// Parses (or fetches from cache) a model and returns it in the binary payload format.
#[tauri::command]
pub async fn load_model(
    state: State<'_, AppState>,
    path: String,
    lod: Option<usize>,
) -> Result<tauri::ipc::Response, String> {
    let model = state.model_lod(&path, lod.unwrap_or(0))?;
    Ok(tauri::ipc::Response::new(crate::payload::encode(&model)))
}

#[tauri::command]
pub fn file_preview(state: State<'_, AppState>, path: String, max: usize) -> Result<PreviewDto, String> {
    let vpk = state.vpk()?;
    let size = vpk.size_of(&path).ok_or_else(|| format!("not found: {path}"))?;
    let head = vpk.read_prefix(&path, max).map_err(|e| e.to_string())?;
    Ok(PreviewDto { size, head })
}

/// Reads particle definitions, texture sheets, or model attachment metadata from the mounted game.
#[tauri::command]
pub async fn load_particle_asset(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    let allowed = (path.starts_with("particles/") && path.ends_with(".pcf"))
        || (path.starts_with("materials/") && (path.ends_with(".vtf") || path.ends_with(".vmt")))
        || (path.starts_with("models/") && path.ends_with(".mdl"));
    if !allowed || path.split('/').any(|part| part == "..") {
        return Err("Not a particle preview asset".into());
    }
    let vpk = state.vpk()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || vpk.read(&path).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn particle_system_file(state: State<'_,AppState>, system: String) -> Result<String,String> {
    let files=state.particle_files()?;
    files.get(&system).cloned().or_else(||files.iter().find(|(name,_)|name.eq_ignore_ascii_case(&system)).map(|(_,file)|file.clone()))
        .ok_or_else(|| format!("Particle system not installed: {system}"))
}

#[tauri::command]
pub async fn get_weapon_profile(state: State<'_,AppState>, item_id: u32, class: String, team: u32) -> Result<serde_json::Value,String> {
    let vpk = state.vpk()?;
    tauri::async_runtime::spawn_blocking(move || weapon_profile(&vpk,item_id,&class,team)).await.map_err(|e| e.to_string())?
}

/// Read the game's own unusual categories and localized names, rather than maintaining a list.
#[tauri::command]
pub async fn list_unusual_effects(state: State<'_, AppState>) -> Result<Vec<UnusualEffectDto>, String> {
    let vpk = state.vpk()?;
    tauri::async_runtime::spawn_blocking(move || unusual_effects(&vpk)).await.map_err(|e| e.to_string())?
}

/// Where the custom effect zips live (the user's imports).
pub fn effects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("effects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Where the files of a custom effect zip are unpacked for the native helper (which reads files, not zips).
pub fn effects_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> { Ok(config_dir(app)?.join("effects_cache")) }

#[derive(Serialize)]
pub struct CustomPcfDto { file: String, systems: Vec<String> }

#[derive(Serialize)]
pub struct CustomEffectDto {
    /// The zip's name without `.zip`.
    name: String,
    /// When it was imported (milliseconds since 1970).
    added: u64,
    bytes: u64,
    pcfs: Vec<CustomPcfDto>,
}

fn custom_effects(vpk: &VpkSet) -> Vec<CustomEffectDto> {
    let mut out = Vec::new();
    for zip in vpk.effect_archives() {
        let Some(name) = zip.path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
        let meta = std::fs::metadata(&zip.path).ok();
        let added = meta.as_ref().and_then(|m| m.created().or_else(|_| m.modified()).ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
        let mut files: Vec<&str> = zip.paths().filter(|p| p.starts_with("particles/") && p.ends_with(".pcf")).collect();
        files.sort_unstable();
        let pcfs = files.into_iter().filter_map(|file| {
            let systems = pcf_system_names(&zip.read(file)?)?;
            Some(CustomPcfDto { file: file.to_owned(), systems })
        }).collect();
        out.push(CustomEffectDto { name, added, bytes: meta.map_or(0, |m| m.len()), pcfs });
    }
    out
}

/// The custom effect zips that are mounted, with the particle systems of their PCF files.
#[tauri::command]
pub async fn list_custom_effects(state: State<'_, AppState>) -> Result<Vec<CustomEffectDto>, String> {
    let vpk = state.vpk()?;
    tauri::async_runtime::spawn_blocking(move || Ok(custom_effects(&vpk))).await.map_err(|e| e.to_string())?
}

/// Adds a custom effect zip (a game-like folder tree with `particles/*.pcf` and the `materials` they use) to the app's own folder of them
/// and mounts it. A zip of the same name is replaced.
#[tauri::command]
pub async fn import_effect_zip(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<Vec<CustomEffectDto>, String> {
    let source = PathBuf::from(&path);
    if source.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("zip") { return Err("Pick a .zip file".into()); }
    // the zip is kept under a plain name (no spaces at the ends, nothing a path would not take)
    let stem: String = source.file_stem().ok_or("Not a file")?.to_string_lossy().trim().chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' }).collect();
    let stem = stem.trim().trim_matches('.').to_owned();
    if stem.is_empty() { return Err("Not a usable file name".into()); }
    let dest = effects_dir(&app)?.join(format!("{stem}.zip"));
    let cache = effects_cache_dir(&app)?;
    let vpk = state.vpk()?;
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let zip = source_formats::zipfs::ZipFile::open_effect(&source).map_err(|e| format!("Cannot read the zip: {e}"))?;
        let has_systems = zip.paths().filter(|p| p.starts_with("particles/") && p.ends_with(".pcf"))
            .any(|p| zip.read(p).and_then(|b| pcf_system_names(&b)).is_some_and(|s| !s.is_empty()));
        if !has_systems { return Err("This zip has no particles/*.pcf with particle systems in it".into()); }
        if source != dest { std::fs::copy(&source, &dest).map_err(|e| format!("Cannot copy the zip: {e}"))?; }
        // what was unpacked from an earlier zip of that name is stale
        let stem = dest.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if let Ok(read) = std::fs::read_dir(&cache) {
            for e in read.flatten() {
                if e.file_name().to_string_lossy().starts_with(&format!("{stem}-")) { let _ = std::fs::remove_dir_all(e.path()); }
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?;
    result?;
    state.refresh_effects()?;
    Ok(custom_effects(&vpk))
}

/// Removes an imported custom effect zip (by its name without `.zip`).
#[tauri::command]
pub async fn remove_custom_effect(app: tauri::AppHandle, state: State<'_, AppState>, name: String) -> Result<Vec<CustomEffectDto>, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") { return Err("Not an effect name".into()); }
    let dir = effects_dir(&app)?;
    let zip = dir.join(format!("{name}.zip"));
    if zip.is_file() { std::fs::remove_file(&zip).map_err(|e| e.to_string())?; }
    if let Ok(read) = std::fs::read_dir(effects_cache_dir(&app)?) {
        for e in read.flatten() {
            if e.file_name().to_string_lossy().starts_with(&format!("{name}-")) { let _ = std::fs::remove_dir_all(e.path()); }
        }
    }
    state.refresh_effects()?;
    Ok(custom_effects(&*state.vpk()?))
}

/// Loads a material (VMT) and its decoded base texture, cached after first use.
#[tauri::command]
pub async fn load_material(
    state: State<'_, AppState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = state.material_payload(&path)?;
    Ok(tauri::ipc::Response::new(bytes.as_ref().clone()))
}

/// The frames of an animated texture (see `material::texture_frames`).
#[tauri::command]
pub async fn load_texture_frames(state: State<'_, AppState>, path: String, max_frames: u32) -> Result<tauri::ipc::Response, String> {
    let vpk = state.vpk()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || source_formats::material::texture_frames(&vpk, &path, max_frames as usize).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Sequences and pose parameters of a model (JSON bytes).
#[tauri::command]
pub async fn list_sequences(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    let set = state.anim_set(&path)?;
    Ok(tauri::ipc::Response::new(crate::payload::encode_anim_info(&set)))
}


/// Bakes a sequence at its native frame rate with the given encoded (0..1) pose parameters. `blend` (default on) plays a taunt over the
/// class's stand pose as the game does; off, it is sampled alone, as the animation file holds it.
#[tauri::command]
pub async fn bake_sequence(
    state: State<'_, AppState>,
    path: String,
    sequence: usize,
    params: Vec<f32>,
    target_path: Option<String>,
    blend: Option<bool>,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(workbench_core::dispatch::bake_sequence(&state, &path, sequence, &params, target_path.as_deref(), blend)?))
}

/// Source-only Workshop taunts are compiled on demand into the app's cache.
#[tauri::command]
pub fn taunt_cache_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("workshop-taunts").to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn clear_taunt_cache(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("workshop-taunts");
    let result = tauri::async_runtime::spawn_blocking(move || source_formats::workshop::cleanup_cache(&cache, None))
        .await.map_err(|e| e.to_string())??;
    Ok(serde_json::json!({ "removed": result.removed, "deferred": result.deferred, "bytes": result.bytes }))
}

#[tauri::command]
pub async fn prepare_workshop_taunt(app: tauri::AppHandle, state: State<'_, AppState>, item_id: u32, class: String) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let vpk = state.vpk()?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("workshop-taunts");
    let ready = tauri::async_runtime::spawn_blocking(move || source_formats::workshop::prepare(&vpk, item_id, &class, &cache))
        .await.map_err(|e| e.to_string())??;
    Ok(serde_json::json!({ "animation": ready.animation, "sequence": ready.sequence, "prop": ready.prop }))
}

/// The cosmetics catalog (JSON bytes), from `items_game.txt` and `tf_english.txt`.
#[tauri::command]
pub async fn list_items(state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let bytes = state.items_payload()?;
    Ok(tauri::ipc::Response::new(bytes.as_ref().clone()))
}

/// The stored app settings.
#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> crate::settings::Settings {
    crate::settings::load(&app)
}

/// Stores the app settings. Settings that are applied when the window opens need a restart.
#[tauri::command]
pub fn set_settings(app: tauri::AppHandle, settings: crate::settings::Settings) -> Result<(), String> {
    crate::settings::save(&app, &settings)
}

/// Only these kinds of files can be written or read through the commands below (screenshots and scene files).
fn checked_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") | Some("json") => Ok(p),
        _ => Err(format!("refusing to touch {path}: only .png and .json files")),
    }
}

/// Where a binary file may be written: a screenshot (.png) or a layered export (.psd).
fn output_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") | Some("json") | Some("psd") | Some("mp4") | Some("webm") | Some("gif") => Ok(p),
        _ => Err(format!("refusing to write {path}: only .png, .json, .psd, .mp4, .webm and .gif files")),
    }
}

/// Writes a text file (a scene) chosen with the save dialog.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(checked_path(&path)?, contents).map_err(|e| e.to_string())
}

/// Reads a text file (a scene) chosen with the open dialog.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(checked_path(&path)?).map_err(|e| e.to_string())
}

/// The source files the item compiler reads from the artist's folders: models and textures, nothing else.
fn source_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("fbx") | Some("smd") | Some("dmx") | Some("tga") => Ok(p),
        _ => Err(format!("refusing to read {path}: only .fbx, .smd, .dmx and .tga files")),
    }
}

/// Reads a source model or texture for the item compiler (at most 256 MB).
#[tauri::command]
pub async fn read_source_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let p = source_path(&path)?;
        let len = std::fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?.len();
        if len > 256 << 20 { return Err(format!("{path} is larger than 256 MB")); }
        std::fs::read(&p).map_err(|e| format!("{path}: {e}"))
    }).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The model and texture files (.fbx, .smd, .dmx, .tga) that share a folder with a source file: the compiler fills in the LODs and textures that go with the one picked.
#[tauri::command]
pub fn source_siblings(path: String) -> Vec<String> {
    let Ok(p) = source_path(&path) else { return Vec::new() };
    let Some(dir) = p.parent() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries.filter_map(|e| e.ok()).filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| { let l = n.to_ascii_lowercase(); l.ends_with(".fbx") || l.ends_with(".smd") || l.ends_with(".dmx") || l.ends_with(".tga") })
        .take(5000).collect()
}

/// When a source file was last modified (milliseconds since the epoch), or null while it is missing: the compiler reloads what changed.
#[tauri::command]
pub fn source_stamp(path: String) -> Option<u64> {
    let p = source_path(&path).ok()?;
    let modified = std::fs::metadata(p).ok()?.modified().ok()?;
    modified.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// The folder of the backpack icons the icon studio makes: `icons` next to the program (so it travels with the app), or in the app's config
/// folder when that place cannot be written to.
fn icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let beside = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("icons")));
    if let Some(d) = beside {
        if std::fs::create_dir_all(&d).is_ok() && writable(&d) { return Ok(d); }
    }
    let config = config_dir(app)?.join("icons");
    std::fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    Ok(config)
}

/// The importer's session folder (tf/workshop/import_source), where the open dialog of the compiler starts.
#[tauri::command]
pub fn import_source_dir(state: State<'_, AppState>) -> Result<String, String> {
    let tf = state.vpk()?.game_root().ok_or("TF2's game folder is unavailable")?.to_path_buf();
    Ok(tf.join("workshop").join("import_source").to_string_lossy().into_owned())
}

/// Reads an importer session file (a .txt) for the compiler's Open.
#[tauri::command]
pub fn read_item_session(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("txt") { return Err("a session file is a .txt".into()); }
    let bytes = std::fs::read(&p).map_err(|e| format!("{path}: {e}"))?;
    if bytes.len() > 4 << 20 { return Err("that file is too large to be a session".into()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Saves a backpack icon (the raw request body, a 512x512 32 bit TGA) as `<name>_icon.tga` in the tool's `icons` folder; the `name` header is
/// the item's name (percent-encoded). Returns the path.
#[tauri::command]
pub fn save_item_icon(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected a raw body".into()) };
    let name = percent_decode(request.headers().get("name").and_then(|v| v.to_str().ok()).ok_or("missing name header")?);
    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') { return Err(format!("\"{name}\" is not a usable item name")); }
    // a TGA header: uncompressed true colour, 512x512, 32 bits
    if bytes.len() != 18 + 512 * 512 * 4 || bytes[2] != 2 || bytes[16] != 32 || bytes[12] != 0 || bytes[13] != 2 || bytes[14] != 0 || bytes[15] != 2 { return Err("not a 512x512 32 bit TGA".into()); }
    let path = icons_dir(&app)?.join(format!("{name}_icon.tga"));
    std::fs::write(&path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Writes the raw request body (a PNG screenshot) to the path in the `path` header (percent-encoded).
#[tauri::command]
pub fn write_binary_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected a raw body".into()) };
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("missing path header")?;
    let decoded = percent_decode(path);
    std::fs::write(output_path(&decoded)?, bytes).map_err(|e| e.to_string())
}

/// Writes a copy of an artist's model beside the original (the adjusted copy, or a temporary LOD): the raw body to the path in the `path`
/// header (percent-encoded), which has to be an .fbx whose name starts with `adjusted_` or `temp_` (nothing else is written this way, and no
/// file of another name is replaced).
#[tauri::command]
pub fn write_adjusted_model(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected a raw body".into()) };
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("missing path header")?;
    let path = PathBuf::from(percent_decode(path));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_ascii_lowercase();
    let is_fbx = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("fbx"));
    if !is_fbx || !(name.starts_with("adjusted_") || name.starts_with("temp_")) { return Err(format!("refusing to write {}: only adjusted_*.fbx and temp_*.fbx files", path.display())); }
    std::fs::write(&path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The folder of the app's settings, session and saved things. `TF2_WORKBENCH_CONFIG_DIR` puts it somewhere else, so a test copy of the app
/// (which would otherwise share, and overwrite, the real session) can run on its own.
pub fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    if let Some(dir) = std::env::var_os("TF2_WORKBENCH_CONFIG_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn session_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    config_dir(app).ok().map(|d| d.join("session.json"))
}

/// The scene saved when the app was last used (JSON text), if any.
#[tauri::command]
pub fn load_session(app: tauri::AppHandle) -> Option<String> {
    std::fs::read_to_string(session_path(&app)?).ok()
}

/// Stores the current scene as the session to restore at the next start.
#[tauri::command]
pub fn save_session(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let p = session_path(&app).ok_or("no config folder")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, contents).map_err(|e| e.to_string())
}

/// The folder of the saved poses: `poses` next to the program, so the folder travels with the app and poses can be shared by copying
/// files in and out of it. When that place cannot be written to (a program installed under Program Files, say) the app's config
/// folder is used instead. Poses saved there by earlier versions are copied over once.
fn poses_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = config_dir(app)?.join("poses");
    let beside = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("poses")));
    let dir = match beside {
        Some(d) if std::fs::create_dir_all(&d).is_ok() && writable(&d) => d,
        _ => {
            std::fs::create_dir_all(&config).map_err(|e| e.to_string())?;
            return Ok(config);
        }
    };
    static MIGRATED: std::sync::Once = std::sync::Once::new();
    MIGRATED.call_once(|| {
        if let Ok(old) = std::fs::read_dir(&config) {
            for e in old.filter_map(|e| e.ok()) {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("json") {
                    let target = dir.join(e.file_name());
                    if !target.exists() {
                        let _ = std::fs::copy(&p, &target);
                    }
                }
            }
        }
    });
    Ok(dir)
}

fn writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".write-test");
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// A pose name as a file stem: letters, digits, spaces, `-`, `_` and `.` only.
fn pose_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    let ok = !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'));
    if !ok {
        return Err("a pose name may use letters, digits, spaces, - _ and . (up to 80 characters)".into());
    }
    Ok(poses_dir(app)?.join(format!("{name}.json")))
}

/// Every saved pose with its file contents (they are small: a pose and a thumbnail), newest first, for the library's thumbnails.
#[tauri::command]
pub fn read_poses(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut found: Vec<(std::time::SystemTime, String, String)> = std::fs::read_dir(poses_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                return None;
            }
            let stem = p.file_stem()?.to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&p).ok()?;
            Some((e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), stem, text))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().map(|(_, n, t)| (n, t)).collect())
}

/// Shows the poses folder in the file explorer and returns its path.
#[tauri::command]
pub fn open_poses_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = poses_dir(&app)?;
    #[cfg(windows)]
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Names of the saved poses, newest first.
#[tauri::command]
pub fn list_poses(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut found: Vec<(std::time::SystemTime, String)> = std::fs::read_dir(poses_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                return None;
            }
            let stem = p.file_stem()?.to_string_lossy().into_owned();
            Some((e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), stem))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().map(|(_, n)| n).collect())
}

#[tauri::command]
pub fn save_pose(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    std::fs::write(pose_file(&app, &name)?, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_pose(app: tauri::AppHandle, name: String) -> Result<String, String> {
    std::fs::read_to_string(pose_file(&app, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pose(app: tauri::AppHandle, name: String) -> Result<(), String> {
    std::fs::remove_file(pose_file(&app, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_overlay_font(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    if !["resource/tf.ttf", "resource/tf2.ttf", "resource/tf2build.ttf", "resource/tf2secondary.ttf", "resource/tf2professor.ttf", "resource/tfd.ttf", "resource/ocra.ttf"].contains(&path.as_str()) {
        return Err("Not a supported TF2 overlay font".into());
    }
    let vpk = state.vpk()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || vpk.read(&path).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Like poses, lighting presets travel with the executable when its folder is writable.
fn light_setups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let beside = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("light-setups")));
    if let Some(dir) = beside {
        if std::fs::create_dir_all(&dir).is_ok() && writable(&dir) { return Ok(dir); }
    }
    let dir = config_dir(app)?.join("light-setups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn light_setup_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 80 || name.starts_with('.')
        || !name.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.')) {
        return Err("a light setup name may use letters, digits, spaces, - _ and . (up to 80 characters)".into());
    }
    Ok(light_setups_dir(app)?.join(format!("{name}.json")))
}

#[tauri::command]
pub fn read_light_setups(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut found: Vec<(std::time::SystemTime, String, String)> = std::fs::read_dir(light_setups_dir(&app)?)
        .map_err(|e| e.to_string())?.filter_map(|e| e.ok()).filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") { return None; }
            Some((e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH),
                p.file_stem()?.to_string_lossy().into_owned(), std::fs::read_to_string(&p).ok()?))
        }).collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().map(|(_, n, t)| (n, t)).collect())
}

#[tauri::command]
pub fn save_light_setup(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| e.to_string())?;
    std::fs::write(light_setup_file(&app, &name)?, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_light_setup(app: tauri::AppHandle, name: String) -> Result<(), String> {
    std::fs::remove_file(light_setup_file(&app, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_light_setups_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = light_setups_dir(&app)?;
    #[cfg(windows)]
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Evaluates poses live (for play mode): each request is `[sequence, cycle, layers, base layers, arm base]`, the layers being `[sequence, cycle, weight]`
/// triples of additive sequences played over the first (the landing, an attack, a gesture), the first `base layers` of them belonging
/// to the movement itself (the landing); with an `arm base` sequence (or -1) the left arm comes from the same layers played over that
/// sequence instead (the standing pose, for gestures made while crouching); the reply is, per request, the local bone positions (`bones * 3` f32)
/// followed by the rotations (`bones * 4` f32, x y z w), all little endian. `params` are the encoded (0..1) pose parameters.
/// With `pin_params` the feet are planted where they stand under those parameters (the movement without the aim): the legs bend
/// to reach them like the game's foot IK, so aiming does not lift the character off the floor.
#[tauri::command]
pub async fn eval_poses(
    state: State<'_, AppState>,
    path: String,
    requests: Vec<workbench_core::dispatch::PoseRequest>,
    params: Vec<f32>,
    pin_params: Option<Vec<f32>>,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(workbench_core::dispatch::eval_poses(&state, &path, requests, &params, pin_params.as_deref())?))
}

#[tauri::command]
pub fn player_gibs(state:State<'_,AppState>,path:String)->Result<serde_json::Value,String>{let vpk=state.vpk()?;gib_definitions(&vpk,&path)}
#[tauri::command]
pub fn model_physics(state:State<'_,AppState>,path:String)->Result<serde_json::Value,String>{ let vpk=state.vpk()?; workbench_core::game::model_physics(&vpk,&path) }
