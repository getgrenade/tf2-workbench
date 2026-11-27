//! A map's baked static prop lighting against the installed game (skipped without one or without itemtest).
use source_formats::{steam, VpkSet};
use workbench_core::{map, state::AppState};

#[test]
fn itemtests_props_have_their_baked_light() {
    let Some(tf) = std::env::var_os("TF2_TF_DIR").map(std::path::PathBuf::from).or_else(steam::find_tf2) else { return };
    let Ok(bytes) = std::fs::read(tf.join("maps/itemtest.bsp")) else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    let parsed = source_formats::bsp::read(&bytes).unwrap();
    let (mut lit, mut total) = (0, 0);
    let mut models: std::collections::HashMap<&str, Vec<u32>> = Default::default();
    for p in &parsed.props {
        if let Some(i) = p.static_index {
            models.entry(&p.model).or_default().push(i);
        }
    }
    for (model, indices) in models {
        let out = map::load_map_prop_light(&state, "itemtest", model, &indices).unwrap();
        let per = out.len() / indices.len().max(1);
        for k in 0..indices.len() {
            total += 1;
            if out[k * per..(k + 1) * per].chunks_exact(4).any(|c| c[3] == 255) {
                lit += 1;
            }
        }
    }
    // (two of its props, the exit signs, have no baked light in the map)
    assert!(total > 100 && lit + 2 >= total, "{lit}/{total} props baked");
}
