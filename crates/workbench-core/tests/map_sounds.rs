//! A map's sounds against the installed game (skipped without one or without koth_camp_saxton).
use source_formats::{steam, VpkSet};
use workbench_core::{map, state::AppState};

#[test]
fn camp_saxton_has_its_ambients_and_soundscapes() {
    let Some(tf) = std::env::var_os("TF2_TF_DIR").map(std::path::PathBuf::from).or_else(steam::find_tf2) else { return };
    if !tf.join("maps/koth_camp_saxton.bsp").exists() {
        return;
    }
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    let s = map::map_sounds(&state, "koth_camp_saxton").unwrap();
    let ambients = s["ambients"].as_array().unwrap();
    let zones = s["zones"].as_array().unwrap();
    let scapes = s["soundscapes"].as_object().unwrap();
    assert!(ambients.len() >= 5 && zones.len() > 10);
    assert!(scapes.values().any(|v| !v["looping"].as_array().unwrap().is_empty()));
    assert!(ambients.iter().all(|a| a["waves"][0].as_str().is_some_and(|w| w.ends_with(".wav") || w.ends_with(".mp3"))));
}
