//! Locate the Team Fortress 2 install.

use std::path::{Path, PathBuf};

const TF_MARKER: &str = "tf2_misc_dir.vpk";
const TF_REL: &str = "steamapps/common/Team Fortress 2/tf";

/// Returns true if `dir` looks like TF2's `tf` folder.
pub fn is_tf_dir(dir: &Path) -> bool {
    dir.join(TF_MARKER).is_file()
}

/// Finds TF2's `tf` folder via the Steam registry entry, Steam library folders,
/// and a few default locations.
pub fn find_tf2() -> Option<PathBuf> {
    let mut steam_roots: Vec<PathBuf> = Vec::new();
    if let Some(p) = registry_steam_path() {
        steam_roots.push(p);
    }
    for p in [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        "/usr/share/steam",
    ] {
        steam_roots.push(PathBuf::from(p));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        steam_roots.push(home.join(".steam/steam"));
        steam_roots.push(home.join(".local/share/Steam"));
    }

    for root in &steam_roots {
        let mut libs = vec![root.clone()];
        libs.extend(library_folders(root));
        for lib in libs {
            let tf = lib.join(TF_REL);
            if is_tf_dir(&tf) {
                return Some(tf);
            }
        }
    }
    None
}

/// Where Source Filmmaker keeps the workshop items it downloaded, in any Steam library (found from TF2's `tf` folder: the library it is
/// in and the others that library lists): `SourceFilmmaker/game/workshop` (the items SFM itself unpacks, which its gameinfo mounts) and
/// Steam's `workshop/content/1840/<item>` (SFM is app 1840). Only the folders that exist.
pub fn sfm_workshop_dirs(tf: &Path) -> Vec<PathBuf> {
    let Some(library) = tf.parent().and_then(Path::parent).and_then(Path::parent).and_then(Path::parent) else { return Vec::new() };
    let mut libs = vec![library.to_path_buf()];
    libs.extend(library_folders(library));
    if let Some(root) = registry_steam_path() {
        libs.push(root.clone());
        libs.extend(library_folders(&root));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for lib in libs {
        for dir in [lib.join("steamapps/common/SourceFilmmaker/game/workshop"), lib.join("steamapps/workshop/content/1840")] {
            let canonical = std::fs::canonicalize(&dir).unwrap_or(dir.clone());
            if dir.is_dir() && !out.iter().any(|d| std::fs::canonicalize(d).unwrap_or(d.clone()) == canonical) {
                out.push(dir);
            }
        }
    }
    out
}

/// Extracts `"path"` values from `steamapps/libraryfolders.vdf`.
fn library_folders(steam_root: &Path) -> Vec<PathBuf> {
    let vdf = steam_root.join("steamapps/libraryfolders.vdf");
    let Ok(text) = std::fs::read_to_string(vdf) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split('"').skip(1).step_by(2);
            let key = parts.next()?;
            let val = parts.next()?;
            key.eq_ignore_ascii_case("path")
                .then(|| PathBuf::from(val.replace("\\\\", "\\")))
        })
        .collect()
}

#[cfg(windows)]
fn registry_steam_path() -> Option<PathBuf> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Steam")
        .ok()?;
    let p: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(p))
}

#[cfg(not(windows))]
fn registry_steam_path() -> Option<PathBuf> {
    None
}
