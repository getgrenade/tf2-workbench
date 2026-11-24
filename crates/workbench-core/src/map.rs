//! Maps for the scene: the list of the game's maps, a map's geometry, lightmap and props as one binary payload, and its materials.

use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

/// The light of the map loaded last, to ask it where the characters stand.
static LIGHT: Mutex<Option<(String, Arc<source_formats::bsp::MapLight>)>> = Mutex::new(None);

/// The maps in the game's `maps` folder (names without `.bsp`), sorted.
pub fn list_maps(state: &AppState) -> Result<Vec<String>, String> {
    let vpk = state.vpk()?;
    let Some(root) = vpk.game_root() else { return Ok(Vec::new()) };
    // the .bsp files of a folder: their names (without .bsp), lower case
    let bsps = |dir: &std::path::Path| -> Vec<String> {
        std::fs::read_dir(dir)
            .map(|d| {
                d.flatten()
                    .filter(|e| e.path().is_file())
                    .filter_map(|e| e.file_name().to_string_lossy().to_ascii_lowercase().strip_suffix(".bsp").filter(|n| !n.is_empty() && !n.contains('/')).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let subdirs = |dir: &std::path::Path| -> Vec<String> {
        std::fs::read_dir(dir).map(|d| d.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default()
    };
    // the game's own
    let mut out: Vec<String> = bsps(&root.join("maps")).into_iter().filter(|n| n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')).collect();
    // the others, by their path: the servers' (download/maps), the custom folders', the workshop's
    out.extend(bsps(&root.join("download").join("maps")).into_iter().map(|n| format!("download/maps/{n}")));
    for pack in subdirs(&root.join("custom")) {
        out.extend(bsps(&root.join("custom").join(&pack).join("maps")).into_iter().map(|n| format!("custom/{pack}/maps/{n}")));
    }
    let workshop = root.join("maps").join("workshop");
    out.extend(bsps(&workshop).into_iter().map(|n| format!("maps/workshop/{n}")));
    for id in subdirs(&workshop) {
        out.extend(bsps(&workshop.join(&id)).into_iter().map(|n| format!("maps/workshop/{id}/{n}")));
    }
    // Source Filmmaker's workshop items' maps: the items it unpacked (one folder of maps) and those Steam keeps (one folder per item)
    for dir in source_formats::steam::sfm_workshop_dirs(root) {
        out.extend(bsps(&dir.join("maps")).into_iter().map(|n| format!("sfm/{n}")));
        for id in subdirs(&dir) {
            out.extend(bsps(&dir.join(&id).join("maps")).into_iter().chain(bsps(&dir.join(&id))).map(|n| format!("sfm-workshop/{id}/{n}")));
        }
    }
    if let Some(steam) = source_formats::vpk::steam_workshop(root) {
        for id in subdirs(&steam) {
            out.extend(bsps(&steam.join(&id)).into_iter().map(|n| format!("steam-workshop/{id}/{n}")));
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// A map's file, by its name (see `VpkSet::map_path`).
fn map_bytes(vpk: &source_formats::VpkSet, name: &str) -> Result<Vec<u8>, String> {
    let path = vpk.map_path(name).ok_or("not a map name")?;
    std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))
}

fn push_f32(blob: &mut Vec<u8>, v: &[f32]) -> usize {
    let at = blob.len();
    for x in v {
        blob.extend_from_slice(&x.to_le_bytes());
    }
    at
}

/// A map as `[u32 json length][json][pad to 4][blob]`: the meshes (offsets into the blob of their f32 / u32 arrays), the props, the spawn
/// points, the lightmap atlas (RGBA), the sky and the bounds. The files the map packs are mounted first (its materials and models).
pub fn load_map(state: &AppState, name: &str) -> Result<Vec<u8>, String> {
    let vpk = state.vpk()?;
    vpk.mount_map(name).map_err(|e| e.to_string())?;
    let bytes = map_bytes(&vpk, name)?;
    let map = source_formats::bsp::read(&bytes).map_err(|e| e.to_string())?;
    let mut blob = Vec::new();
    let meshes: Vec<_> = map
        .meshes
        .iter()
        .map(|m| {
            let pos = push_f32(&mut blob, &m.positions);
            let normal = push_f32(&mut blob, &m.normals);
            let uv = push_f32(&mut blob, &m.uvs);
            let lightmap = push_f32(&mut blob, &m.lightmap_uvs);
            let blend = push_f32(&mut blob, &m.blend);
            let tangent_s = push_f32(&mut blob, &m.tangents_s);
            let tangent_t = push_f32(&mut blob, &m.tangents_t);
            let index = blob.len();
            for i in &m.indices {
                blob.extend_from_slice(&i.to_le_bytes());
            }
            json!({ "material": m.material, "vertexCount": m.positions.len() / 3, "indexCount": m.indices.len(), "pos": pos, "normal": normal, "uv": uv, "lightmap": lightmap, "blend": blend, "tangentS": tangent_s, "tangentT": tangent_t, "index": index })
        })
        .collect();
    let lightmap = blob.len();
    blob.extend_from_slice(&map.lightmap);
    let props: Vec<_> = map.props.iter().map(|p| json!({ "index": p.static_index, "model": p.model, "origin": p.origin, "angles": p.angles, "skin": p.skin, "scale": p.scale, "ambient": p.ambient, "sunlit": p.sunlit, "key": p.key.map(|(dir, color)| json!({ "dir": dir, "color": color })), "animation": p.animation })).collect();
    // the average light of the lit faces (linear), to set the exposure by, as the game's auto exposure does
    let page = (map.lightmap_width * map.lightmap_height * 4) as usize;
    let (mut sum, mut n) = (0.0f64, 0usize);
    for px in map.lightmap[..page.min(map.lightmap.len())].chunks_exact(4) {
        if px[0] | px[1] | px[2] == 0 {
            continue;
        }
        let lum = 0.2126 * (px[0] as f64 / 255.0).powi(2) + 0.7152 * (px[1] as f64 / 255.0).powi(2) + 0.0722 * (px[2] as f64 / 255.0).powi(2);
        sum += lum * source_formats::bsp::LIGHTMAP_RANGE as f64;
        n += 1;
    }
    let average_light = if n > 0 { sum / n as f64 } else { 0.0 };
    let spawns: Vec<_> = map.spawns.iter().map(|s| json!({ "origin": s.origin, "yaw": s.yaw, "team": s.team })).collect();
    let header = serde_json::to_vec(&json!({
        "name": name,
        "meshes": meshes,
        "props": props,
        "spawns": spawns,
        "lightmap": { "width": map.lightmap_width, "height": map.lightmap_height, "pages": source_formats::bsp::LIGHTMAP_PAGES, "offset": lightmap, "range": source_formats::bsp::LIGHTMAP_RANGE, "average": average_light },
        "sun": map.sun.map(|s| json!({ "dir": s.dir, "color": s.color })),
        "exposureMin": map.exposure_min,
        "cubemaps": map.cubemaps,
        "shadow": map.shadow.map(|s| json!({ "dir": s.dir, "color": s.color, "distance": s.distance })),
        "exposureMax": map.exposure_max,
        "sky": map.sky,
        "bounds": map.bounds,
    }))
    .map_err(|e| e.to_string())?;
    *LIGHT.lock().unwrap() = Some((name.to_string(), Arc::new(map.light)));
    let mut out = Vec::with_capacity(8 + header.len() + blob.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    while out.len() % 4 != 0 {
        out.push(0);
    }
    out.extend_from_slice(&blob);
    Ok(out)
}

/// The light of the loaded map at points (map units): per point its ambient cube (+X -X +Y -Y +Z -Z, linear) and its key light (the
/// direction toward it and its colour), as the game would light a character there; null when no map is loaded or it is another.
pub fn light_at(name: &str, points: &[[f32; 3]]) -> Result<serde_json::Value, String> {
    let light = LIGHT.lock().unwrap().as_ref().filter(|(n, _)| n == name).map(|(_, l)| l.clone());
    let Some(light) = light else { return Ok(serde_json::Value::Null) };
    Ok(serde_json::Value::Array(
        points
            .iter()
            .map(|&p| {
                let at = light.light_at(p);
                json!({ "cube": at.cube, "key": at.key.map(|(dir, color)| json!({ "dir": dir, "color": color })) })
            })
            .collect(),
    ))
}

/// A map material as `[u32 json length][json][pad to 4][blob]`: its shader, the parameters that change how it is drawn, and its base
/// textures (RGBA) no bigger than `max_size`.
pub fn map_material(state: &AppState, name: &str, max_size: u32) -> Result<Vec<u8>, String> {
    let vpk = state.vpk()?;
    let m = source_formats::bsp::map_material(&vpk, name, max_size.clamp(16, 4096))?;
    let mut blob = Vec::new();
    let textures: Vec<_> = m
        .textures
        .iter()
        .map(|(slot, img)| {
            let offset = blob.len();
            blob.extend_from_slice(&img.rgba);
            while blob.len() % 4 != 0 {
                blob.push(0);
            }
            json!({ "slot": slot, "width": img.width, "height": img.height, "offset": offset })
        })
        .collect();
    let proxies: Vec<_> = m.proxies.iter().map(|p| json!({ "name": p.name, "params": p.params })).collect();
    let header = serde_json::to_vec(&json!({ "shader": m.shader, "params": m.params, "textures": textures, "proxies": proxies })).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(8 + header.len() + blob.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    while out.len() % 4 != 0 {
        out.push(0);
    }
    out.extend_from_slice(&blob);
    Ok(out)
}

/// A 3x4 row-major transform.
type M34 = [f32; 12];

fn quat_pos(q: [f32; 4], p: [f32; 3]) -> M34 {
    let [x, y, z, w] = q;
    [
        1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w), p[0],
        2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w), p[1],
        2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y), p[2],
    ]
}

fn mul34(a: &M34, b: &M34) -> M34 {
    let mut o = [0.0; 12];
    for r in 0..3 {
        for c in 0..4 {
            o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + if c == 3 { a[r * 4 + 3] } else { 0.0 };
        }
    }
    o
}

/// A model as a map shows it: its vertices in the pose of its first sequence (the game draws a prop posed by its bones, and a model's
/// bind pose can be turned from that: a resupply locker's is a quarter turn off), as `load_model` encodes a model.
/// The lighting the map baked into its static props' vertices (`sp_hdr_<n>.vhv`, else `sp_<n>.vhv`, in its own files), as the game
/// draws them by: for each of `indices` (the props' static numbers), RGBA bytes (gamma, half the light: the game doubles it) for
/// every vertex of the model's meshes as `load_map_model` gives them (each body part's first model). A prop the map baked nothing
/// for (or whose list doesn't fit its model) has all zero there.
pub fn load_map_prop_light(state: &AppState, map: &str, path: &str, indices: &[u32]) -> Result<Vec<u8>, String> {
    let vpk = state.vpk()?;
    vpk.mount_map(map).map_err(|e| e.to_string())?;
    let model = source_formats::model::load(&vpk, &path.to_ascii_lowercase()).map_err(|e| e.to_string())?;
    // the meshes the lighting lists (all of every body part's models), and which of them are drawn
    let mut all: Vec<(&source_formats::model::Mesh, bool)> = Vec::new();
    for part in &model.body_parts {
        for (m, sub) in part.models.iter().enumerate() {
            all.extend(sub.meshes.iter().map(|mesh| (mesh, m == 0)));
        }
    }
    let drawn: usize = all.iter().filter(|(_, d)| *d).map(|(m, _)| m.vertex_ids.len()).sum();
    let mut out = vec![0u8; indices.len() * drawn * 4];
    for (k, &index) in indices.iter().enumerate() {
        let Some(file) = vpk.map_file(map, &format!("sp_hdr_{index}.vhv")).or_else(|| vpk.map_file(map, &format!("sp_{index}.vhv"))) else { continue };
        let Some(lists) = vhv_lists(&file) else { continue };
        // the first level of detail's lists, a mesh each, in the model's order
        let lod0: Vec<&[u8]> = lists.iter().filter(|(lod, _)| *lod == 0).map(|(_, l)| *l).collect();
        if lod0.len() != all.len() || all.iter().zip(&lod0).any(|((m, _), l)| m.vertex_ids.iter().any(|&v| (v as usize + 1) * 4 > l.len())) {
            continue;
        }
        let mut at = k * drawn * 4;
        for ((mesh, shown), list) in all.iter().zip(&lod0) {
            if !shown {
                continue;
            }
            for &v in &mesh.vertex_ids {
                let c = &list[v as usize * 4..v as usize * 4 + 4];
                // (stored as BGRA)
                out[at..at + 4].copy_from_slice(&[c[2], c[1], c[0], 255]);
                at += 4;
            }
        }
    }
    Ok(out)
}

/// The lists of a `.vhv` file: (level of detail, its vertices' colours, 4 bytes each).
fn vhv_lists(file: &[u8]) -> Option<Vec<(u32, &[u8])>> {
    let u32_at = |at: usize| file.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    if u32_at(0)? != 2 || u32_at(12)? != 4 {
        return None;
    }
    let meshes = u32_at(20)? as usize;
    (0..meshes)
        .map(|m| {
            let h = 40 + m * 28;
            let (lod, count, offset) = (u32_at(h)?, u32_at(h + 4)? as usize, u32_at(h + 8)? as usize);
            Some((lod, file.get(offset..offset + count * 4)?))
        })
        .collect()
}

pub fn load_map_model(state: &AppState, path: &str) -> Result<Vec<u8>, String> {
    let vpk = state.vpk()?;
    let mut model = source_formats::model::load(&vpk, &path.to_ascii_lowercase()).map_err(|e| e.to_string())?;
    let set = state.anim_set(path).ok();
    let n = model.bones.len();
    if let Some(set) = set.filter(|s| s.num_sequences() > 0 && n > 0) {
        let clip = set.bake(0, &set.default_pose_params());
        if clip.frames > 0 && clip.num_bones == n {
            let mut world: Vec<M34> = Vec::with_capacity(n);
            for (i, bone) in model.bones.iter().enumerate() {
                let p = [clip.pos[i * 3], clip.pos[i * 3 + 1], clip.pos[i * 3 + 2]];
                let q = [clip.quat[i * 4], clip.quat[i * 4 + 1], clip.quat[i * 4 + 2], clip.quat[i * 4 + 3]];
                let local = quat_pos(q, p);
                let w = if bone.parent >= 0 && (bone.parent as usize) < i { mul34(&world[bone.parent as usize], &local) } else { local };
                world.push(w);
            }
            let skin: Vec<M34> = model.bones.iter().zip(&world).map(|(b, w)| mul34(w, &b.pose_to_bone)).collect();
            for part in &mut model.body_parts {
                for sub in &mut part.models {
                    for mesh in &mut sub.meshes {
                        let verts = mesh.positions.len() / 3;
                        for v in 0..verts {
                            let mut m = [0.0f32; 12];
                            let mut total = 0.0;
                            for k in 0..4 {
                                let w = mesh.bone_weights.get(v * 4 + k).copied().unwrap_or(0.0);
                                let b = mesh.bone_indices.get(v * 4 + k).copied().unwrap_or(0) as usize;
                                if w <= 0.0 || b >= n {
                                    continue;
                                }
                                for (o, s) in m.iter_mut().zip(&skin[b]) {
                                    *o += s * w;
                                }
                                total += w;
                            }
                            if total <= 0.0 {
                                continue;
                            }
                            let p = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
                            let nn = [mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]];
                            for r in 0..3 {
                                mesh.positions[v * 3 + r] = (m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) / total;
                                mesh.normals[v * 3 + r] = (m[r * 4] * nn[0] + m[r * 4 + 1] * nn[1] + m[r * 4 + 2] * nn[2]) / total;
                            }
                            if let Some(t) = mesh.tangents.get(v * 4..v * 4 + 3).map(|t| [t[0], t[1], t[2]]) {
                                for r in 0..3 {
                                    mesh.tangents[v * 4 + r] = (m[r * 4] * t[0] + m[r * 4 + 1] * t[1] + m[r * 4 + 2] * t[2]) / total;
                                }
                            }
                            let l = (mesh.normals[v * 3].powi(2) + mesh.normals[v * 3 + 1].powi(2) + mesh.normals[v * 3 + 2].powi(2)).sqrt();
                            if l > 1e-8 {
                                for r in 0..3 {
                                    mesh.normals[v * 3 + r] /= l;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(crate::payload::encode(&model))
}

/// The sounds of a map, as the game plays them around the listener: its `ambient_generic`s (where each is, the waves it plays, its
/// radius, volume and pitch, whether it is heard everywhere, loops, starts silent) and its soundscapes (`env_soundscape`: where each zone
/// is, its radius, the soundscape it plays; and each soundscape played, flattened: its looping waves and its random ones, with their
/// volumes, pitches and times). Positions in the map's units.
pub fn map_sounds(state: &AppState, name: &str) -> Result<Value, String> {
    use source_formats::kv::{self, Node};
    let vpk = state.vpk()?;
    vpk.mount_map(name).map_err(|e| e.to_string())?;
    let bytes = map_bytes(&vpk, name)?;
    let ents = source_formats::bsp::entities(&bytes).map_err(|e| e.to_string())?;
    let voice = state.voice().ok();
    // a wave, or a sound script's waves (and its volume / pitch when it gives them)
    let waves_of = |message: &str| -> Vec<String> {
        let m = message.trim();
        if m.to_ascii_lowercase().ends_with(".wav") || m.to_ascii_lowercase().ends_with(".mp3") {
            return vec![source_formats::soundscript::clean_wave(m)];
        }
        voice.as_ref().and_then(|v| v.sound(m)).map(|e| e.waves.clone()).unwrap_or_default()
    };
    let num = |e: &std::collections::HashMap<String, String>, k: &str, d: f32| e.get(k).and_then(|v| v.trim().parse::<f32>().ok()).unwrap_or(d);
    let origin = |e: &std::collections::HashMap<String, String>| -> [f32; 3] {
        let v: Vec<f32> = e.get("origin").map(|o| o.split_whitespace().filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
        if v.len() >= 3 { [v[0], v[1], v[2]] } else { [0.0; 3] }
    };
    let mut ambients = Vec::new();
    let mut zones = Vec::new();
    for e in &ents {
        match e.get("classname").map(|s| s.as_str()) {
            Some("ambient_generic") => {
                let Some(message) = e.get("message") else { continue };
                let waves = waves_of(message);
                if waves.is_empty() {
                    continue;
                }
                let flags = num(e, "spawnflags", 0.0) as i32;
                ambients.push(json!({
                    "origin": origin(e), "waves": waves, "radius": num(e, "radius", 1250.0), "volume": (num(e, "health", 10.0) / 10.0).clamp(0.0, 1.0),
                    "pitch": num(e, "pitch", 100.0) / 100.0, "everywhere": flags & 1 != 0, "silent": flags & 16 != 0, "looped": flags & 32 == 0,
                }));
            }
            Some("env_soundscape" | "env_soundscape_triggerable" | "env_soundscape_proxy") => {
                let Some(scape) = e.get("soundscape").or_else(|| e.get("mainsoundscapename")) else { continue };
                if e.get("startdisabled").is_some_and(|d| d.trim() == "1") {
                    continue;
                }
                zones.push(json!({ "origin": origin(e), "radius": num(e, "radius", -1.0), "soundscape": scape.to_ascii_lowercase() }));
            }
            _ => {}
        }
    }
    // the soundscapes: the manifest's files, then the map's own (scripts/soundscapes_<map>.txt, in the game or packed in the map)
    let mut defs: std::collections::HashMap<String, Vec<Node>> = std::collections::HashMap::new();
    let mut files: Vec<String> = Vec::new();
    if let Ok(manifest) = vpk.read("scripts/soundscapes_manifest.txt") {
        if let Ok(nodes) = kv::parse(&String::from_utf8_lossy(&manifest)) {
            files.extend(nodes.first().and_then(Node::block).unwrap_or(&[]).iter().filter_map(|n| n.as_str()).map(|p| p.replace('\\', "/").to_ascii_lowercase()));
        }
    }
    files.push(format!("scripts/soundscapes_{}.txt", name.rsplit('/').next().unwrap_or(name).to_ascii_lowercase()));
    for file in files {
        let Ok(b) = vpk.read(&file) else { continue };
        let Ok(nodes) = kv::parse(&String::from_utf8_lossy(&b)) else { continue };
        for n in nodes {
            if let Some(body) = n.block() {
                defs.insert(n.key.to_ascii_lowercase(), body.to_vec());
            }
        }
    }
    let range = |s: Option<&str>, d: [f32; 2]| -> [f32; 2] {
        let Some(s) = s else { return d };
        let v: Vec<f32> = s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
        match v.len() {
            0 => d,
            1 => [v[0], v[0]],
            _ => [v[0], v[1]],
        }
    };
    // a soundscape, flattened: its looping and random sounds (a played soundscape's, at its volume, as well)
    fn flatten(
        name: &str, scale: f32, depth: u32, defs: &std::collections::HashMap<String, Vec<Node>>, waves_of: &dyn Fn(&str) -> Vec<String>,
        range: &dyn Fn(Option<&str>, [f32; 2]) -> [f32; 2], looping: &mut Vec<Value>, random: &mut Vec<Value>,
    ) {
        let Some(body) = defs.get(&name.to_ascii_lowercase()) else { return };
        if depth > 4 {
            return;
        }
        let get = |b: &[Node], k: &str| kv::find(b, k).and_then(|n| n.as_str()).map(|s| s.to_string());
        for n in body {
            let Some(b) = n.block() else { continue };
            let volume = range(get(b, "volume").as_deref(), [1.0, 1.0]).map(|v| v * scale);
            let pitch = range(get(b, "pitch").as_deref(), [100.0, 100.0]).map(|p| p / 100.0);
            match n.key.to_ascii_lowercase().as_str() {
                "playlooping" => {
                    let waves: Vec<String> = get(b, "wave").map(|w| waves_of(&w)).or_else(|| get(b, "soundname").map(|w| waves_of(&w))).unwrap_or_default();
                    if let Some(wave) = waves.first() {
                        looping.push(json!({ "wave": wave, "volume": volume[0], "pitch": pitch[0] }));
                    }
                }
                "playrandom" => {
                    let mut waves = Vec::new();
                    if let Some(r) = kv::find(b, "rndwave").and_then(Node::block) {
                        for w in r.iter().filter_map(|w| w.as_str()) {
                            waves.extend(waves_of(w));
                        }
                    }
                    if let Some(w) = get(b, "wave") {
                        waves.extend(waves_of(&w));
                    }
                    if !waves.is_empty() {
                        random.push(json!({ "waves": waves, "time": range(get(b, "time").as_deref(), [10.0, 20.0]), "volume": volume, "pitch": pitch }));
                    }
                }
                "playsoundscape" => {
                    if let Some(inner) = get(b, "name") {
                        flatten(&inner, volume[0], depth + 1, defs, waves_of, range, looping, random);
                    }
                }
                _ => {}
            }
        }
    }
    let mut soundscapes = serde_json::Map::new();
    for z in &zones {
        let name = z["soundscape"].as_str().unwrap_or_default().to_string();
        if soundscapes.contains_key(&name) {
            continue;
        }
        let (mut looping, mut random) = (Vec::new(), Vec::new());
        flatten(&name, 1.0, 0, &defs, &waves_of, &range, &mut looping, &mut random);
        soundscapes.insert(name, json!({ "looping": looping, "random": random }));
    }
    Ok(json!({ "ambients": ambients, "zones": zones, "soundscapes": soundscapes }))
}
