//! Material/texture decoding against the real TF2 install. Skipped when TF2 isn't found.

use source_formats::{kv, material, steam, vtf, VpkSet};

fn open() -> Option<VpkSet> {
    Some(VpkSet::open_folder(&steam::find_tf2()?).unwrap())
}

#[test]
fn vtf_image_resource_skips_particle_sheet_metadata() {
    let mut bytes = vec![0u8; 120];
    bytes[..4].copy_from_slice(b"VTF\0");
    for (at, value) in [(4, 7u32), (8, 3), (12, 96), (52, 0), (57, u32::MAX),
                        (68, 2), (80, 0x10), (84, 96), (88, 0x30), (92, 116)] {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }
    for at in [16, 18, 24] { bytes[at..at + 2].copy_from_slice(&1u16.to_le_bytes()); }
    bytes[56] = 1;
    bytes[96..116].fill(99); // sheet metadata is deliberately unlike the pixels
    bytes[116..120].copy_from_slice(&[7, 11, 13, 255]);
    let image = vtf::decode(&bytes, 0).unwrap();
    assert_eq!((image.width, image.height), (1, 1));
    assert_eq!(image.rgba, [7, 11, 13, 255]);
    bytes[92..96].copy_from_slice(&200u32.to_le_bytes());
    assert!(vtf::decode(&bytes, 0).is_err(), "out-of-bounds image must fail");
}

#[test]
fn kv_parses_basics() {
    let n = kv::parse("\"VertexLitGeneric\"\n{\n  // c\n  \"$basetexture\" \"a\\b\"\n  $x 1 [$X360]\n  proxies { A { b 1 } }\n}").unwrap();
    let b = n[0].block().unwrap();
    assert_eq!(kv::find(b, "$BASETEXTURE").unwrap().as_str(), Some("a\\b"));
    assert!(kv::find(b, "$x").is_none(), "x360 conditional must be dropped");
    assert!(kv::find(b, "proxies").unwrap().block().is_some());
}

#[test]
fn every_class_material_decodes() {
    let Some(vpk) = open() else { return };
    let mut checked = 0;
    for path in vpk.search("materials/models/player/", usize::MAX).into_iter().filter(|p| p.ends_with(".vmt")) {
        let Ok(m) = material::load(&vpk, path) else { continue };
        for (_, img) in &m.textures {
            assert!(img.width.is_power_of_two() && img.height.is_power_of_two(), "{path}");
            assert_eq!(img.rgba.len(), (img.width * img.height * 4) as usize);
            checked += 1;
        }
    }
    assert!(checked > 20, "only {checked} textured player materials decoded");
}

#[test]
fn soldier_texture_is_not_blank() {
    let Some(vpk) = open() else { return };
    let m = material::load(&vpk, "materials/models/player/soldier/soldier_red.vmt").unwrap();
    println!("{:?} shader={} textures={:?}", m.path, m.shader, m.textures.iter().map(|(s, i)| (s.as_str(), i.width, i.height)).collect::<Vec<_>>());
    assert!(m.errors.is_empty(), "{:?}", m.errors);
    let img = m.textures.iter().find(|(s, _)| s == "base").map(|(_, i)| i.clone()).expect("base texture");
    println!("{}x{}", img.width, img.height);
    let mean: f64 = img.rgba.chunks(4).map(|p| (p[0] as f64 + p[1] as f64 + p[2] as f64) / 3.0).sum::<f64>() / (img.width * img.height) as f64;
    assert!(mean > 20.0 && mean < 235.0, "mean brightness {mean}");
    // Mip selection works.
    let bytes = vpk.read("materials/models/player/soldier/soldier_red.vtf").unwrap();
    let small = vtf::decode(&bytes, 2).unwrap();
    assert_eq!(small.width, img.width / 4);
}

#[test]
fn eye_material_has_all_textures_and_cubemap() {
    let Some(vpk) = open() else { return };
    let m = material::load(&vpk, "materials/models/player/scout/eyeball_l.vmt").unwrap();
    assert_eq!(m.shader, "eyerefract");
    assert!(m.errors.is_empty(), "{:?}", m.errors);
    let slots: Vec<&str> = m.textures.iter().map(|(s, _)| s.as_str()).collect();
    for want in ["base", "cornea", "ao", "warp", "env0", "env1", "env2", "env3", "env4", "env5"] {
        assert!(slots.contains(&want), "missing {want}: {slots:?}");
    }
    let faces: Vec<_> = m.textures.iter().filter(|(s, _)| s.starts_with("env")).collect();
    assert!(faces.iter().all(|(_, i)| i.width == faces[0].1.width && i.height == faces[0].1.height));
    // The cornea/iris textures are clamped in the original shader setup.
    let cornea = &m.textures.iter().find(|(s, _)| s == "cornea").unwrap().1;
    println!("cornea flags {:#x}, iris flags {:#x}", cornea.flags, m.textures.iter().find(|(s, _)| s == "base").unwrap().1.flags);
}

