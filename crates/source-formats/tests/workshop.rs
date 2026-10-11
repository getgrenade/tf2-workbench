use std::collections::HashMap;
use source_formats::items;

#[test]
fn importer_taunts_are_not_cosmetics_and_do_not_require_a_prop() {
    let schema = r#""items_game" { "prefabs" { "taunt" { "item_slot" "taunt" } } "items" {} }"#;
    let with_prop = r#""asset" { "ImportSession" {
        "prefab" "taunt" "name" "custom_taunt"
        "ItemSchema" { "prefab" "no_craft taunt" "import_name" "custom_taunt"
            "used_by_classes" { "heavy" "1" "scout" "1" }
            "taunt" {
                "custom_taunt_scene_per_class" { "heavy" "scenes/workshop/heavy/custom.vcd" "scout" "scenes/workshop/scout/custom.vcd" }
                "custom_taunt_prop_per_class" { "heavy" "models/workshop/custom.mdl" }
            }
        }
    } }"#;
    let without_prop = r#""asset" { "ImportSession" {
        "name" "solo_taunt" "classes" { "demo" { "animation" { "source_file" "content/solo.dmx" } } }
        "ItemSchema" { "prefab" "taunt" "taunt" { "custom_taunt_scene_per_class" { "demoman" "scenes/solo.vcd" } } }
    } }"#;
    let manifests = vec![("custom".into(), with_prop.into()), ("solo".into(), without_prop.into()), ("duplicate".into(), with_prop.into())];
    let db = items::parse_with(schema, &HashMap::new(), &manifests).unwrap();
    assert!(db.items.is_empty() && db.weapons.is_empty());
    assert_eq!(db.taunts.len(), 2);
    let custom = &db.taunts[0];
    assert!(custom.workshop);
    assert_eq!(custom.quality, "community");
    assert_eq!(custom.id & 0x80000000, 0x80000000);
    assert!(custom.classes.iter().any(|c| c == "scout"));
    assert_eq!(custom.model_for("heavy"), Some("models/workshop/custom.mdl"));
    assert_eq!(custom.taunt_scenes["heavy"], "custom");
    assert!(db.taunts[1].model_for("demoman").is_none());
    assert_eq!(db.taunts[1].classes, vec!["demoman"]);
    let again = items::parse_with(schema, &HashMap::new(), &manifests).unwrap();
    assert_eq!(again.taunts[0].id, custom.id);
}

/// A Workshop taunt is compiled on its own, with no stand pose: its first and last frames are all-zero bones (flat on the ground) unless it is
/// layered over the class's stand pose, as the game plays a taunt.
#[test]
fn a_workshop_taunt_is_baked_over_its_class_stand_pose() {
    use source_formats::{anim::AnimSet, steam, workshop, VpkSet};
    let Some(root) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&root).unwrap();
    let Ok(db) = items::load(&vpk) else { return };
    let Some(item) = db.taunts.iter().find(|i| i.workshop && !i.classes.is_empty()) else { return };
    let class = item.classes[0].clone();
    let cache = std::env::temp_dir().join("workbench-taunt-test");
    let Ok(prepared) = workshop::prepare(&vpk, item.id, &class, &cache) else { return };
    let set = AnimSet::load(&vpk, &prepared.animation).unwrap();
    let player = AnimSet::load(&vpk, &format!("models/player/{class}.mdl")).unwrap();
    let seq = set.find_sequence(&prepared.sequence).unwrap();
    let params = set.default_pose_params();
    let alone = set.bake(seq, &params);
    let over = set.bake_over(seq, &params, Some(&player));
    let stand = player.evaluate(player.find_sequence("stand_primary").unwrap(), 0.0, &player.default_pose_params());
    let names = player.bone_names();
    let root_bone = set.bone_names().iter().position(|n| n.eq_ignore_ascii_case(&names[0])).unwrap();
    let last = over.frames - 1;
    let q = |clip: &source_formats::anim::Clip, f: usize| -> [f32; 4] { clip.quat[(f * clip.num_bones + root_bone) * 4..][..4].try_into().unwrap() };
    let dot = |a: [f32; 4], b: [f32; 4]| (0..4).map(|k| a[k] * b[k]).sum::<f32>().abs();
    assert!(dot(q(&over, 0), stand.quat[0]) > 0.999, "starts in the stand pose");
    assert!(dot(q(&over, last), stand.quat[0]) > 0.99, "ends in the stand pose");
    assert!(dot(q(&alone, 0), stand.quat[0]) < 0.99, "alone, its first frame is not the stand pose");
}
