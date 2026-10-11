//! Parses real class models from the TF2 install. Skipped when TF2 isn't found.

use source_formats::{model, steam, Model, VpkSet};

fn load(path: &str) -> Option<Model> {
    let tf = steam::find_tf2()?;
    let vpk = VpkSet::open_folder(&tf).unwrap();
    Some(model::load(&vpk, path).unwrap_or_else(|e| panic!("{path}: {e}")))
}

#[test]
fn soldier_loads_with_sane_geometry() {
    let Some(m) = load("models/player/soldier.mdl") else { return };
    assert!(m.bones.len() > 50, "bones: {}", m.bones.len());
    assert!(m.bones.iter().any(|b| b.name == "bip_head"));
    assert!(m.include_models.iter().any(|n| n.contains("soldier_animations")), "{:?}", m.include_models);

    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    let (mut verts, mut tris) = (0, 0);
    let (mut agree, mut total) = (0usize, 0usize);
    for bp in &m.body_parts {
        println!("bodypart {}: {:?}", bp.name, bp.models.iter().map(|x| (&x.name, x.meshes.len())).collect::<Vec<_>>());
        // Default bodygroup = model 0 of each body part.
        let Some(sub) = bp.models.first() else { continue };
        for mesh in &sub.meshes {
            println!("  mesh material={} verts={} tris={}", mesh.material, mesh.vertex_count(), mesh.indices.len() / 3);
            verts += mesh.vertex_count();
            tris += mesh.indices.len() / 3;
            assert!(mesh.indices.iter().all(|&i| (i as usize) < mesh.vertex_count()));
            for p in mesh.positions.chunks(3) {
                for k in 0..3 {
                    min[k] = min[k].min(p[k]);
                    max[k] = max[k].max(p[k]);
                }
            }
            // Winding check: geometric normal should agree with stored vertex normals.
            for t in mesh.indices.chunks(3) {
                let p = |i: u32| &mesh.positions[i as usize * 3..i as usize * 3 + 3];
                let n = |i: u32| &mesh.normals[i as usize * 3..i as usize * 3 + 3];
                let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
                let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                let g = [
                    e1[1] * e2[2] - e1[2] * e2[1],
                    e1[2] * e2[0] - e1[0] * e2[2],
                    e1[0] * e2[1] - e1[1] * e2[0],
                ];
                let vn = n(t[0]);
                let d = g[0] * vn[0] + g[1] * vn[1] + g[2] * vn[2];
                if d.abs() > 1e-9 {
                    total += 1;
                    if d > 0.0 {
                        agree += 1;
                    }
                }
            }
        }
    }
    println!("verts={verts} tris={tris} bounds min={min:?} max={max:?}");
    println!("winding agreement: {agree}/{total}");
    for b in m.bones.iter().take(4) {
        println!("bone {} parent={} pos={:?} rot={:?}", b.name, b.parent, b.pos, b.rot);
    }
    // Bind-pose vertices are stored Y-up; the animation's root transform
    // rotates them to Source's Z-up at runtime.
    let height = max[1] - min[1];
    assert!((60.0..100.0).contains(&height), "soldier height {height}");
    assert!(tris > 1000);
    assert!(agree as f32 / total as f32 > 0.9, "winding looks inverted: {agree}/{total}");
}

#[test]
fn all_classes_parse() {
    for c in ["scout", "sniper", "soldier", "demo", "medic", "heavy", "pyro", "spy", "engineer"] {
        let Some(m) = load(&format!("models/player/{c}.mdl")) else { return };
        let tris: usize = m.body_parts.iter().flat_map(|b| &b.models).flat_map(|s| &s.meshes).map(|x| x.indices.len() / 3).sum();
        assert!(tris > 500, "{c}: {tris}");
    }
}