#[test]
fn paintable_items_expose_their_tint_proxy_chain() {
    let Some(vpk) = open() else { return };
    let m = material::load(&vpk, "materials/models/player/items/soldier/soldier_samurai_red.vmt").unwrap();
    let names: Vec<&str> = m.proxies.iter().map(|p| p.name.as_str()).collect();
    let pos = |n: &str| names.iter().position(|x| *x == n).unwrap_or_else(|| panic!("no {n} proxy in {names:?}"));
    // ItemTintColor -> $colortint_tmp, then SelectFirstIfNonZero(tmp, base) -> $color2, then Multiply by $yellow.
    assert!(pos("itemtintcolor") < pos("selectfirstifnonzero") && pos("selectfirstifnonzero") < pos("multiply"));
    let sel = &m.proxies[pos("selectfirstifnonzero")];
    assert_eq!(sel.params.get("srcvar1").map(String::as_str), Some("$colortint_tmp"));
    assert_eq!(sel.params.get("srcvar2").map(String::as_str), Some("$colortint_base"));
    assert_eq!(sel.params.get("resultvar").map(String::as_str), Some("$color2"));
    assert_eq!(m.param("$blendtintcoloroverbase"), Some("1"));
    assert_eq!(m.param("$colortint_base"), Some("{126 46 49}"));
}

#[test]
fn env_cubemap_resolves_to_hlmvs_default_cubemap() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    // Uses `$envmap env_cubemap`; hlmv reflects its own HDR `hlmv/cubemap` there (stored as half floats).
    let m = material::load(&vpk, "materials/models/roller/rollermine_sheet.vmt").unwrap();
    let faces: Vec<_> = m.textures.iter().filter(|(slot, _)| slot.starts_with("env")).collect();
    assert_eq!(faces.len(), 6, "errors: {:?}", m.errors);
    for (_, img) in &faces {
        assert!(img.width <= 256 && img.width == img.height);
        let sum: u64 = img.rgba.chunks_exact(4).map(|p| p[0] as u64 + p[1] as u64 + p[2] as u64).sum();
        assert!(sum > 0, "face is black");
    }
}

#[test]
fn mask_textures_are_loaded_into_their_own_slots() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    let m = material::load(&vpk, "materials/models/player/items/all_class/pumpkin_lantern.vmt").unwrap();
    assert!(m.textures.iter().any(|(s, _)| s == "illum"), "selfillummask missing: {:?}", m.errors);
}

#[test]
fn dx_conditional_blocks_are_applied_to_material_params() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    // `$selfillum 1` only exists inside a ">=DX90" block of the glowing half of Two Faced Terror.
    let m = material::load(&vpk, "materials/models/workshop/player/items/pyro/hwn2026_two_faced/hwn2026_two_faced_1.vmt").unwrap();
    assert!(m.flag("$selfillum"), "{:?}", m.params);
    assert!(m.textures.iter().any(|(s, _)| s == "illum"));
    // ... and the opaque half turns it off again in the same way
    let body = material::load(&vpk, "materials/models/workshop/player/items/pyro/hwn2026_two_faced/hwn2026_two_faced.vmt").unwrap();
    assert!(!body.flag("$selfillum"));
}

#[test]
fn animated_base_textures_keep_all_their_frames() {
    let Some(tf) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&tf).unwrap();
    // The Festive lights cycle the 3 frames of their base texture with an AnimatedTexture proxy.
    let m = material::load(&vpk, "materials/models/weapons/c_items/festive_lights_red.vmt").unwrap();
    let frames: Vec<_> = m.textures.iter().filter(|(s, _)| s == "base" || s.starts_with("base_f")).collect();
    assert_eq!(frames.len(), 3, "errors: {:?}", m.errors);
    // The frames differ (each lights a different set of bulbs).
    let base = &m.textures.iter().find(|(s, _)| s == "base").unwrap().1.rgba;
    let f1 = &m.textures.iter().find(|(s, _)| s == "base_f1").unwrap().1.rgba;
    assert_ne!(base, f1, "frame 1 equals frame 0");
    // A material without the proxy keeps just its single frame.
    let plain = material::load(&vpk, "materials/models/player/soldier/soldier_red.vmt").unwrap();
    assert!(plain.textures.iter().all(|(s, _)| !s.starts_with("base_f")));
}

#[test]
fn ubercharge_material_keeps_the_frames_of_its_animated_normal_map() {
    let Some(vpk) = open() else { return };
    let red = material::load(&vpk, "materials/models/effects/invulnfx_red.vmt").unwrap();
    let frames = red.textures.iter().filter(|(slot, _)| slot.starts_with("bump_f")).count();
    assert!(frames > 8, "the water normal map cycles through many frames, found {frames}");
    assert!(red.textures.iter().any(|(slot, _)| slot == "bump"));
    // an ordinary material has none
    let scout = material::load(&vpk, "materials/models/player/scout/scout_red.vmt").unwrap();
    assert!(!scout.textures.iter().any(|(slot, _)| slot.starts_with("bump_f")));
}

#[test]
fn burn_fire_layer_loads_as_one_block_of_frames() {
    let Some(vpk) = open() else { return };
    let bytes = material::texture_frames(&vpk, "effects/tiledfire/fireLayeredSlowTiled512.vtf", 128).unwrap();
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    let (w, h, n) = (word(0), word(4), word(8));
    assert_eq!((w, h), (64, 64));
    assert!(n > 100, "the fire layer cycles through 121 frames, found {n}");
    assert_eq!(bytes.len(), 12 + n * w * h * 4);
    // player skins name it but do not carry it
    let scout = material::load(&vpk, "materials/models/player/scout/scout_red.vmt").unwrap();
    assert!(!scout.textures.iter().any(|(slot, _)| slot.contains("detail")));
}
