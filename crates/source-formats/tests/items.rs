//! items_game.txt parsing against the real TF2 install. Skipped when TF2 isn't found.

use source_formats::{items, steam, VpkSet};

fn db() -> Option<items::ItemDb> {
    let vpk = VpkSet::open_folder(&steam::find_tf2()?).unwrap();
    Some(items::load(&vpk).expect("items_game.txt"))
}

#[test]
fn loads_a_large_cosmetic_catalog() {
    let Some(db) = db() else { return };
    assert!(db.items.len() > 800, "only {} cosmetics", db.items.len());
    assert!(db.items.iter().all(|i| i.model.is_some() || !i.per_class.is_empty()));
}

#[test]
fn stock_weapons_survive_catalog_deduplication_for_play_mode() {
    let Some(db) = db() else { return };
    for id in [35, 169] { assert!(!db.weapons.iter().find(|w| w.id == id).unwrap().base_item, "Unlock sharing a stock model marked as default"); }
    for (class, defaults) in [
        ("scout", [200, 209, 190]), ("soldier", [205, 199, 196]), ("pyro", [208, 199, 192]),
        ("demoman", [206, 207, 191]), ("heavy", [202, 199, 5]), ("engineer", [199, 209, 197]),
        ("medic", [204, 211, 198]), ("sniper", [201, 203, 193]), ("spy", [0, 210, 194]),
    ] {
        let stock: Vec<_> = db.weapons.iter().filter(|w| w.base_item && w.usable_by(class)).collect();
        for (slot, id) in ["primary", "secondary", "melee"].into_iter().zip(defaults) {
            let chosen = stock.iter().filter(|w| w.slot_for(class) == slot).min_by_key(|w| w.id).map_or(0, |w| w.id);
            assert_eq!(chosen, id, "{class}: incorrect default {slot}");
        }
        assert!(stock.iter().any(|w| w.slot_for(class) == "melee"), "{class}: missing stock melee");
        assert!(stock.iter().any(|w| w.slot_for(class) == "secondary"), "{class}: missing stock secondary");
        assert_eq!(stock.iter().any(|w| w.slot_for(class) == "primary"), class != "spy", "{class}: primary slot");
        assert_eq!(stock.iter().any(|w| ["pda", "pda2", "building"].contains(&w.slot_for(class))), ["spy", "engineer"].contains(&class), "{class}: utility slot");
    }
}

#[test]
fn fancy_fedora_resolves_through_its_prefab_chain() {
    let Some(db) = db() else { return };
    // "valve hat" -> hat -> cosmetic + base_hat: slot, region and bodygroup come from the prefab.
    let it = db.items.iter().find(|i| i.id == 55).expect("Fancy Fedora");
    println!("{it:#?}");
    assert_eq!(it.name, "Fancy Fedora");
    assert_eq!(it.model.as_deref(), Some("models/player/items/spy/spy_hat.mdl"));
    assert_eq!(it.slot, "head");
    assert_eq!(it.item_class, "tf_wearable");
    assert_eq!(it.classes, vec!["spy"]);
    assert_eq!(it.equip_regions, vec!["hat"]);
    assert_eq!(it.bodygroups.get("hat"), Some(&1));
    assert!(it.paintable);
    assert!(it.usable_by("spy") && !it.usable_by("scout"));
}

#[test]
fn per_class_models_are_resolved() {
    let Some(db) = db() else { return };
    let it = db.items.iter().find(|i| i.per_class.len() == 9).expect("an all-class item with nine models");
    assert!(it.model_for("heavy").unwrap().contains("heavy"));
    assert!(it.usable_by("pyro"));
}

#[test]
fn equip_conflicts_are_loaded() {
    let Some(db) = db() else { return };
    assert!(db.equip_conflicts.get("whole_head").is_some_and(|v| v.iter().any(|r| r == "hat")));
}

