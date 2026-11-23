//! The scene command against the installed game (skipped without one).
use source_formats::{steam, VpkSet};
use workbench_core::{state::AppState, voice};

#[test]
fn a_taunt_scene_comes_with_its_expressions() {
    let Some(tf) = steam::find_tf2() else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    let taunt = voice::scene(&state, "scenes/player/heavy/low/taunt05.vcd").unwrap();
    let events = taunt["events"].as_array().unwrap();
    assert!(events.iter().any(|e| e["kind"] == "expression"));
    // the scene plays the sequence of its name: the face is put on with that animation
    assert!(events.iter().any(|e| e["kind"] == "sequence" && e["params"].as_str().unwrap().eq_ignore_ascii_case("taunt05")));
    let expressions = taunt["expressions"]["player/heavy/emotion/emotion"].as_object().expect("the Heavy's emotions");
    assert!(expressions.values().all(|w| w.as_array().is_some_and(|w| !w.is_empty())));
    assert!(voice::scene(&state, "scenes/player/heavy/low/no_such_scene.vcd").unwrap().is_null());
}

#[test]
fn a_voice_line_has_lip_sync_and_mouth_shapes_for_the_class_model() {
    let Some(tf) = steam::find_tf2() else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    // the voice lines' phonemes are in scripts/game_sounds_vo_phonemes.txt (the mp3s cannot carry them)
    let lip = voice::lip_sync(&state, "vo/burp02.mp3").unwrap();
    assert!(lip["phonemes"].as_array().is_some_and(|p| !p.is_empty()), "{lip}");
    let lip = voice::lip_sync(&state, ")vo\\heavy_laughevil01.mp3").unwrap();
    assert!(lip["phonemes"].as_array().is_some_and(|p| !p.is_empty()), "{lip}");
    // the plain set drives the class model's own viseme controllers (AH, EEE, ...)
    let classes = voice::phoneme_classes(&state, "heavy").unwrap();
    let model = state.model("models/player/heavy.mdl").unwrap();
    let open = classes["plain"]["normal"]["593"].as_array().unwrap().clone();
    assert!(open.iter().any(|w| model.flex_controllers.iter().any(|c| c.name.eq_ignore_ascii_case(w[0].as_str().unwrap()))), "{open:?}");
    assert!(voice::read_sound(&state, "vo/heavy_laughevil01.mp3").unwrap().len() > 1000);
}

#[test]
fn a_taunt_item_scene_is_found_by_the_sequence_it_plays() {
    let Some(tf) = steam::find_tf2() else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    let paths = ["scenes/workshop/player/scout/low/taunt_peace_out.vcd".to_string(), "scenes/workshop/player/scout/low/taunt_peace.vcd".to_string()];
    assert_eq!(voice::scene_playing(&state, &paths, "taunt_peace_scout").unwrap().as_deref(), Some("scenes/workshop/player/scout/low/taunt_peace.vcd"));
    assert_eq!(voice::scene_playing(&state, &paths, "stand_primary").unwrap(), None);
    // its lines have their phonemes
    let lip = voice::lip_sync(&state, "vo/taunts/scout/scout_taunt_int_14.mp3").unwrap();
    assert!(lip["phonemes"].as_array().is_some_and(|p| !p.is_empty()), "{lip}");
}

#[test]
fn a_class_has_its_voice_lines_with_their_scenes() {
    let Some(tf) = steam::find_tf2() else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    let lines = voice::voice_lines(&state, "heavy", None).unwrap();
    let lines = lines.as_array().unwrap();
    assert!(lines.len() > 100, "only {} lines", lines.len());
    let first = &lines[0];
    assert!(!first["group"].as_str().unwrap().is_empty());
    let wave = first["sound"]["waves"][0].as_str().unwrap();
    assert!(voice::lip_sync(&state, wave).unwrap()["phonemes"].as_array().is_some_and(|p| !p.is_empty()), "{wave} has phonemes");
}

#[test]
fn robots_speak_their_own_lines_and_npcs_have_theirs() {
    let tf = std::env::var_os("TF2_TF_DIR").map(std::path::PathBuf::from).or_else(steam::find_tf2);
    let Some(tf) = tf else { return };
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder(&tf).unwrap());
    // a robot's lines are the class's, said from vo/mvm/norm (a giant's from vo/mvm/mght), and only those the robots have
    let robot = voice::voice_lines(&state, "soldier", Some("norm")).unwrap();
    let robot = robot.as_array().unwrap();
    assert!(!robot.is_empty());
    assert!(robot.iter().all(|l| l["sound"]["waves"].as_array().unwrap().iter().all(|w| w.as_str().unwrap().starts_with("vo/mvm/norm/") && w.as_str().unwrap().contains("soldier_mvm_"))));
    let giant = voice::voice_lines(&state, "heavy", Some("mght")).unwrap();
    assert!(giant.as_array().unwrap().iter().any(|l| l["sound"]["waves"][0].as_str().unwrap().contains("heavy_mvm_m_")));
    // a giant of a class with no giant voice speaks with the robot's
    let medic = voice::voice_lines(&state, "medic", Some("mght")).unwrap();
    assert!(medic.as_array().unwrap().iter().all(|l| l["sound"]["waves"][0].as_str().unwrap().starts_with("vo/mvm/norm/")));
    // the Horsemann's lines are his sound script entries, one per wave
    let hatman = voice::npc_voice_lines(&state, &["Halloween.HeadlessBossLaugh".into()], &[], &[]).unwrap();
    let hatman = hatman.as_array().unwrap();
    assert!(!hatman.is_empty() && hatman.iter().all(|l| l["scene"] == "" && l["sound"]["waves"].as_array().unwrap().len() == 1));
    // Krampus's are the sound files koth_krampus packs (when the game has the map)
    if state.vpk().unwrap().mount_map("koth_krampus").is_ok() {
        let krampus = voice::npc_voice_lines(&state, &[], &[], &["mvm/krampus".into()]).unwrap();
        let krampus = krampus.as_array().unwrap();
        assert!(krampus.iter().any(|l| l["group"] == "krampus iseeyou"), "{krampus:?}");
    }
}
