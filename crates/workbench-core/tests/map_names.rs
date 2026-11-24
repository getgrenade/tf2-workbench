//! Where custom and workshop maps are found by their names (against a game folder: skipped without one).
use source_formats::VpkSet;

#[test]
fn map_names_lead_to_their_files_and_nowhere_else() {
    let Some(tf) = std::env::var_os("TF2_TF_DIR").map(std::path::PathBuf::from) else { return };
    let Ok(vpk) = VpkSet::open_folder(&tf) else { return };
    assert_eq!(vpk.map_path("itemtest"), Some(tf.join("maps/itemtest.bsp")));
    assert_eq!(vpk.map_path("download/maps/mvm_dockyard_rc7"), Some(tf.join("download/maps/mvm_dockyard_rc7.bsp")));
    assert_eq!(vpk.map_path("custom/My Pack/maps/cp_x"), Some(tf.join("custom/My Pack/maps/cp_x.bsp")));
    assert_eq!(vpk.map_path("maps/workshop/123/koth_y"), Some(tf.join("maps/workshop/123/koth_y.bsp")));
    let steam = source_formats::vpk::steam_workshop(&tf).unwrap();
    assert_eq!(vpk.map_path("steam-workshop/456/pl_z"), Some(steam.join("456/pl_z.bsp")));
    for bad in ["../secret", "download/../../x", "custom/a/b/c", "download/maps/..", "x\\\\y", "c:/x", "steam-workshop/1", ""] {
        assert_eq!(vpk.map_path(bad), None, "{bad}");
    }
}
