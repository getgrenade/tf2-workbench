//! Valve Pak (VPK) v1/v2 reader. Merges any number of `*_dir.vpk` into one
//! case-insensitive virtual file system.

use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use crate::zipfs::ZipFile;

const SIGNATURE: u32 = 0x55aa1234;
const DIR_ARCHIVE: u16 = 0x7fff;

#[derive(Debug, thiserror::Error)]
pub enum VpkError {
    #[error("io error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{0}: not a VPK (bad signature)")]
    BadSignature(PathBuf),
    #[error("{path}: unsupported VPK version {version}")]
    BadVersion { path: PathBuf, version: u32 },
    #[error("{0}: truncated or corrupt directory tree")]
    Corrupt(PathBuf),
    #[error("file not found in VPK: {0}")]
    NotFound(String),
}

fn io_err(path: &Path) -> impl FnOnce(std::io::Error) -> VpkError + '_ {
    move |source| VpkError::Io { path: path.to_path_buf(), source }
}

struct DirInfo {
    path: PathBuf,
    /// Archive file name prefix, e.g. `tf2_misc` for `tf2_misc_dir.vpk`.
    base: String,
    /// Offset of embedded data (header + tree) inside the dir file.
    data_start: u64,
}

#[derive(Clone, Copy, Debug)]
struct Entry {
    dir: u16,
    archive: u16,
    offset: u32,
    length: u32,
    preload_off: u64,
    preload_len: u16,
}

impl Entry {
    fn size(&self) -> u64 {
        self.length as u64 + self.preload_len as u64
    }
}

#[derive(Clone, Debug)]
pub struct ArchiveStats {
    pub name: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Clone, Debug)]
pub struct IndexStats {
    pub total_files: usize,
    pub total_bytes: u64,
    pub archives: Vec<ArchiveStats>,
}

#[derive(Clone, Debug)]
pub struct FileItem {
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Debug, Default)]
pub struct DirListing {
    pub dirs: Vec<String>,
    pub files: Vec<FileItem>,
}

/// Where the files come from in the web build: a function that returns the bytes of a file (by its lowercase path) or nothing.
pub type RemoteRead = Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

pub struct VpkSet {
    /// The web build has no game folder: files are fetched one by one by this reader, and `sorted` is the list of what exists.
    remote: Option<RemoteRead>,
    /// While the web bake runs: the paths that were read or asked for, to be copied out of the game.
    recorded: Mutex<Option<BTreeSet<String>>>,
    /// Game folder (`tf`) searched for loose files before the VPKs, like the engine's search path.
    loose_root: Option<PathBuf>,
    dirs: Vec<DirInfo>,
    files: HashMap<String, Entry>,
    /// Lowercased full paths, sorted, for prefix browsing and search.
    sorted: Vec<String>,
    /// The workshop importer's zips (`tf/workshop/import_source`), mounted over the game's files: their `game\` folders serve models and
    /// materials of cosmetics that are not in the game yet.
    workshop: RwLock<Mount>,
    /// The importer's folder, rescanned by [`rescan_workshop`](VpkSet::rescan_workshop) without reindexing the game.
    workshop_dir: Option<PathBuf>,
    /// The folder of the custom effect zips (imported by the user), mounted after the importer's zips by the same rescan.
    effects_dir: RwLock<Option<PathBuf>>,
    /// Folders of loose files the user mounted (an addon, a map's content, the output of the prop compiler): what the game's archives do not
    /// have is read from them. The game's own files win over them, so an addon cannot change the game's props.
    custom: RwLock<Vec<CustomMount>>,
    /// Item zips the user dropped onto the view, mounted in place for this session (read-only; nothing is copied into the game folder).
    extra_item_zips: RwLock<Vec<PathBuf>>,
}

