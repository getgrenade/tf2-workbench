//! Taunt scenes and the expressions they name, read from the installed game (skipped without one).
use source_formats::{choreo, steam, vfe, VpkSet};

#[test]
fn a_taunt_scene_plays_its_sequence_and_names_expressions_of_the_class() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    let image = choreo::SceneImage::parse(vpk.read("scenes/scenes.image").unwrap()).unwrap();
    assert!(image.len() > 1000, "only {} scenes", image.len());
    let scene = image.scene("scenes/player/heavy/low/taunt05.vcd").unwrap().expect("the Heavy's taunt05 scene");
    let seq = scene.all_events().find(|e| e.kind == choreo::SEQUENCE).expect("the body animation");
    assert_eq!(seq.params.to_ascii_lowercase(), "taunt05");
    let expression = scene.all_events().find(|e| e.kind == choreo::EXPRESSION).expect("an expression");
    // the expression is a named setting of an expression file, of the class's own controllers
    let file = vfe::parse(&vpk.read(&format!("expressions/{}.vfe", expression.params.replace('\\', "/"))).unwrap()).unwrap();
    let setting = file.settings.iter().find(|s| s.name.eq_ignore_ascii_case(&expression.params2)).expect("the named setting");
    assert!(!setting.weights.is_empty());
}
