//! Builds a small prop end to end with TF2's own studiomdl. Skipped when TF2 or its tools are not installed.

use source_formats::{itemcompile::LodSpec, mdl, propcompile::*, steam, vtf, vtf_write::Compression, VpkSet};
use std::fs;

fn tga(size: u16) -> Vec<u8> {
    let mut v = vec![0u8; 18];
    v[2] = 2; v[12..14].copy_from_slice(&size.to_le_bytes()); v[14..16].copy_from_slice(&size.to_le_bytes()); v[16] = 24; v[17] = 0x20;
    for y in 0..size as usize { for x in 0..size as usize { v.extend_from_slice(&[128, (y * 4) as u8, (x * 4) as u8]); } }
    v
}

/// A cube of 20 units standing on the floor (the game's Y-up frame), one bone, six faces of two triangles.
fn cube(material: &str) -> String {
    let c = |x: f32, y: f32, z: f32| (x * 10.0, y * 20.0, z * 10.0);
    let faces: [([usize; 4], [f32; 3]); 6] = [
        ([0, 1, 3, 2], [0.0, 0.0, -1.0]), ([4, 6, 7, 5], [0.0, 0.0, 1.0]), ([0, 4, 5, 1], [0.0, -1.0, 0.0]),
        ([2, 3, 7, 6], [0.0, 1.0, 0.0]), ([0, 2, 6, 4], [-1.0, 0.0, 0.0]), ([1, 5, 7, 3], [1.0, 0.0, 0.0]),
    ];
    let corner = |i: usize| c(if i & 4 != 0 { 1.0 } else { -1.0 }, if i & 2 != 0 { 1.0 } else { 0.0 }, if i & 1 != 0 { 1.0 } else { -1.0 });
    let mut text = String::from("version 1\nnodes\n  0 \"static_prop\" -1\nend\nskeleton\ntime 0\n  0  0.000000 0.000000 0.000000  0.000000 0.000000 0.000000\nend\ntriangles\n");
    for (quad, n) in faces {
        for tri in [[0, 1, 2], [0, 2, 3]] {
            text.push_str(&format!("{material}\n"));
            for k in tri {
                let (x, y, z) = corner(quad[k]);
                text.push_str(&format!("  0  {x} {y} {z}  {} {} {}  {} {}  1 0 1.0\n", n[0], n[1], n[2], (k % 2) as f32, (k / 2) as f32));
            }
        }
    }
    text.push_str("end\n");
    text
}

#[test]
fn builds_a_prop_with_collision_into_a_folder() {
    let Some(tf) = steam::find_tf2() else { return };
    if !tf.parent().unwrap().join("bin/studiomdl.exe").is_file() { return; }
    let vpk = VpkSet::open_folder(&tf).unwrap();
    let dir = std::env::temp_dir().join(format!("workbench-prop-build-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let color = dir.join("color.tga");
    fs::write(&color, tga(64)).unwrap();
    let spec = PropSpec {
        name: "workbench_test_cube".into(), folder: "props_custom/test".into(), surfaceprop: "wood_crate".into(), mass: 25.0, static_prop: false,
        collision: Some(cube("phys")), concave: false,
        lods: vec![LodSpec { source_path: "cube.fbx".into(), smd: cube("cube"), dmx: None, triangles: 12, vertices: 24 }],
        materials: vec![PropMaterialSpec {
            name: "cube".into(), color: Some(color), normal: None, phongexponent: None, illum: None, compression: Compression::Dxt,
            vmt: "\"VertexLitGeneric\"\n{\n\t\"$basetexture\"\t\t\"models/props_custom/test/cube_color\"\n\t\"$surfaceprop\"\t\t\"wood_crate\"\n}\n".into(),
        }],
        max_texture: 1024, qc_extra: String::new(), session: "{ \"prop\": 1 }".into(),
    };
    let out = dir.join("out");
    let built = build(&vpk, &spec, &out, &dir.join("work")).unwrap_or_else(|e| panic!("build failed: {e}"));
    for rel in [
        "models/props_custom/test/workbench_test_cube.mdl", "models/props_custom/test/workbench_test_cube.vvd", "models/props_custom/test/workbench_test_cube.dx90.vtx",
        "models/props_custom/test/workbench_test_cube.phy", "materials/models/props_custom/test/cube.vmt", "materials/models/props_custom/test/cube_color.vtf",
        "workbench_test_cube.prop.txt",
    ] { assert!(out.join(rel).is_file(), "missing {rel}; wrote {:?}", built.files); }
    let m = mdl::parse(&fs::read(out.join("models/props_custom/test/workbench_test_cube.mdl")).unwrap()).unwrap();
    assert_eq!(m.bones.len(), 1);
    assert_eq!(m.bones[0].name, "static_prop");
    assert!(m.textures.iter().any(|t| t == "cube"), "{:?}", m.textures);
    assert!(m.cd_textures.iter().any(|c| c.replace('\\', "/").contains("props_custom/test")), "{:?}", m.cd_textures);
    // the sources are not written: only what the game reads, and the file that opens the prop again
    assert!(!out.join("content").exists(), "{:?}", built.files);
    // the collision file is a real one
    let phy = fs::read(out.join("models/props_custom/test/workbench_test_cube.phy")).unwrap();
    assert!(phy.len() > 100, "the .phy is {} bytes", phy.len());
    // the same prop with exact textures: the colour texture is stored uncompressed and comes back pixel for pixel
    let mut exact = spec.clone();
    exact.name = "workbench_test_exact".into();
    exact.materials[0].compression = Compression::None;
    build(&vpk, &exact, &out, &dir.join("work")).unwrap_or_else(|e| panic!("exact build failed: {e}"));
    let bytes = fs::read(out.join("materials/models/props_custom/test/cube_color.vtf")).unwrap();
    let info = vtf::info(&bytes).unwrap();
    assert_eq!((info.width, info.height), (64, 64));
    let image = vtf::decode(&bytes, 0).unwrap();
    for (x, y) in [(0usize, 0usize), (10, 7), (63, 63), (31, 40)] {
        let at = (y * 64 + x) * 4;
        assert_eq!(&image.rgba[at..at + 4], &[(x * 4) as u8, (y * 4) as u8, 128, 255], "pixel {x},{y}");
    }
    // a static prop with no collision makes no .phy
    let mut plain = spec.clone();
    plain.name = "workbench_test_plain".into();
    plain.collision = None;
    plain.static_prop = true;
    let built = build(&vpk, &plain, &out, &dir.join("work")).unwrap_or_else(|e| panic!("static build failed: {e}"));
    assert!(!out.join("models/props_custom/test/workbench_test_plain.phy").exists());
    assert!(built.files.iter().any(|f| f.ends_with("workbench_test_plain.mdl")));
    fs::remove_dir_all(&dir).unwrap();
}