/// A folder of loose files with a `models/` and a `materials/` folder in it, indexed by the paths the game would ask for.
struct CustomMount {
    name: String,
    root: PathBuf,
    /// Found by itself (a folder of `tf/custom`) rather than chosen: it cannot be taken away.
    auto: bool,
    /// Lowercase path below the root (with /) to the file.
    files: HashMap<String, PathBuf>,
}

/// What is known of a mounted folder.
#[derive(Debug, Clone)]
pub struct CustomInfo {
    pub name: String,
    pub root: PathBuf,
    pub auto: bool,
    pub files: usize,
    pub models: usize,
}

/// The most files one folder may bring (a folder of a whole game is not an addon).
const CUSTOM_FILE_LIMIT: usize = 300_000;

fn walk_custom(dir: &Path, base: &Path, depth: u32, out: &mut HashMap<String, PathBuf>) {
    if depth > 16 || out.len() >= CUSTOM_FILE_LIMIT { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() { walk_custom(&path, base, depth + 1, out); }
        else if kind.is_file() {
            if let Ok(rel) = path.strip_prefix(base) {
                out.insert(rel.to_string_lossy().replace('\\', "/").to_ascii_lowercase(), path);
            }
        }
    }
}

fn has_content(dir: &Path) -> bool { ["models", "materials"].iter().any(|d| dir.join(d).is_dir()) }

/// The mounted workshop zips and the game-relative paths they serve.
#[derive(Default)]
struct Mount {
    zips: Vec<ZipFile>,
    compiled: HashMap<String, PathBuf>,
    /// Game-relative path -> index into `zips`.
    files: HashMap<String, usize>,
    /// The indexes of `zips` that are custom effect zips.
    effect_zips: Vec<usize>,
}

/// The zips under `dir` (a folder's own first, then its subfolders, a few levels deep).
fn workshop_zips(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    for p in entries.iter().filter(|p| p.is_file() && p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("zip"))) {
        out.push(p.clone());
    }
    if depth < 3 {
        for p in entries.iter().filter(|p| p.is_dir()) {
            workshop_zips(p, out, depth + 1);
        }
    }
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn cstr(&mut self) -> Option<String> {
        let rest = self.buf.get(self.pos..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        self.pos += end + 1;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }
    fn u16(&mut self) -> Option<u16> {
        let b = self.buf.get(self.pos..self.pos + 2)?;
        self.pos += 2;
        Some(u16::from_le_bytes(b.try_into().unwrap()))
    }
    fn u32(&mut self) -> Option<u32> {
        let b = self.buf.get(self.pos..self.pos + 4)?;
        self.pos += 4;
        Some(u32::from_le_bytes(b.try_into().unwrap()))
    }
}

impl VpkSet {
    pub fn game_root(&self) -> Option<&Path> { self.loose_root.as_deref() }

    pub fn workshop_archives(&self) -> Vec<ZipFile> { self.workshop.read().unwrap().zips.clone() }

    /// Mount only explicitly compiled outputs; never write into the user's TF2 install.
    pub fn mount_compiled(&self, files: Vec<(String, PathBuf)>) {
        self.workshop.write().unwrap().compiled.extend(files);
    }

    fn compiled_path(&self, path: &str) -> Option<PathBuf> {
        self.workshop.read().unwrap().compiled.get(&Self::norm(path)).cloned()
    }
    /// Indexes every `*_dir.vpk` in `folder`.
    pub fn open_folder(folder: &Path) -> Result<Self, VpkError> {
        Self::open_folder_with(folder, true)
    }

    /// The game's own files only, without the workshop zips of the item importer (what the web build is made from).
    pub fn open_folder_game_only(folder: &Path) -> Result<Self, VpkError> {
        Self::open_folder_with(folder, false)
    }

