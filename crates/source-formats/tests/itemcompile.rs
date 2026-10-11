//! Builds a small cosmetic end to end with TF2's own studiomdl. Skipped when TF2 or its tools are not installed.

use source_formats::{itemcompile::*, mdl, model, steam, vtf, vtx, vvd, zipfs::ZipFile, VpkSet};
use std::{fs, path::PathBuf};

fn tga(size: u16, alpha: bool, f: impl Fn(usize, usize) -> [u8; 4]) -> Vec<u8> {
    let depth = if alpha { 32u8 } else { 24 };
    let mut v = vec![0u8; 18];
    v[2] = 2; v[12..14].copy_from_slice(&size.to_le_bytes()); v[14..16].copy_from_slice(&size.to_le_bytes()); v[16] = depth; v[17] = 0x20 | if alpha { 8 } else { 0 };
    for y in 0..size as usize { for x in 0..size as usize { let p = f(x, y); v.extend_from_slice(&[p[2], p[1], p[0]]); if alpha { v.push(p[3]); } } }
    v
}

/// A flat tile standing on a head bone: two triangles.
const SMD: &str = "version 1\nnodes\n  0 \"bip_pelvis\" -1\n  1 \"bip_head\" 0\nend\nskeleton\ntime 0\n  0  0.000000 47.645508 -1.752142  2.952960 0.000000 0.000000\n  1  0.000000 -14.500000 0.000000  0.000000 0.000000 0.000000\nend\ntriangles\ntile\n  1  -5.0 80.0 0.0  0.0 1.0 0.0  0.0 0.0  1 1 1.0\n  1  5.0 80.0 0.0  0.0 1.0 0.0  1.0 0.0  1 1 1.0\n  1  5.0 80.0 -10.0  0.0 1.0 0.0  1.0 1.0  1 1 1.0\ntile\n  1  -5.0 80.0 0.0  0.0 1.0 0.0  0.0 0.0  1 1 1.0\n  1  5.0 80.0 -10.0  0.0 1.0 0.0  1.0 1.0  1 1 1.0\n  1  -5.0 80.0 -10.0  0.0 1.0 0.0  0.0 1.0  1 1 1.0\nend\n";