#[test]
fn cosmetic_models_load_and_bonemerge_by_name() {
    use source_formats::model;
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();

    // Killer's Kabuto: a single prop bone that exists in the Soldier skeleton, so it merges by name.
    let kabuto = db.items.iter().find(|i| i.display_name == "Killer's Kabuto").expect("Killer's Kabuto");
    let hat = model::load(&vpk, kabuto.model_for("soldier").unwrap()).unwrap();
    let soldier = model::load(&vpk, "models/player/soldier.mdl").unwrap();
    assert_eq!(hat.bones.len(), 1);
    assert!(soldier.bones.iter().any(|b| b.name.eq_ignore_ascii_case(&hat.bones[0].name)), "{}", hat.bones[0].name);
    assert_eq!(kabuto.bodygroups.get("hat"), Some(&1), "equipping a hat hides the Soldier's helmet");
    assert!(hat.body_parts.iter().flat_map(|b| &b.models).flat_map(|m| &m.meshes).any(|m| m.indices.len() > 100));

    // A sample across the whole catalog parses (the full scan is `examples/scan_items.rs`).
    let mut seen = std::collections::HashSet::new();
    let sample: Vec<_> = db
        .items
        .iter()
        .filter(|i| i.usable_by("soldier"))
        .filter_map(|i| i.model_for("soldier").map(str::to_string))
        .filter(|p| seen.insert(p.clone()))
        .step_by(10)
        .collect();
    assert!(sample.len() > 20, "sample too small: {}", sample.len());
    for path in &sample {
        model::load(&vpk, path).unwrap_or_else(|e| panic!("{path}: {e}"));
    }
}

#[test]
fn paint_cans_are_parsed_with_their_colours() {
    let Some(db) = db() else { return };
    assert!(db.paints.len() >= 25, "only {} paints", db.paints.len());
    // Paint Can 1 (id 5027) writes 7511618 = 0x729E42, "Indubitably Green".
    let green = db.paints.iter().find(|p| p.id == 5027).expect("paint can 5027");
    assert_eq!(green.rgb, 7_511_618);
    assert_eq!(green.rgb, 0x729E42);
    assert!(green.rgb2.is_none());
    assert!(green.display_name.contains("Indubitably"), "{:?}", green.display_name);
    // Team-colour paints carry a second colour for BLU.
    let team: Vec<_> = db.paints.iter().filter(|p| p.rgb2.is_some()).collect();
    assert!(!team.is_empty(), "no team colour paints");
    assert!(team.iter().all(|p| p.rgb2 != Some(p.rgb)), "BLU colour should differ from RED");
    // Paint cans must not appear in the cosmetics list.
    assert!(db.items.iter().all(|i| !i.name.starts_with("Paint Can")));
}

#[test]
fn medals_are_identified_by_their_equip_region() {
    let Some(db) = db() else { return };
    let medals = db.items.iter().filter(|i| i.is_medal()).count();
    // Thousands of tournament / community medals dominate the catalog.
    assert!(medals > 5000, "only {medals} medals");
    assert!(db.items.len() - medals > 1000, "ordinary cosmetics: {}", db.items.len() - medals);
    let named = |n: &str| db.items.iter().find(|i| i.display_name == n).unwrap_or_else(|| panic!("no {n}"));
    for medal in ["Merc Medal", "Invasion Community Update Medal", "First Place - ETF2L Highlander Tournament"] {
        assert!(named(medal).is_medal(), "{medal} should be a medal");
    }
    for cosmetic in ["Killer's Kabuto", "Fancy Fedora", "Pyrovision Goggles"] {
        assert!(!named(cosmetic).is_medal(), "{cosmetic} should not be a medal");
    }
}

#[test]
fn basename_patterns_expand_to_every_class_model() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    let all_class: Vec<_> = db.items.iter().filter(|i| i.classes.is_empty() || i.classes.len() == 9).collect();
    assert!(all_class.len() > 500, "only {} all-class cosmetics", all_class.len());
    assert!(db.items.iter().all(|i| !i.per_class.contains_key("basename")));
    // The pattern's `%s` is the class model name (`demo`), and the files exist.
    let missing = all_class
        .iter()
        .flat_map(|i| i.per_class.values())
        .filter(|m| !vpk.contains(m))
        .count();
    println!("{} all-class cosmetics, {missing} missing model files", all_class.len());
    assert!(missing < 20);
}

#[test]
fn styles_are_parsed_with_their_models_and_skins() {
    let Some(db) = db() else { return };
    let m = db.items.iter().find(|i| i.name == "The Deadliest Match").expect("The Deadliest Match");
    assert_eq!(m.styles.len(), 2);
    assert!(m.styles[0].model.as_deref().unwrap().ends_with("sum26_deadliest_match.mdl"));
    assert!(m.styles[1].model.as_deref().unwrap().ends_with("sum26_deadliest_match_style2.mdl"));
    assert_eq!((m.styles[1].skin_red, m.styles[1].skin_blu), (Some(0), Some(1)));
    // many items carry styles; most of them are plain skin / model variants
    let with = db.items.iter().filter(|i| i.styles.len() > 1).count();
    assert!(with > 100, "only {with} items have several styles");
}