#[test]
fn eyeball_state_matches_eyeball_mesh() {
    for class in ["soldier", "scout"] { // heavy/others have deliberately non-spherical eyes
        let Some(m) = load(&format!("models/player/{class}.mdl")) else { return };
        let mut checked = 0;
        for sub in m.body_parts.iter().filter_map(|b| b.models.first()) {
            for eye in &sub.eyeballs {
                let mesh = sub.meshes.iter().find(|x| x.material == eye.material).unwrap_or_else(|| panic!("{class}: no mesh for {}", eye.material));
                // The eyeball mesh is a (partial) sphere: every vertex should sit at ~radius from the origin.
                let dist = |p: &[f32]| ((p[0] - eye.origin[0]).powi(2) + (p[1] - eye.origin[1]).powi(2) + (p[2] - eye.origin[2]).powi(2)).sqrt();
                let ds: Vec<f32> = mesh.positions.chunks(3).map(dist).collect();
                let (min, max) = ds.iter().fold((f32::MAX, 0.0f32), |(a, b), &d| (a.min(d), b.max(d)));
                println!("{class} {}: origin={:?} vertex distance from origin {min:.3}..{max:.3}, eye radius {:.3}", eye.material, eye.origin, eye.radius);
                assert!(max - min < 0.2, "{class}: vertices are not on a sphere around the eye origin ({min}..{max})");
                assert!(((min + max) * 0.5 - eye.radius).abs() < 0.15, "{class}: sphere radius {min}..{max} vs {}", eye.radius);
                checked += 1;
            }
        }
        assert!(checked >= 2, "{class}: expected two eyeballs, got {checked}");
    }
}

/// The iris projection scale equals the MDL `iris_scale` and does not depend on the eyeball
/// radius. Calibrated against hlmv screenshots: the Heavy (radius 0.9) and Spy (radius 0.7)
/// both show an iris about half as wide as the eye opening.
#[test]
fn iris_projection_scale_is_independent_of_eye_radius() {
    for (class, radius) in [("heavy", 0.9018f32), ("spy", 0.7)] {
        let Some(m) = load(&format!("models/player/{class}.mdl")) else { return };
        let eye = m.body_parts.iter().filter_map(|b| b.models.first()).flat_map(|s| &s.eyeballs).next().unwrap();
        assert!((eye.radius - radius).abs() < 0.01, "{class}: radius {}", eye.radius);
        let len = |v: [f32; 4]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        for v in [eye.iris_u, eye.iris_v] {
            assert!((len(v) - 1.6667).abs() < 0.01, "{class}: projection scale {}", len(v));
        }
    }
}

#[test]
fn soldier_has_a_blu_skin_with_its_own_materials() {
    let Some(m) = load("models/player/soldier.mdl") else { return };
    assert!(m.skin_count >= 2, "skins: {}", m.skin_count);
    let body = m
        .body_parts
        .iter()
        .flat_map(|b| &b.models)
        .flat_map(|s| &s.meshes)
        .find(|mesh| mesh.material.ends_with("soldier_red.vmt"))
        .expect("soldier body mesh");
    assert_eq!(body.materials[0], body.material);
    assert!(body.materials[1].ends_with("soldier_blue.vmt"), "{}", body.materials[1]);
}

#[test]
fn soldier_flexes_parse_with_plausible_deltas_and_rules() {
    let Some(m) = load("models/player/soldier.mdl") else { return };
    assert_eq!(m.flex_controllers.len(), 42);
    assert!(m.flex_controllers.iter().any(|c| c.name == "happyBig" && c.min == 0.0 && c.max == 1.0));
    assert_eq!(m.flex_rules.len(), 40);
    let head = m
        .body_parts
        .iter()
        .flat_map(|b| &b.models)
        .flat_map(|s| &s.meshes)
        .find(|mesh| mesh.material.contains("soldier_head"))
        .expect("head mesh");
    assert!(head.flexes.len() > 20, "head flexes: {}", head.flexes.len());
    // Face morphs move vertices by a few units at most; a wrong float16 decode would give garbage.
    let max = head.flexes.iter().flat_map(|f| f.deltas.iter()).fold(0f32, |a, &d| a.max(d.abs()));
    assert!(max > 0.1 && max < 5.0, "max delta {max}");
    // Every flex entry points at a real vertex of the mesh.
    assert!(head.flexes.iter().all(|f| f.vertices.iter().all(|&v| (v as usize) < head.vertex_count())));
}

#[test]
fn cosmetics_with_flexes_share_controller_names_with_the_class() {
    let Some(class) = load("models/player/soldier.mdl") else { return };
    let Some(beard) = load("models/workshop/player/items/all_class/xms_beard/xms_beard_soldier.mdl") else { return };
    assert_eq!(beard.skin_count, 1);
    let class_names: std::collections::HashSet<_> = class.flex_controllers.iter().map(|c| c.name.to_ascii_lowercase()).collect();
    let shared = beard.flex_controllers.iter().filter(|c| class_names.contains(&c.name.to_ascii_lowercase())).count();
    assert!(shared >= 30, "only {shared} controllers shared by name");
}

