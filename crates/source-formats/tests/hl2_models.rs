//! The Half-Life 2 characters that come with TF2 load (their meshes) and animate (their idles), though their models are older (44 to 46).
use source_formats::{anim::AnimSet, VpkSet};

#[test]
fn hl2_characters_load_and_stand_in_their_idles() {
    let Some(tf) = std::env::var_os("TF2_TF_DIR").map(std::path::PathBuf::from) else { return };
    if !tf.parent().is_some_and(|p| p.join("hl2/hl2_misc_dir.vpk").exists()) {
        return;
    }
    let vpk = VpkSet::open_folder(&tf).unwrap();
    for (model, idle) in [
        ("alyx", "Idle_subtle"), ("barney", "idle_subtle"), ("combine_soldier", "Idle1"), ("police", "batonidle1"), ("vortigaunt", "Idle01"),
        ("zombie/classic", "Idle01"), ("humans/group03/male_07_bloody", "idle_subtle"), ("combine_scanner", "idle"), ("antlion_guard", "idle"),
    ] {
        let path = format!("models/{model}.mdl");
        let m = source_formats::model::load(&vpk, &path).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(m.body_parts.iter().any(|b| b.models.iter().any(|s| !s.meshes.is_empty())), "{path}: no meshes");
        let set = AnimSet::load(&vpk, &path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let seq = set.sequences().into_iter().find(|s| s.name.eq_ignore_ascii_case(idle)).unwrap_or_else(|| panic!("{path}: no {idle}"));
        let clip = set.bake(seq.index, &set.default_pose_params());
        assert!(clip.frames > 1 && clip.num_bones > 0, "{path} {idle}: {} frames", clip.frames);
    }
}