#[test]
fn weapons_are_collected_with_slots_animation_slots_and_existing_models() {
    // (see also: stock_template_duplicates_are_removed_but_unique_utility_items_stay)
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    assert!(db.weapons.len() > 300, "only {} weapons", db.weapons.len());
    assert!(db.weapons.iter().all(|w| matches!(w.slot.as_str(), "primary" | "secondary" | "melee" | "pda" | "pda2" | "building")));
    assert!(db.weapons.iter().all(|w| w.model.iter().chain(w.per_class.values()).all(|m| vpk.contains(m))));
    let pan = db.weapons.iter().find(|w| w.name == "Frying Pan").expect("Frying Pan");
    assert_eq!((pan.slot.as_str(), pan.anim_slot.as_str()), ("melee", "MELEE_ALLCLASS"));
    assert!(pan.usable_by("soldier") && !pan.usable_by("spy"));
    // Cosmetics and weapons do not overlap.
    assert!(db.items.iter().all(|i| !db.weapons.iter().any(|w| w.id == i.id)));
}

#[test]
fn per_class_slot_overrides_are_kept() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    // The shotgun family: primary for the Engineer, secondary for the others.
    let shotgun = db.weapons.iter().find(|w| w.class_slots.get("engineer").is_some_and(|s| s == "primary")).expect("a weapon with an Engineer slot override");
    assert_eq!(shotgun.slot_for("engineer"), "primary");
    assert_ne!(shotgun.slot_for("soldier"), "", "other classes fall back to the item's slot");
}

#[test]
fn weapons_carry_their_backpack_and_attached_models() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    // The Buff Banner: the bugle in hand plus a backpack worn on the back.
    let banner = db.weapons.iter().find(|w| w.name == "The Buff Banner").expect("The Buff Banner");
    assert!(banner.model.as_deref().unwrap().ends_with("c_bugle.mdl"));
    assert!(banner.extra_models.iter().any(|m| m.ends_with("c_buffpack.mdl")), "{:?}", banner.extra_models);
    // The Quick-Fix: the medigun plus its backpack.
    let quickfix = db.weapons.iter().find(|w| w.name == "The Quick-Fix").expect("The Quick-Fix");
    assert!(quickfix.extra_models.iter().any(|m| m.ends_with("c_proto_backpack.mdl")), "{:?}", quickfix.extra_models);
    // Every extra model exists in the install, and festivizers are not treated as part of the weapon.
    assert!(db.weapons.iter().flat_map(|w| &w.extra_models).all(|m| vpk.contains(m)), "a weapon lists a missing extra model");
    assert!(db.weapons.iter().flat_map(|w| &w.extra_models).all(|m| !m.contains("festivizer")));
}

#[test]
fn items_can_set_pose_parameters_while_held() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    let with: Vec<_> = db.weapons.iter().chain(&db.items).filter(|i| !i.pose_params.is_empty()).collect();
    assert!(!with.is_empty(), "no item sets player_poseparam");
    assert!(with.iter().any(|i| i.pose_params.get("r_hand_grip").is_some_and(|&v| v >= 13.0)));
    // Ordinary weapons rely on the defaults.
    let pan = db.weapons.iter().find(|w| w.name == "Frying Pan").expect("Frying Pan");
    assert!(pan.pose_params.is_empty());
}

#[test]
fn utility_items_for_the_spy_and_engineer_are_included() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    let utility = |class: &str| db.weapons.iter().filter(|w| w.usable_by(class) && matches!(w.slot_for(class), "pda" | "pda2" | "building")).collect::<Vec<_>>();
    // Spy: sappers (slot building) and the disguise kit (slot pda, a w_models model).
    let spy = utility("spy");
    assert!(spy.iter().any(|w| w.slot == "building" && w.item_class == "tf_weapon_sapper"), "no sapper for the Spy");
    assert!(spy.iter().any(|w| w.slot == "pda"), "no disguise kit for the Spy");
    // Engineer: the construction / destruction PDAs and the toolbox.
    let eng = utility("engineer");
    assert!(eng.iter().any(|w| w.slot == "pda") && eng.iter().any(|w| w.slot == "pda2") && eng.iter().any(|w| w.slot == "building"), "{:?}", eng.iter().map(|w| (&w.name, &w.slot)).collect::<Vec<_>>());
    // Every one of them has a weapon_bone-style model that exists.
    assert!(spy.iter().chain(&eng).all(|w| w.model.iter().chain(w.per_class.values()).all(|m| vpk.contains(m))));
}