#[test]
fn builds_a_cosmetic_the_importers_way() {
    let Some(tf) = steam::find_tf2() else { return };
    if !tf.parent().unwrap().join("bin/studiomdl.exe").is_file() { return; }
    let vpk = VpkSet::open_folder(&tf).unwrap();
    let dir = std::env::temp_dir().join(format!("workbench-item-build-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let color = dir.join("color.tga");
    fs::write(&color, tga(64, false, |x, y| [(x * 4) as u8, (y * 4) as u8, 128, 255])).unwrap();
    let exponent = dir.join("exp.tga");
    fs::write(&exponent, tga(32, true, |_, _| [178, 255, 0, 255])).unwrap();
    let icon = dir.join("icon.tga");
    fs::write(&icon, tga(512, true, |x, y| if (91..420).contains(&y) && (200..300).contains(&x) { [200, 60, 60, 255] } else { [0, 0, 0, 0] })).unwrap();
    let spec = ItemSpec {
        name: "workbench_test_tile".into(), display_name: "Test Tile".into(), prefab: "hat".into(), equip_region: "hat".into(),
        bodygroups: vec!["hat".into()], paintable: false,
        classes: vec![ClassSpec { folder: "sniper".into(), qc_extra: String::new(), lods: vec![LodSpec { source_path: "tile.fbx".into(), smd: SMD.replace("tile", "workbench_test_tile"), triangles: 2, vertices: 4 }] }],
        materials: vec![MaterialSpec { source_name: "tile".into(), vmt: "\"VertexLitGeneric\"\n{\n\t\"$basetexture\"\t\t\"models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_color\"\n}\n".into(),
            color: Some(color), normal: None, phongexponent: Some(exponent), illum: None, blue: None }],
        icon,
    };
    let built = build(&vpk, &spec, &dir.join("out"), &dir.join("work")).unwrap_or_else(|e| panic!("build failed: {e}"));
    assert!(built.zip.is_file() && built.session.is_file());

    // the archive reads back the way the importer's own do
    let zip = ZipFile::open(&built.zip).unwrap();
    let manifest = zip.manifest().unwrap();
    assert!(manifest.contains("\"model_player\"") && manifest.contains("workbench_test_tile.mdl"));
    for path in [
        "models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.mdl", "models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.vvd",
        "models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.dx90.vtx", "materials/models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.vmt",
        "materials/models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_color.vtf", "materials/models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_phongexponent.vtf",
        "materials/backpack/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.vtf", "materials/backpack/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_large.vtf",
        "content/models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.qc",
    ] { assert!(zip.contains(path), "missing {path}"); }

    // the compiled model is what the viewer loads: the class's bones, two triangles, the item's material
    let stem = "models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile";
    let m = mdl::parse(&zip.read(&format!("{stem}.mdl")).unwrap()).unwrap();
    assert!(m.bones.iter().any(|b| b.name == "bip_head"));
    let v = vvd::parse(&zip.read(&format!("{stem}.vvd")).unwrap(), 0).unwrap();
    let t = vtx::parse(&zip.read(&format!("{stem}.dx90.vtx")).unwrap(), 0).unwrap();
    let loaded = model::build("x.mdl", &m, &v, &t, &|name: &str, _: &[String]| name.to_string()).unwrap();
    let mesh = &loaded.body_parts[0].models[0].meshes[0];
    assert_eq!(mesh.indices.len() / 3, 2);
    assert_eq!(mesh.material, "workbench_test_tile");

    // and the textures are the ones that were given, flat colour included
    let exp = vtf::decode(&zip.read("materials/models/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_phongexponent.vtf").unwrap(), 0).unwrap();
    assert!(exp.rgba.chunks_exact(4).all(|p| (p[0] as i32 - 178).abs() <= 2 && (p[1] as i32 - 255).abs() <= 2 && p[2] <= 2), "the flat phong exponent stays flat");
    let big = vtf::info(&zip.read("materials/backpack/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile_large.vtf").unwrap()).unwrap();
    assert_eq!((big.width, big.height), (512, 512));
    let small = vtf::info(&zip.read("materials/backpack/workshop/player/items/sniper/workbench_test_tile/workbench_test_tile.vtf").unwrap()).unwrap();
    assert_eq!((small.width, small.height), (128, 128));
    // an item with models for two classes goes in all_class, with a model of its own for each
    let mut multi = spec.clone();
    multi.name = "workbench_test_multi".into();
    multi.classes = vec![
        ClassSpec { folder: "sniper".into(), qc_extra: String::new(), lods: spec.classes[0].lods.clone() },
        ClassSpec { folder: "scout".into(), qc_extra: String::new(), lods: spec.classes[0].lods.clone() },
    ];
    for c in &mut multi.classes { c.lods[0].smd = c.lods[0].smd.replace("workbench_test_tile", "workbench_test_multi"); }
    let built_multi = build(&vpk, &multi, &dir.join("out"), &dir.join("work")).unwrap_or_else(|e| panic!("multiclass build failed: {e}"));
    let zip = ZipFile::open(&built_multi.zip).unwrap();
    let folder = "workshop/player/items/all_class/workbench_test_multi";
    for class in ["sniper", "scout"] {
        for ext in ["mdl", "vvd", "dx90.vtx"] {
            let p = format!("models/{folder}/workbench_test_multi_{class}.{ext}");
            assert!(zip.contains(&p), "missing {p}");
        }
        assert!(zip.contains(&format!("content/models/{folder}/workbench_test_multi_{class}.qc")));
    }
    assert!(zip.contains(&format!("materials/models/{folder}/workbench_test_multi_color.vtf")));
    assert!(zip.contains("materials/backpack/workshop/player/items/all_class/workbench_test_multi/workbench_test_multi_large.vtf"));
    let manifest = zip.manifest().unwrap();
    assert!(manifest.contains("\"model_player_per_class\"") && !manifest.contains("\"model_player\""));
    assert!(manifest.contains("workbench_test_multi_scout.mdl") && manifest.contains("\"class\"\t\t\"all_class\""));
    let qc = String::from_utf8(zip.read(&format!("content/models/{folder}/workbench_test_multi_scout.qc")).unwrap()).unwrap();
    assert!(qc.contains("all_class/workbench_test_multi/workbench_test_multi_scout.mdl") && qc.contains("all_class\\workbench_test_multi"), "{qc}");
    // both classes' models load with the item's material
    let m = mdl::parse(&zip.read(&format!("models/{folder}/workbench_test_multi_scout.mdl")).unwrap()).unwrap();
    assert!(m.cd_textures.iter().any(|c| c.contains("all_class")) && m.textures.iter().any(|t| t == "workbench_test_multi"));
      // a team-coloured item: a BLU material file per material, its own diffuse texture, two skin families
    let blue_tga = dir.join("blue.tga");
    fs::write(&blue_tga, tga(64, false, |x, y| [128, (y * 4) as u8, (x * 4) as u8, 255])).unwrap();
    let mut team = spec.clone();
    team.name = "workbench_test_team".into();
    team.classes[0].lods[0].smd = team.classes[0].lods[0].smd.replace("workbench_test_tile", "workbench_test_team");
    team.materials[0].vmt = team.materials[0].vmt.replace("workbench_test_tile", "workbench_test_team");
    team.materials[0].blue = Some(BlueSpec { vmt: team.materials[0].vmt.replace("_color", "_blue_color"), color: Some(blue_tga.clone()) });
    let built_team = build(&vpk, &team, &dir.join("out"), &dir.join("work")).unwrap_or_else(|e| panic!("team build failed: {e}"));
    let zip = ZipFile::open(&built_team.zip).unwrap();
    let materials = "materials/models/workshop/player/items/sniper/workbench_test_team";
    for file in ["workbench_test_team.vmt", "workbench_test_team_blue.vmt", "workbench_test_team_color.vtf", "workbench_test_team_blue_color.vtf", "workbench_test_team_phongexponent.vtf"] {
        assert!(zip.contains(&format!("{materials}/{file}")), "missing {file}");
    }
    assert!(zip.contains("content/materialsrc/models/workshop/player/items/sniper/workbench_test_team/workbench_test_team_blue_color.tga"));
    let qc = String::from_utf8(zip.read("content/models/workshop/player/items/sniper/workbench_test_team/workbench_test_team.qc").unwrap()).unwrap();
    assert!(qc.contains("{ \"workbench_test_team\" }") && qc.contains("{ \"workbench_test_team_blue\" }"), "{qc}");
    let manifest = zip.manifest().unwrap();
    assert!(manifest.contains("\"skin_type\"		\"1\""));
    let blue = &manifest[manifest.find("				\"blue\"").expect("a blue skin")..];
    assert!(blue.contains("workbench_test_team_blue_color.tga") && blue.contains("workbench_test_team_phongexponent.tga"));
    let blue_vtf = vtf::decode(&zip.read(&format!("{materials}/workbench_test_team_blue_color.vtf")).unwrap(), 0).unwrap();
    let red_vtf = vtf::decode(&zip.read(&format!("{materials}/workbench_test_team_color.vtf")).unwrap(), 0).unwrap();
    assert_ne!(blue_vtf.rgba[..16], red_vtf.rgba[..16], "the BLU texture is the one given");
    // a team-coloured item whose BLU skin shares the RED diffuse texture writes no second texture
    let mut shared = team.clone();
    shared.name = "workbench_test_share".into();
    shared.classes[0].lods[0].smd = shared.classes[0].lods[0].smd.replace("workbench_test_team", "workbench_test_share");
    shared.materials[0].blue = Some(BlueSpec { vmt: shared.materials[0].vmt.clone(), color: None });
    let built_share = build(&vpk, &shared, &dir.join("out"), &dir.join("work")).unwrap_or_else(|e| panic!("shared build failed: {e}"));
    let zip = ZipFile::open(&built_share.zip).unwrap();
    assert!(zip.contains("materials/models/workshop/player/items/sniper/workbench_test_share/workbench_test_share_blue.vmt"));
    assert!(!zip.contains("materials/models/workshop/player/items/sniper/workbench_test_share/workbench_test_share_blue_color.vtf"));
    // a jiggle bone: the QC block goes in the QC and the compiled model carries the bone's physics
    let mut jiggle = spec.clone();
    jiggle.name = "workbench_test_jiggle".into();
    jiggle.classes[0].lods[0].smd = jiggle.classes[0].lods[0].smd.replace("workbench_test_tile", "workbench_test_jiggle");
    jiggle.materials[0].vmt = jiggle.materials[0].vmt.replace("workbench_test_tile", "workbench_test_jiggle");
    jiggle.classes[0].qc_extra = "$jigglebone \"bip_head\"
{
	is_flexible
	{
		length 12
		tip_mass 0
		pitch_stiffness 80
		pitch_damping 6
		yaw_stiffness 90
		yaw_damping 5
		along_stiffness 100
		along_damping 0
		yaw_constraint -30 30
		yaw_friction 0
		yaw_bounce 0
	}
}
".into();
    let built_jiggle = build(&vpk, &jiggle, &dir.join("out"), &dir.join("work")).unwrap_or_else(|e| panic!("jiggle build failed: {e}"));
    let zip = ZipFile::open(&built_jiggle.zip).unwrap();
    let qc = String::from_utf8(zip.read("content/models/workshop/player/items/sniper/workbench_test_jiggle/workbench_test_jiggle.qc").unwrap()).unwrap();
    assert!(qc.contains("$jigglebone \"bip_head\"") && qc.contains("yaw_constraint -30 30"), "{qc}");
    let compiled = mdl::parse(&zip.read("models/workshop/player/items/sniper/workbench_test_jiggle/workbench_test_jiggle.mdl").unwrap()).unwrap();
    let head = compiled.bones.iter().find(|b| b.name == "bip_head").expect("the head bone");
    let physics = head.jiggle.as_ref().expect("the head bone has jiggle physics");
    assert!((physics.length - 12.0).abs() < 1e-3 && (physics.yaw_stiffness - 90.0).abs() < 1e-3 && (physics.pitch_damping - 6.0).abs() < 1e-3, "{physics:?}");
    // building again replaces the archive
    build(&vpk, &spec, &dir.join("out"), &dir.join("work")).unwrap();
    assert!(!built.zip.with_extension("zip.bak").exists());
    let _ = PathBuf::new();
    fs::remove_dir_all(&dir).unwrap();
}
