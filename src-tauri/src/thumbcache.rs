//! The pictures the program makes of the game's files (the inventory icons of items, the thumbnails of props) kept on disk, so that the next
//! launch does not decode and draw them again. A picture is a file in a folder named for the state of the game's archives (the sizes and dates of
//! the `*_dir.vpk` files): a game update makes a new folder and the old ones are removed, so a stale picture is never shown. Only files that
//! are in the archives are kept (a workshop item's icon can change under the same name).

use std::{
    fs,
    path::{Path, PathBuf},
};

/// What a picture is of; also the folder it is in.
pub const KINDS: [&str; 2] = ["icon", "prop"];

/// FNV-1a: the file name of a picture is made from the path it is of.
pub fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

/// Where a picture is (or would be).
pub fn file_for(root: &Path, stamp: u64, kind: &str, key: &str) -> Option<PathBuf> {
    if !KINDS.contains(&kind) { return None; }
    Some(root.join("thumbs").join(format!("{stamp:016x}")).join(kind).join(format!("{:016x}.webp", fnv(&key.replace('\\', "/").to_ascii_lowercase()))))
}

pub fn get(root: &Path, stamp: u64, kind: &str, key: &str) -> Option<Vec<u8>> {
    fs::read(file_for(root, stamp, kind, key)?).ok().filter(|b| !b.is_empty())
}

/// Keeps a picture. The first one kept for a state of the archives removes the pictures of the other states.
pub fn put(root: &Path, stamp: u64, kind: &str, key: &str, bytes: &[u8]) -> Result<(), String> {
    let file = file_for(root, stamp, kind, key).ok_or("unknown kind of picture")?;
    if bytes.is_empty() { return Err("an empty picture".into()); }
    let current = file.parent().and_then(Path::parent).ok_or("bad path")?.to_path_buf();
    if !current.exists() { remove_other_states(root, &current); }
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    // written whole, then moved into place: a picture is never read half written
    let part = file.with_extension("part");
    fs::write(&part, bytes).map_err(|e| e.to_string())?;
    fs::rename(&part, &file).map_err(|e| e.to_string())
}

fn remove_other_states(root: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(root.join("thumbs")) else { return };
    for entry in entries.flatten() {
        if entry.path() != keep && entry.path().is_dir() { let _ = fs::remove_dir_all(entry.path()); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("workbench-thumbs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_picture_comes_back_by_its_path_whatever_the_case_and_slashes() {
        let root = temp("get");
        assert!(get(&root, 1, "icon", "materials/backpack/a.vmt").is_none());
        put(&root, 1, "icon", "materials/backpack/a.vmt", b"RIFF").unwrap();
        assert_eq!(get(&root, 1, "icon", "Materials\\Backpack\\A.vmt").unwrap(), b"RIFF");
        assert!(get(&root, 1, "prop", "materials/backpack/a.vmt").is_none(), "another kind is another picture");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_new_state_of_the_archives_drops_the_old_pictures() {
        let root = temp("state");
        put(&root, 1, "prop", "models/a.mdl", b"one").unwrap();
        put(&root, 2, "prop", "models/a.mdl", b"two").unwrap();
        assert!(get(&root, 1, "prop", "models/a.mdl").is_none());
        assert_eq!(get(&root, 2, "prop", "models/a.mdl").unwrap(), b"two");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_known_kinds_and_real_pictures_are_kept() {
        let root = temp("kinds");
        assert!(put(&root, 1, "../../x", "a", b"x").is_err());
        assert!(put(&root, 1, "icon", "a", b"").is_err());
        assert!(file_for(&root, 1, "evil", "a").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
