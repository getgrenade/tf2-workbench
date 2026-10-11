//! Integration tests against a real TF2 install. Skipped when TF2 isn't found.

use source_formats::{steam, VpkSet};

fn open() -> Option<VpkSet> {
    let tf = steam::find_tf2()?;
    Some(VpkSet::open_folder(&tf).expect("index VPKs"))
}

#[test]
fn indexes_and_finds_soldier() {
    let Some(vpk) = open() else {
        eprintln!("TF2 not found; skipping");
        return;
    };
    assert!(vpk.len() > 1000);
    for f in [
        "models/player/soldier.mdl",
        "models/player/soldier.vvd",
        "models/player/soldier.dx90.vtx",
    ] {
        assert!(vpk.contains(f), "missing {f}");
    }
    // Case/slash-insensitive lookup.
    assert!(vpk.contains("Models\\Player\\Soldier.MDL"));
}

#[test]
fn mdl_has_idst_magic() {
    let Some(vpk) = open() else { return };
    let data = vpk.read("models/player/soldier.mdl").unwrap();
    assert_eq!(&data[..4], b"IDST");
    assert_eq!(data.len() as u64, vpk.size_of("models/player/soldier.mdl").unwrap());
    let head = vpk.read_prefix("models/player/soldier.mdl", 16).unwrap();
    assert_eq!(head, data[..16]);
}

#[test]
fn list_dir_browses() {
    let Some(vpk) = open() else { return };
    let root = vpk.list_dir("");
    assert!(root.dirs.iter().any(|d| d == "models"));
    let player = vpk.list_dir("models/player");
    assert!(player.files.iter().any(|f| f.name == "soldier.mdl"));
    let stats = vpk.stats();
    assert_eq!(stats.total_files, vpk.len());
    assert_eq!(stats.archives.iter().map(|a| a.files).sum::<usize>(), vpk.len());
}