    fn open_folder_with(folder: &Path, user_files: bool) -> Result<Self, VpkError> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(folder)
            .map_err(io_err(folder))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.to_ascii_lowercase().ends_with("_dir.vpk"))
            })
            .collect();
        dirs.sort();
        let mut set = Self::open_dirs(&dirs)?;
        // (the game's own loose files, such as the item schema, are part of the game: only the user's workshop zips are left out)
        set.loose_root = Some(folder.to_path_buf());
        if user_files {
            set.workshop_dir = Some(folder.join("workshop").join("import_source"));
            set.rescan_workshop();
        }
        // TF2's gameinfo.txt also mounts the Half-Life 2 content (`hl2/hl2_*.vpk`) after its own VPKs. Files of the
        // game folder win; the HL2 ones fill the gaps (e.g. hlmv's own `hlmv/cubemap` texture lives there).
        if let Some(hl2) = folder.parent().map(|p| p.join("hl2")).filter(|p| p.is_dir()) {
            let mut extra: Vec<PathBuf> = std::fs::read_dir(&hl2)
                .map_err(io_err(&hl2))?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.to_ascii_lowercase().ends_with("_dir.vpk")))
                .collect();
            extra.sort();
            for p in &extra {
                set.add_dir(p, true)?;
            }
            set.sorted = set.files.keys().cloned().collect();
            set.sorted.sort_unstable();
        }
        Ok(set)
    }

    /// Mounts every `*.zip` of the importer's folder (archive folders included) as an extra source of files, replacing what was mounted
    /// before: call it again to pick up zips that were added, rebuilt or removed. Zips that cannot be read are skipped, and a path served
    /// by an earlier zip is not replaced by a later one.
    pub fn rescan_workshop(&self) {
        let mut found = Vec::new();
        if let Some(dir) = &self.workshop_dir {
            workshop_zips(dir, &mut found, 0);
        }
        // then the item zips dropped onto the view: mounted in place like the importer's own, so their cosmetics show up under Workshop
        found.extend(self.extra_item_zips.read().unwrap().iter().cloned());
        let mut mount = Mount::default();
        for path in found {
            let Ok(zip) = ZipFile::open(&path) else { continue };
            let index = mount.zips.len();
            for p in zip.paths() {
                if p != "manifest.txt" {
                    mount.files.entry(p.to_string()).or_insert(index);
                }
            }
            mount.zips.push(zip);
        }
        // the custom effect zips: one folder, no subfolders; the game's own files are not replaced by them, the workshop's are not either
        if let Some(dir) = self.effects_dir.read().unwrap().clone() {
            let mut zips: Vec<PathBuf> = std::fs::read_dir(&dir).into_iter().flatten().filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_file() && p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("zip"))).collect();
            zips.sort();
            for path in zips {
                let Ok(zip) = ZipFile::open_effect(&path) else { continue };
                let index = mount.zips.len();
                for p in zip.paths() {
                    mount.files.entry(p.to_string()).or_insert(index);
                }
                mount.effect_zips.push(index);
                mount.zips.push(zip);
            }
        }
        *self.workshop.write().unwrap() = mount;
    }

    /// Adds item zips to be mounted in place (read-only) by their paths on disk: the next `rescan_workshop` mounts them, and their
    /// cosmetics show under Workshop. Session-only: nothing is copied into the game folder, and the mounts are gone on the next launch.
    pub fn add_item_zips(&self, paths: impl IntoIterator<Item = PathBuf>) {
        let mut extra = self.extra_item_zips.write().unwrap();
        for path in paths {
            if !extra.contains(&path) { extra.push(path); }
        }
    }

    /// Sets the folder of the custom effect zips and mounts them.
    pub fn set_effects_dir(&self, dir: PathBuf) {
        *self.effects_dir.write().unwrap() = Some(dir);
        self.rescan_workshop();
    }

    /// The mounted custom effect zips.
    pub fn effect_archives(&self) -> Vec<ZipFile> {
        let mount = self.workshop.read().unwrap();
        mount.effect_zips.iter().map(|&i| mount.zips[i].clone()).collect()
    }

    /// A value that changes when the importer's zips do (their number, sizes and modification times), to tell whether a rescan is needed.
    pub fn workshop_stamp(&self) -> u64 {
        let mut found = Vec::new();
        if let Some(dir) = &self.workshop_dir {
            workshop_zips(dir, &mut found, 0);
        }
        let mut h: u64 = 0xcbf29ce484222325;
        let mut mix = |n: u64| {
            for b in n.to_le_bytes() {
                h = (h ^ b as u64).wrapping_mul(0x100000001b3);
            }
        };
        mix(found.len() as u64);
        for p in &found {
            if let Ok(m) = std::fs::metadata(p) {
                mix(m.len());
                mix(m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64));
            }
        }
        h
    }

    /// The workshop schema file beside the zips (`items_game.txt`, or `workbench_items.txt`, in `tf/workshop/import_source`): what the
    /// zips cannot say about their items, in items_game's own words. None without one.
    pub fn workshop_schema(&self) -> Option<String> {
        let dir = self.workshop_dir.as_ref()?;
        ["items_game.txt", "workbench_items.txt"].iter().find_map(|name| std::fs::read(dir.join(name)).ok()).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The manifests (`manifest.txt`) of the mounted workshop zips, with the zip's file name.
    pub fn workshop_manifests(&self) -> Vec<(String, String)> {
        self.workshop
            .read()
            .unwrap()
            .zips
            .iter()
            .filter_map(|z| Some((z.path.file_stem()?.to_string_lossy().into_owned(), z.manifest()?)))
            .collect()
    }

    /// Path of a loose file on disk (`<game folder>/<path>`), if one exists. Loose files override
    /// the VPK contents, so most readers should go through [`read`](Self::read) instead.
    pub fn loose_path(&self, path: &str) -> Option<PathBuf> {
        let root = self.loose_root.as_ref()?;
        let p = root.join(Self::norm(path));
        p.is_file().then_some(p)
    }

    /// A set of files that are fetched on demand (the web build): `index` lists every path there is, `read` returns a file's bytes.
    pub fn remote(index: Vec<String>, read: RemoteRead) -> Self {
        let mut set = VpkSet { loose_root: None, dirs: Vec::new(), files: HashMap::new(), sorted: Vec::new(), workshop: RwLock::new(Mount::default()), workshop_dir: None, effects_dir: RwLock::new(None), custom: RwLock::new(Vec::new()), extra_item_zips: RwLock::new(Vec::new()), remote: Some(read), recorded: Mutex::new(None) };
        set.sorted = index.into_iter().map(|p| Self::norm(&p)).collect();
        set.sorted.sort_unstable();
        set.sorted.dedup();
        set
    }

    /// Starts (or, with `false`, stops and forgets) keeping the paths that are read or asked for.
    pub fn record(&self, on: bool) {
        *self.recorded.lock().unwrap() = on.then(BTreeSet::new);
    }

    /// The paths read or asked for (and found) since [`record`](Self::record) was switched on.
    pub fn recorded(&self) -> Vec<String> {
        self.recorded.lock().unwrap().as_ref().map(|s| s.iter().cloned().collect()).unwrap_or_default()
    }

    fn note(&self, path: &str) {
        if let Some(set) = self.recorded.lock().unwrap().as_mut() {
            set.insert(Self::norm(path));
        }
    }

    fn remote_has(&self, key: &str) -> bool {
        self.remote.is_some() && self.sorted.binary_search_by(|p| p.as_str().cmp(key)).is_ok()
    }

    pub fn open_dirs(paths: &[PathBuf]) -> Result<Self, VpkError> {
        let mut set = VpkSet { loose_root: None, dirs: Vec::new(), files: HashMap::new(), sorted: Vec::new(), workshop: RwLock::new(Mount::default()), workshop_dir: None, effects_dir: RwLock::new(None), custom: RwLock::new(Vec::new()), extra_item_zips: RwLock::new(Vec::new()), remote: None, recorded: Mutex::new(None) };
        for p in paths {
            set.add_dir(p, false)?;
        }
        set.sorted = set.files.keys().cloned().collect();
        set.sorted.sort_unstable();
        Ok(set)
    }

    /// Indexes one directory file. With `keep_existing`, paths that are already present keep their entry
    /// (the earlier mount has priority).
    fn add_dir(&mut self, path: &Path, keep_existing: bool) -> Result<(), VpkError> {
        let mut f = File::open(path).map_err(io_err(path))?;
        let mut head = [0u8; 12];
        f.read_exact(&mut head).map_err(io_err(path))?;
        let sig = u32::from_le_bytes(head[0..4].try_into().unwrap());
        let version = u32::from_le_bytes(head[4..8].try_into().unwrap());
        let tree_size = u32::from_le_bytes(head[8..12].try_into().unwrap()) as usize;
        if sig != SIGNATURE {
            return Err(VpkError::BadSignature(path.to_path_buf()));
        }
        let header_size = match version {
            1 => 12u64,
            2 => 28,
            _ => return Err(VpkError::BadVersion { path: path.to_path_buf(), version }),
        };
        f.seek(SeekFrom::Start(header_size)).map_err(io_err(path))?;
        let mut tree = vec![0u8; tree_size];
        f.read_exact(&mut tree).map_err(io_err(path))?;

        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let base = name
            .strip_suffix("_dir.vpk")
            .or_else(|| name.strip_suffix("_DIR.vpk"))
            .unwrap_or(name)
            .to_string();
        let dir_idx = self.dirs.len() as u16;
        self.dirs.push(DirInfo {
            path: path.to_path_buf(),
            base,
            data_start: header_size + tree_size as u64,
        });

        let corrupt = || VpkError::Corrupt(path.to_path_buf());
        let mut c = Cursor { buf: &tree, pos: 0 };
        loop {
            let ext = c.cstr().ok_or_else(corrupt)?;
            if ext.is_empty() {
                break;
            }
            loop {
                let dir = c.cstr().ok_or_else(corrupt)?;
                if dir.is_empty() {
                    break;
                }
                loop {
                    let file = c.cstr().ok_or_else(corrupt)?;
                    if file.is_empty() {
                        break;
                    }
                    let _crc = c.u32().ok_or_else(corrupt)?;
                    let preload_len = c.u16().ok_or_else(corrupt)?;
                    let archive = c.u16().ok_or_else(corrupt)?;
                    let offset = c.u32().ok_or_else(corrupt)?;
                    let length = c.u32().ok_or_else(corrupt)?;
                    if c.u16().ok_or_else(corrupt)? != 0xffff {
                        return Err(corrupt());
                    }
                    let preload_off = header_size + c.pos as u64;
                    c.pos += preload_len as usize;
                    if c.pos > tree.len() {
                        return Err(corrupt());
                    }
                    // A single space means "no directory" / "no extension".
                    let mut full = String::new();
                    if dir != " " {
                        full.push_str(&dir);
                        full.push('/');
                    }
                    full.push_str(&file);
                    if ext != " " {
                        full.push('.');
                        full.push_str(&ext);
                    }
                    let entry = Entry { dir: dir_idx, archive, offset, length, preload_off, preload_len };
                    if keep_existing {
                        self.files.entry(full.to_ascii_lowercase()).or_insert(entry);
                    } else {
                        self.files.insert(full.to_ascii_lowercase(), entry);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    pub fn stats(&self) -> IndexStats {
        let mut per: Vec<ArchiveStats> = self
            .dirs
            .iter()
            .map(|d| ArchiveStats { name: format!("{}_dir.vpk", d.base), files: 0, bytes: 0 })
            .collect();
        let mut total_bytes = 0;
        for e in self.files.values() {
            let s = &mut per[e.dir as usize];
            s.files += 1;
            s.bytes += e.size();
            total_bytes += e.size();
        }
        IndexStats { total_files: self.files.len(), total_bytes, archives: per }
    }

    fn norm(path: &str) -> String {
        path.replace('\\', "/").trim_matches('/').to_ascii_lowercase()
    }

    /// A number that changes when the game's archives do (their paths, sizes and dates): what a picture kept on disk is valid for.
    /// Mounts a folder of loose files (or, when it has none of its own, each folder in it that has: `tf/custom`). A folder that is the `models` or
    /// `materials` folder of an addon mounts the addon. Returns what was mounted; a folder that is mounted already is read again (it has new files).
    pub fn mount_custom(&self, root: &Path, auto: bool) -> Result<Vec<CustomInfo>, String> {
        let mut root = root.to_path_buf();
        if !root.is_dir() { return Err(format!("{} is not a folder", root.display())); }
        if !has_content(&root) {
            let name = root.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if matches!(name.as_str(), "models" | "materials") { if let Some(parent) = root.parent().filter(|p| has_content(p)) { root = parent.to_path_buf(); } }
        }
        let roots: Vec<PathBuf> = if has_content(&root) {
            vec![root.clone()]
        } else {
            let mut found: Vec<PathBuf> = std::fs::read_dir(&root).map_err(|e| format!("{}: {e}", root.display()))?.flatten().map(|e| e.path()).filter(|p| p.is_dir() && has_content(p)).collect();
            found.sort();
            found
        };
        if roots.is_empty() { return Err(format!("{} has no models or materials folder (an addon folder has them)", root.display())); }
        let mut added = Vec::new();
        for dir in roots {
            let canonical = std::fs::canonicalize(&dir).unwrap_or(dir.clone());
            let mut files = HashMap::new();
            walk_custom(&dir, &dir, 0, &mut files);
            {
                let mut mounts = self.custom.write().unwrap();
                if let Some(m) = mounts.iter_mut().find(|m| m.root == canonical) {
                    m.files = files;
                    added.push(CustomInfo { name: m.name.clone(), root: m.root.clone(), auto: m.auto, files: m.files.len(), models: m.files.keys().filter(|k| k.starts_with("models/") && k.ends_with(".mdl")).count() });
                    continue;
                }
            }
            let base = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "custom".into());
            let mut mounts = self.custom.write().unwrap();
            let mut name = base.clone();
            let mut n = 2;
            while mounts.iter().any(|m| m.name == name) { name = format!("{base} {n}"); n += 1; }
            let info = CustomInfo { name: name.clone(), root: canonical.clone(), auto, files: files.len(), models: files.keys().filter(|k| k.starts_with("models/") && k.ends_with(".mdl")).count() };
            mounts.push(CustomMount { name, root: canonical, auto, files });
            added.push(info);
        }
        Ok(added)
    }

    /// Takes a mounted folder away (one that was found by itself stays).
    pub fn unmount_custom(&self, root: &Path) {
        let canonical = std::fs::canonicalize(root).unwrap_or(root.to_path_buf());
        self.custom.write().unwrap().retain(|m| m.auto || (m.root != canonical && m.root != root));
    }

    pub fn custom_mounts(&self) -> Vec<CustomInfo> {
        self.custom.read().unwrap().iter().map(|m| CustomInfo { name: m.name.clone(), root: m.root.clone(), auto: m.auto, files: m.files.len(), models: m.files.keys().filter(|k| k.starts_with("models/") && k.ends_with(".mdl")).count() }).collect()
    }

    /// The models of the mounted folders (the path, and the name of the folder), by path; one the game has itself is not listed again.
    pub fn custom_models(&self) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = self.custom.read().unwrap().iter()
            .flat_map(|m| m.files.keys().filter(|k| k.starts_with("models/") && k.ends_with(".mdl") && !self.files.contains_key(*k)).map(|k| (k.clone(), m.name.clone())).collect::<Vec<_>>())
            .collect();
        out.sort();
        out
    }

    fn custom_path(&self, key: &str) -> Option<PathBuf> {
        self.custom.read().unwrap().iter().find_map(|m| m.files.get(key).cloned())
    }

    pub fn archive_stamp(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut mix = |bytes: &[u8]| for b in bytes { h = (h ^ *b as u64).wrapping_mul(0x100000001b3); };
        for d in &self.dirs {
            mix(d.path.to_string_lossy().as_bytes());
            if let Ok(m) = std::fs::metadata(&d.path) {
                mix(&m.len().to_le_bytes());
                if let Some(t) = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()) { mix(&t.as_secs().to_le_bytes()); }
            }
        }
        h
    }

    /// The game a file of the archives belongs to, by the start of the archive's name (`tf2_misc` is `tf2`, `hl2_textures` is `hl2`): the game
    /// folder's own archives win over the Half-Life 2 ones for a path both have. Empty for a file that is in no archive (a loose file, a zip).
    pub fn source_game(&self, path: &str) -> &str {
        self.files.get(&Self::norm(path)).and_then(|e| self.dirs.get(e.dir as usize)).map(|d| d.base.split('_').next().unwrap_or("")).unwrap_or("")
    }

    pub fn contains(&self, path: &str) -> bool {
        let found = self.compiled_path(path).is_some() || self.files.contains_key(&Self::norm(path)) || self.loose_path(path).is_some() || self.workshop.read().unwrap().files.contains_key(&Self::norm(path)) || self.remote_has(&Self::norm(path)) || self.custom_path(&Self::norm(path)).is_some();
        if found { self.note(path); }
        found
    }

    pub fn size_of(&self, path: &str) -> Option<u64> {
        if let Some(p) = self.loose_path(path) {
            return std::fs::metadata(p).ok().map(|m| m.len());
        }
        let key = Self::norm(path);
        {
            let mount = self.workshop.read().unwrap();
            if let Some(&z) = mount.files.get(&key) {
                return mount.zips[z].size_of(&key);
            }
        }
        if self.remote_has(&key) {
            // (a site's file has no size in its index: ask for the file, which the caller is about to want anyway)
            return self.read(path).ok().map(|b| b.len() as u64);
        }
        self.files.get(&key).map(Entry::size).or_else(|| self.custom_path(&key).and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()))
    }

    /// Lists the immediate children of `dir` ("" for the root).
    pub fn list_dir(&self, dir: &str) -> DirListing {
        let dir = Self::norm(dir);
        let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
        let mut out = DirListing::default();
        let mut i = self.sorted.partition_point(|p| p.as_str() < prefix.as_str());
        while i < self.sorted.len() && self.sorted[i].starts_with(&prefix) {
            let rest = &self.sorted[i][prefix.len()..];
            if let Some(slash) = rest.find('/') {
                let seg = &rest[..slash];
                out.dirs.push(seg.to_string());
                // Skip the whole subtree: '/' + 1 == '0'.
                let next = format!("{prefix}{seg}0");
                i += self.sorted[i..].partition_point(|p| p.as_str() < next.as_str());
            } else {
                let size = self.files.get(&self.sorted[i]).map_or(0, Entry::size);
                out.files.push(FileItem { name: rest.to_string(), size });
                i += 1;
            }
        }
        out
    }

    /// Case-insensitive substring search over full paths.
    pub fn search(&self, query: &str, limit: usize) -> Vec<&str> {
        let q = query.to_ascii_lowercase();
        self.sorted
            .iter()
            .filter(|p| p.contains(&q))
            .take(limit)
            .map(String::as_str)
            .collect()
    }

    pub fn read(&self, path: &str) -> Result<Vec<u8>, VpkError> {
        self.read_prefix(path, usize::MAX)
    }

    /// Reads at most `max` bytes from the start of the file.
    pub fn read_prefix(&self, path: &str, max: usize) -> Result<Vec<u8>, VpkError> {
        let out = self.read_prefix_inner(path, max);
        if out.is_ok() { self.note(path); }
        out
    }

    fn read_prefix_inner(&self, path: &str, max: usize) -> Result<Vec<u8>, VpkError> {
        if let Some(p) = self.compiled_path(path) {
            let mut out = Vec::new();
            File::open(&p).map_err(io_err(&p))?.take(max as u64).read_to_end(&mut out).map_err(io_err(&p))?;
            return Ok(out);
        }
        if let Some(p) = self.loose_path(path) {
            let mut f = File::open(&p).map_err(io_err(&p))?;
            let mut out = Vec::new();
            f.by_ref().take(max as u64).read_to_end(&mut out).map_err(io_err(&p))?;
            return Ok(out);
        }
        let key = Self::norm(path);
        {
            let mount = self.workshop.read().unwrap();
            if let Some(&z) = mount.files.get(&key) {
                if let Some(mut bytes) = mount.zips[z].read(&key) {
                    bytes.truncate(max);
                    return Ok(bytes);
                }
            }
        }
        if let Some(remote) = &self.remote {
            let key = Self::norm(path);
            if !self.remote_has(&key) { return Err(VpkError::NotFound(path.to_string())); }
            return match remote(&key) {
                Some(mut bytes) => { bytes.truncate(max); Ok(bytes) }
                None => Err(VpkError::NotFound(path.to_string())),
            };
        }
        self.read_archived_inner(path, max, true)
    }

    /// The file as the game's archives have it: a loose file of the game folder (a texture the user extracted over one of the game's, say)
    /// does not replace it. For what must look the same on every machine.
    pub fn read_archived(&self, path: &str) -> Result<Vec<u8>, VpkError> {
        let out = self.read_archived_inner(path, usize::MAX, false);
        if out.is_ok() { self.note(path); }
        out
    }

    fn read_archived_inner(&self, path: &str, max: usize, custom: bool) -> Result<Vec<u8>, VpkError> {
        let key = Self::norm(path);
        let Some(e) = self.files.get(&key).copied() else {
            // not in the game: a folder the user mounted may have it
            if !custom { return Err(VpkError::NotFound(path.to_string())); }
            if let Some(p) = self.custom_path(&key) {
                let mut out = Vec::new();
                File::open(&p).map_err(io_err(&p))?.take(max as u64).read_to_end(&mut out).map_err(io_err(&p))?;
                return Ok(out);
            }
            return Err(VpkError::NotFound(path.to_string()));
        };
        let d = &self.dirs[e.dir as usize];
        let total = (e.size() as usize).min(max);
        let mut out = Vec::with_capacity(total);

        if e.preload_len > 0 {
            let mut f = File::open(&d.path).map_err(io_err(&d.path))?;
            f.seek(SeekFrom::Start(e.preload_off)).map_err(io_err(&d.path))?;
            let n = (e.preload_len as usize).min(total);
            out.resize(n, 0);
            f.read_exact(&mut out).map_err(io_err(&d.path))?;
        }
        let remaining = total - out.len();
        if remaining > 0 {
            let (apath, start) = if e.archive == DIR_ARCHIVE {
                (d.path.clone(), d.data_start + e.offset as u64)
            } else {
                let name = format!("{}_{:03}.vpk", d.base, e.archive);
                (d.path.with_file_name(name), e.offset as u64)
            };
            let mut f = File::open(&apath).map_err(io_err(&apath))?;
            f.seek(SeekFrom::Start(start)).map_err(io_err(&apath))?;
            let at = out.len();
            out.resize(at + remaining, 0);
            f.read_exact(&mut out[at..]).map_err(io_err(&apath))?;
        }
        Ok(out)
    }
}
