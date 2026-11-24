//! Source Filmmaker's workshop items, found from TF2's folder in the same Steam library.
use std::fs;

#[test]
fn sfm_workshop_items_are_found_beside_tf2() {
    let lib = std::env::temp_dir().join(format!("sfm_lib_{}", std::process::id()));
    let tf = lib.join("steamapps/common/Team Fortress 2/tf");
    let unpacked = lib.join("steamapps/common/SourceFilmmaker/game/workshop");
    let item = lib.join("steamapps/workshop/content/1840/123456");
    for d in [&tf, &unpacked.join("maps"), &item.join("models"), &item.join("maps")] {
        fs::create_dir_all(d).unwrap();
    }
    fs::write(unpacked.join("maps/sfm_set.bsp"), b"").unwrap();
    fs::write(item.join("maps/sfm_item_map.bsp"), b"").unwrap();
    let dirs = source_formats::steam::sfm_workshop_dirs(&tf);
    assert_eq!(dirs, vec![unpacked.clone(), lib.join("steamapps/workshop/content/1840")]);
    // mounted as the app mounts them: named for what they are, an item by its number
    let vpk = source_formats::VpkSet::open_dirs(&[]).unwrap();
    fs::create_dir_all(unpacked.join("models")).unwrap();
    fs::write(unpacked.join("models/set.mdl"), b"").unwrap();
    fs::write(item.join("models/thing.mdl"), b"").unwrap();
    let mut names: Vec<String> = dirs.iter().flat_map(|d| vpk.mount_custom_as(d, true, Some("Source Filmmaker workshop")).unwrap()).map(|m| m.name).collect();
    names.sort();
    assert_eq!(names, ["Source Filmmaker workshop", "Source Filmmaker workshop · 123456"]);
    assert!(vpk.custom_models().iter().any(|(p, n)| p == "models/thing.mdl" && n.ends_with("123456")));
    // no SFM: nothing
    assert!(source_formats::steam::sfm_workshop_dirs(&lib.join("nowhere/a/b/c/tf")).is_empty());
    fs::remove_dir_all(&lib).ok();
}
