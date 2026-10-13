//! Folders of loose files mounted into the file system (an addon, `tf/custom`, the output of the prop compiler).

use source_formats::VpkSet;
use std::{fs, path::PathBuf};

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("workbench-custom-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn addon(root: &std::path::Path) {
    fs::create_dir_all(root.join("models/zmb/perk")).unwrap();
    fs::create_dir_all(root.join("materials/models/zmb/perk")).unwrap();
    fs::write(root.join("models/zmb/perk/Machine.mdl"), b"IDST-model").unwrap();
    fs::write(root.join("models/zmb/perk/machine.vvd"), b"vvd").unwrap();
    fs::write(root.join("materials/models/zmb/perk/machine.vmt"), b"\"VertexLitGeneric\" {}").unwrap();
}

#[test]
fn a_mounted_folder_serves_its_files_and_lists_its_models() {
    let dir = temp("serve");
    addon(&dir.join("perk_machines"));
    let set = VpkSet::open_dirs(&[]).unwrap();
    assert!(!set.contains("models/zmb/perk/machine.mdl"));
    let added = set.mount_custom(&dir.join("perk_machines"), false).unwrap();
    assert_eq!(added.len(), 1);
    assert_eq!((added[0].name.as_str(), added[0].models, added[0].files), ("perk_machines", 1, 3));
    // the name is looked for by any case and slash
    assert!(set.contains(r"models\ZMB\perk\Machine.mdl"));
    assert_eq!(set.read("models/zmb/perk/machine.vvd").unwrap(), b"vvd");
    assert_eq!(set.size_of("models/zmb/perk/machine.mdl"), Some(10));
    assert!(set.read("models/zmb/perk/missing.mdl").is_err());
    assert_eq!(set.custom_models(), vec![("models/zmb/perk/machine.mdl".to_string(), "perk_machines".to_string())]);
    // mounting it again reads it again (a prop was built into it): the new file is there, and it is still one mount
    fs::write(dir.join("perk_machines/models/zmb/perk/second.mdl"), b"IDST").unwrap();
    assert!(!set.contains("models/zmb/perk/second.mdl"));
    let again = set.mount_custom(&dir.join("perk_machines"), false).unwrap();
    assert_eq!((again.len(), again[0].models), (1, 2));
    assert!(set.contains("models/zmb/perk/second.mdl"));
    assert_eq!(set.custom_mounts().len(), 1);
    // taking it away takes its files
    set.unmount_custom(&dir.join("perk_machines"));
    assert!(!set.contains("models/zmb/perk/machine.mdl"));
    assert!(set.custom_mounts().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_folder_of_addons_mounts_each_and_the_models_folder_mounts_its_addon() {
    let dir = temp("many");
    addon(&dir.join("custom/one"));
    addon(&dir.join("custom/two"));
    fs::create_dir_all(dir.join("custom/notes")).unwrap();
    fs::write(dir.join("custom/notes/readme.txt"), b"x").unwrap();
    let set = VpkSet::open_dirs(&[]).unwrap();
    let added = set.mount_custom(&dir.join("custom"), true).unwrap();
    assert_eq!(added.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["one", "two"]);
    // what was found by itself stays when the user asks to take it away
    set.unmount_custom(&dir.join("custom/one"));
    assert_eq!(set.custom_mounts().len(), 2);
    // the same machine in two addons is one model
    assert_eq!(set.custom_models().len(), 2);
    let set2 = VpkSet::open_dirs(&[]).unwrap();
    let added = set2.mount_custom(&dir.join("custom/one/models"), false).unwrap();
    assert_eq!(added[0].name, "one");
    assert!(set2.mount_custom(&dir.join("custom/notes"), false).is_err(), "a folder with neither models nor materials");
    let _ = fs::remove_dir_all(&dir);
}