#[test]
fn team_skin_materials_resolve_even_with_a_leading_separator_in_cdmaterials() {
    // soldier_samurai.mdl lists its BLU material as a bare name under cdmaterials "\models\player\items\soldier\".
    let Some(m) = load("models/player/items/soldier/soldier_samurai.mdl") else { return };
    let body = m.body_parts.iter().flat_map(|b| &b.models).flat_map(|s| &s.meshes).find(|mesh| mesh.material.ends_with("samurai_red.vmt")).expect("kabuto body");
    assert_eq!(body.materials[1], "materials/models/player/items/soldier/soldier_samurai_blue.vmt");
}

#[test]
fn class_models_have_an_eyes_attachment_and_bone_space_eyeballs() {
    for class in ["soldier", "spy", "heavy"] {
        let Some(m) = load(&format!("models/player/{class}.mdl")) else { return };
        let att = m.eye_attachment.as_ref().unwrap_or_else(|| panic!("{class}: no eyes attachment"));
        assert!((att.bone as usize) < m.bones.len());
        let eyes: Vec<_> = m.body_parts.iter().flat_map(|b| &b.models).flat_map(|s| &s.eyeballs).collect();
        assert!(eyes.len() >= 2, "{class}: {} eyeballs", eyes.len());
        assert!(eyes.iter().all(|e| e.iris_scale > 1.0 && e.bone_up.iter().any(|&c| c.abs() > 0.5)));
    }
}

#[test]
fn eyequarium_has_flexible_jiggle_eyes_and_base_spring_bubbles() {
    let Some(vpk) = steam::find_tf2().map(|p| VpkSet::open_folder(&p).unwrap()) else { return };
    let bytes = vpk.read("models/workshop/player/items/all_class/hwn2021_eyequarium/hwn2021_eyequarium_soldier.mdl").unwrap();
    let m = source_formats::mdl::parse(&bytes).unwrap();
    let jiggle = |name: &str| m.bones.iter().find(|b| b.name == name).and_then(|b| b.jiggle.clone()).unwrap_or_else(|| panic!("{name} has no jiggle data"));
    let eye = jiggle("water_eye_r");
    assert_eq!(eye.flags, 0x71, "flexible + angle + length constraint + base spring bit pattern");
    assert!((eye.length - 10.0).abs() < 1e-4 && eye.yaw_stiffness == 80.0 && eye.pitch_stiffness == 80.0);
    assert!(eye.angle_limit > 0.0 && eye.angle_limit < std::f32::consts::PI);
    let bubble = jiggle("bubbles");
    assert_eq!(bubble.flags, 0x40, "base spring only");
    assert!(bubble.base_stiffness > 0.0);
    // class models carry none
    let soldier = vpk.read("models/player/soldier.mdl").unwrap();
    assert!(source_formats::mdl::parse(&soldier).unwrap().bones.iter().all(|b| b.jiggle.is_none()));
}

/// What the QC's `$lod` blocks of a class model did, as the data shows it: fewer triangles, bones collapsed onto their parents
/// (`bonetreecollapse`, `replacebone`), and the facial flexes gone from LOD 2 on (`nofacial`).
#[test]
fn class_lods_follow_the_qc_rules() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    let at = |lod| model::load_lod(&vpk, "models/player/sniper.mdl", lod).unwrap();
    let stats = |m: &Model| {
        let (mut tris, mut flexes) = (0, 0);
        let mut bones = std::collections::BTreeSet::new();
        for mesh in m.body_parts.iter().flat_map(|b| b.models.iter()).flat_map(|s| s.meshes.iter()) {
            tris += mesh.indices.len() / 3;
            flexes += mesh.flexes.len();
            for i in 0..mesh.vertex_count() { for k in 0..4 { if mesh.bone_weights[i * 4 + k] > 0.0 { bones.insert(mesh.bone_indices[i * 4 + k]); } } }
        }
        (tris, flexes, bones.len())
    };
    let m0 = at(0);
    assert!(m0.lod_count >= 3, "a class has several LODs, found {}", m0.lod_count);
    let lods: Vec<_> = (0..3).map(|l| { let m = at(l); assert_eq!(m.lod, l); stats(&m) }).collect();
    assert!(lods[0].0 > lods[1].0 && lods[1].0 > lods[2].0, "triangles fall: {lods:?}");
    assert!(lods[0].1 > 0 && lods[1].1 > 0, "the face still moves at LOD 1");
    assert_eq!(lods[2].1, 0, "nofacial: no flexes at LOD 2");
    assert!(lods[1].2 < lods[0].2 && lods[2].2 < lods[1].2, "bones are collapsed: {lods:?}");
    // a request past the last LOD gets the last one, and never the shadow LOD
    let last = at(99);
    assert_eq!(last.lod, m0.lod_count - 1);
}
