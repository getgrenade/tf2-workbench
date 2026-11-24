//! Maps for the scene: the list of the game's maps, a map's geometry, lightmap and props as one binary payload, and its materials.

use crate::state::AppState;
use serde_json::json;

/// The maps in the game's `maps` folder (names without `.bsp`), sorted.
pub fn list_maps(state: &AppState) -> Result<Vec<String>, String> {
    let vpk = state.vpk()?;
    let Some(root) = vpk.game_root() else { return Ok(Vec::new()) };
    let mut out: Vec<String> = std::fs::read_dir(root.join("maps"))
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.strip_suffix(".bsp").filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).map(str::to_ascii_lowercase)
        })
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
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
    let root = vpk.game_root().ok_or("no game folder")?;
    let bytes = std::fs::read(root.join("maps").join(format!("{name}.bsp"))).map_err(|e| e.to_string())?;
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
            let index = blob.len();
            for i in &m.indices {
                blob.extend_from_slice(&i.to_le_bytes());
            }
            json!({ "material": m.material, "vertexCount": m.positions.len() / 3, "indexCount": m.indices.len(), "pos": pos, "normal": normal, "uv": uv, "lightmap": lightmap, "blend": blend, "index": index })
        })
        .collect();
    let lightmap = blob.len();
    blob.extend_from_slice(&map.lightmap);
    let props: Vec<_> = map.props.iter().map(|p| json!({ "model": p.model, "origin": p.origin, "angles": p.angles, "skin": p.skin, "scale": p.scale })).collect();
    let spawns: Vec<_> = map.spawns.iter().map(|s| json!({ "origin": s.origin, "yaw": s.yaw, "team": s.team })).collect();
    let header = serde_json::to_vec(&json!({
        "name": name,
        "meshes": meshes,
        "props": props,
        "spawns": spawns,
        "lightmap": { "width": map.lightmap_width, "height": map.lightmap_height, "offset": lightmap, "range": source_formats::bsp::LIGHTMAP_RANGE },
        "sky": map.sky,
        "bounds": map.bounds,
    }))
    .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(8 + header.len() + blob.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    while out.len() % 4 != 0 {
        out.push(0);
    }
    out.extend_from_slice(&blob);
    Ok(out)
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
    let header = serde_json::to_vec(&json!({ "shader": m.shader, "params": m.params, "textures": textures })).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(8 + header.len() + blob.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    while out.len() % 4 != 0 {
        out.push(0);
    }
    out.extend_from_slice(&blob);
    Ok(out)
}