#[test]
fn stock_template_duplicates_are_removed_but_unique_utility_items_stay() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    let named = |n: &str| db.weapons.iter().filter(|w| w.name == n).count();
    // Stock templates that have a real twin are gone ...
    assert_eq!(named("TF_WEAPON_BAT"), 0);
    assert_eq!(named("Upgradeable TF_WEAPON_BAT"), 1);
    assert_eq!(named("TF_WEAPON_BUILDER_SPY"), 0, "the duplicate sapper");
    assert_eq!(named("TF_WEAPON_PDA_ENGINEER_BUILD"), 0, "the duplicate construction PDA");
    assert_eq!(named("Upgradeable TF_WEAPON_PDA_ENGINEER_BUILD"), 1);
    // The gray weapon-skin copies (normal quality, same model as the base weapon) are gone as well.
    assert!(db.weapons.iter().all(|w| w.quality != "normal" || w.id < 100), "a normal-quality skin copy remains");
    // Items with no twin stay: the disguise kit, the destruction PDA and the toolbox.
    assert_eq!(named("TF_WEAPON_PDA_SPY"), 1);
    assert_eq!(named("TF_WEAPON_PDA_ENGINEER_DESTROY"), 1);
    assert_eq!(named("TF_WEAPON_BUILDER"), 1);
    // No duplicate model entries are left among the normal-quality weapons.
    for w in db.weapons.iter().filter(|w| w.quality == "normal") {
        assert!(!db.weapons.iter().any(|v| v.id != w.id && v.quality != "normal" && v.model == w.model && v.per_class == w.per_class && w.classes.iter().all(|c| v.classes.contains(c))), "{} is still a duplicate", w.name);
    }
    // Every class still has weapons in each slot it had.
    for class in ["scout", "soldier", "pyro", "demoman", "heavy", "engineer", "medic", "sniper", "spy"] {
        let slots: std::collections::BTreeSet<&str> = db.weapons.iter().filter(|w| w.usable_by(class)).map(|w| w.slot_for(class)).collect();
        assert!(slots.contains("melee"), "{class} has no melee weapon left");
    }
}

#[test]
fn paint_kit_weapon_skins_do_not_clutter_the_weapon_list() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let db = items::load(&vpk).unwrap();
    assert!(db.weapons.iter().all(|w| !w.prefabs.iter().any(|p| p.starts_with("paintkit_weapon"))), "a paint-kit skin entry remains");
    // The Soldier's secondary slot has one entry per distinct item, not eleven shotguns.
    let shotguns = db.weapons.iter().filter(|w| w.usable_by("soldier") && w.slot_for("soldier") == "secondary" && w.model_for("soldier").is_some_and(|m| m.ends_with("c_shotgun.mdl"))).count();
    assert_eq!(shotguns, 2, "the shotgun and its festive variant");
    // Named variants that merely share an icon (promos, Festive, Botkiller) are real items and stay.
    assert!(db.weapons.iter().any(|w| w.name == "Festive Shotgun 2014"));
    assert!(db.weapons.iter().any(|w| w.name == "Deflector"));
}

#[test]
fn taunts_with_props_use_the_prop_as_their_model() {
    let Some(db) = db() else { return };
    assert!(db.taunts.len() > 40, "only {} taunts with props", db.taunts.len());
    let skater = db.taunts.iter().find(|t| t.display_name.contains("Skating Scorcher")).expect("Skating Scorcher");
    assert_eq!(skater.slot, "taunt");
    assert_eq!(skater.classes, vec!["pyro"]);
    assert!(skater.model_for("pyro").is_some_and(|m| m.ends_with("taunt_the_skating_scorcher.mdl")));
    assert_eq!(skater.taunt_scenes.get("pyro").map(String::as_str), Some("taunt_the_skating_scorcher_intro"));
    // Taunts never leak into the cosmetics or weapons lists.
    assert!(db.items.iter().chain(&db.weapons).all(|i| i.slot != "taunt"));
}
