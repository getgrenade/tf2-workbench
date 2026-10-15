//! Resolves a material (VMT) to the data a renderer needs: the flattened
//! parameters plus the decoded textures its shading uses.

use std::collections::HashMap;

use crate::{
    binary::{fail, ParseError, Result},
    vmt::{self, Proxy},
    vtf,
    vpk::VpkSet,
};

/// Texture slots a material can fill. Each is `(slot name, VMT parameters that may name it)`.
const SLOTS: [(&str, &[&str]); 11] = [
    ("base", &["$basetexture", "$iris", "$diffuse", "$texture1"]),
    ("bump", &["$bumpmap", "$normalmap"]),
    ("warp", &["$lightwarptexture"]),
    ("phongwarp", &["$phongwarptexture"]),
    ("exponent", &["$phongexponenttexture"]),
    ("cornea", &["$corneatexture"]),
    ("ao", &["$ambientocclTexture"]),
    ("envmask", &["$envmapmask"]),
    ("illum", &["$selfillummask"]),
    // the detail layer of a material (a screen's noise: blend modes 0, 1 and 8 are drawn)
    ("detail", &["$detail"]),
    // UnlitTwoTexture multiplies its second texture into the first
    ("tex2", &["$texture2"]),
];

/// Most frames kept of an animated base texture.
const MAX_ANIMATION_FRAMES: usize = 64;

/// hlmv binds this texture as the local cubemap, so it is what `$envmap env_cubemap` reflects there.
const HLMV_CUBEMAP: &str = "hlmv/cubemap";
/// The default cubemap is HDR and large; reflections are blurry, so a 256 pixel face is plenty.
const DEFAULT_CUBEMAP_FACE: u32 = 256;

#[derive(Debug, Clone)]
pub struct Material {
    pub path: String,
    pub shader: String,
    /// Flattened VMT parameters (lowercased keys).
    pub params: HashMap<String, String>,
    /// Material proxies in file order (evaluated by the renderer).
    pub proxies: Vec<Proxy>,
    /// Decoded textures by slot (`base`, `bump`, `warp`, `phongwarp`, `exponent`). Slots whose
    /// texture is missing or undecodable are listed in `errors` instead.
    pub textures: Vec<(String, vtf::Image)>,
    pub errors: Vec<String>,
}

impl Material {
    pub fn param(&self, key: &str) -> Option<&str> {
        self.params.get(key).map(String::as_str)
    }

    pub fn flag(&self, key: &str) -> bool {
        self.param(key).is_some_and(|v| v.trim().parse::<f32>().map_or(false, |n| n != 0.0))
    }
}

fn vtf_path(name: &str) -> String {
    let mut p = name.replace('\\', "/").to_ascii_lowercase();
    if let Some(s) = p.strip_suffix(".vtf") {
        p = s.to_string();
    }
    format!("materials/{}.vtf", p.trim_start_matches('/'))
}

fn load_texture(vpk: &VpkSet, name: &str) -> Result<vtf::Image> {
    let path = vtf_path(name);
    if !vpk.contains(&path) {
        return fail(format!("texture not found: {path}"));
    }
    let bytes = vpk.read(&path).map_err(|e| ParseError(e.to_string()))?;
    vtf::decode(&bytes, 0).map_err(|e| ParseError(format!("{path}: {e}")))
}

/// A cubemap texture of the game as a material of its own, so that it travels like any other: `materials/__cubemap__/<name>.vmt` (no such file
/// exists) holds the six faces of `materials/<name>.vtf` as `env0`..`env5`. The viewer asks for one to light the scene with it.
pub const CUBEMAP_PREFIX: &str = "materials/__cubemap__/";
/// The size of the faces of those (reflections are blurry, so this is plenty).
const CUBEMAP_FACE: u32 = 512;

fn cubemap_material(vpk: &VpkSet, vmt_path: &str) -> Result<Material> {
    let name = vmt_path[CUBEMAP_PREFIX.len()..].trim_end_matches(".vmt");
    let faces = load_cubemap(vpk, name, CUBEMAP_FACE)?;
    let textures = faces.into_iter().enumerate().map(|(i, img)| (format!("env{i}"), img)).collect();
    Ok(Material { path: vmt_path.to_string(), shader: "cubemap".to_string(), params: HashMap::new(), proxies: Vec::new(), textures, errors: Vec::new() })
}

fn load_cubemap(vpk: &VpkSet, name: &str, max_face: u32) -> Result<Vec<vtf::Image>> {
    // the cubemap of a map (`maps/cp_badlands`) is kept in the program, not in the game
    if let Some(map) = name.strip_prefix("maps/") {
        let Some(bytes) = crate::map_cubemaps::get(map) else { return fail(format!("no cubemap of the map {map}")) };
        let info = vtf::info(bytes).map_err(|e| ParseError(format!("{name}: {e}")))?;
        let mut mip = 0;
        while (info.width >> mip) > max_face && mip + 1 < info.mip_count { mip += 1; }
        // a cubemap that is black all through (a map saved before its cubemaps were built) lights nothing: it is refused
        let faces = vtf::decode_faces(bytes, mip).map_err(|e| ParseError(format!("{name}: {e}")))?;
        if faces.iter().all(|f| f.rgba.chunks_exact(4).all(|p| p[0] | p[1] | p[2] == 0)) { return fail(format!("the cubemap of {map} is empty")); }
        return Ok(faces);
    }
    let mut path = vtf_path(name);
    // some cubemaps exist only in their HDR form (the goggles of Pyroland)
    if !vpk.contains(&path) && vpk.contains(&path.replace(".vtf", ".hdr.vtf")) {
        path = path.replace(".vtf", ".hdr.vtf");
    }
    if !vpk.contains(&path) {
        return fail(format!("cubemap not found: {path}"));
    }
    let bytes = vpk.read(&path).map_err(|e| ParseError(e.to_string()))?;
    // Smallest mip whose faces still fit within `max_face`.
    let info = vtf::info(&bytes).map_err(|e| ParseError(format!("{path}: {e}")))?;
    let mut mip = 0;
    while (info.width >> mip) > max_face && mip + 1 < info.mip_count {
        mip += 1;
    }
    vtf::decode_faces(&bytes, mip).map_err(|e| ParseError(format!("{path}: {e}")))
}

/// Every frame of an animated texture (the fire layer of a burning player is 121 frames of 64x64), as the width, the height and the frame
/// count (u32 little endian each) followed by the RGBA8 pixels of each frame. Loaded on demand rather than with every material that names it.
pub fn texture_frames(vpk: &VpkSet, name: &str, max_frames: usize) -> Result<Vec<u8>> {
    let path = vtf_path(name);
    let bytes = vpk.read(&path).map_err(|e| ParseError(format!("{path}: {e}")))?;
    let frames = vtf::decode_frames(&bytes, 0, max_frames.min(MAX_ANIMATION_FRAMES * 2)).map_err(|e| ParseError(format!("{path}: {e}")))?;
    let first = frames.first().ok_or_else(|| ParseError(format!("{path}: no frames")))?;
    let mut out = Vec::with_capacity(12 + frames.len() * first.rgba.len());
    for v in [first.width, first.height, frames.len() as u32] { out.extend_from_slice(&v.to_le_bytes()); }
    for frame in &frames { out.extend_from_slice(&frame.rgba); }
    Ok(out)
}

/// Loads `materials/.../x.vmt` and decodes the textures its shading uses.
pub fn load(vpk: &VpkSet, vmt_path: &str) -> Result<Material> {
    if vmt_path.starts_with(CUBEMAP_PREFIX) {
        return cubemap_material(vpk, vmt_path);
    }
    let vmt = vmt::load(vpk, vmt_path)?;
    let mut textures = Vec::new();
    let mut errors = Vec::new();
    for (slot, keys) in SLOTS {
        let Some(name) = keys.iter().find_map(|k| vmt.get(k)) else { continue };
        // only the detail layers that change the base colour are read (the burn's fire layer has its own frames)
        if slot == "detail" && !matches!(vmt.get("$detailblendmode").and_then(|v| v.trim().parse::<i32>().ok()).unwrap_or(0), 0 | 1 | 8) { continue; }
        match load_texture(vpk, name) {
            Ok(img) => textures.push((slot.to_string(), img)),
            Err(e) => errors.push(format!("{slot}: {e}")),
        }
    }
    // `AnimatedTexture` on $basetexture (the Festive lights blink this way): keep every frame as slot `base_f<N>`
    // (frame 0 stays `base`), up to a limit; the renderer picks the frame from the clock.
    if vmt.proxies.iter().any(|p| p.name == "animatedtexture" && p.params.get("animatedtexturevar").is_some_and(|v| v.eq_ignore_ascii_case("$basetexture"))) {
        if let Some(name) = vmt.base_texture() {
            let path = vtf_path(name);
            if let Ok(bytes) = vpk.read(&path) {
                if let Ok(frames) = vtf::decode_frames(&bytes, 0, MAX_ANIMATION_FRAMES) {
                    textures.extend(frames.into_iter().enumerate().skip(1).map(|(i, img)| (format!("base_f{i}"), img)));
                }
            }
        }
    }
    // The same for `AnimatedTexture` on $bumpmap (the Ubercharge material shimmers by cycling the frames of a water normal map): `bump_f<N>`.
    if vmt.proxies.iter().any(|p| p.name == "animatedtexture" && p.params.get("animatedtexturevar").is_some_and(|v| v.eq_ignore_ascii_case("$bumpmap"))) {
        if let Some(name) = vmt.get("$bumpmap") {
            if let Ok(bytes) = vpk.read(&vtf_path(name)) {
                if let Ok(frames) = vtf::decode_frames(&bytes, 0, MAX_ANIMATION_FRAMES) {
                    textures.extend(frames.into_iter().enumerate().skip(1).map(|(i, img)| (format!("bump_f{i}"), img)));
                }
            }
        }
    }
    // Environment cubemap: stored as six faces `env0`..`env5`. `env_cubemap` means "nearest map cubemap",
    // which the engine resolves per level; there is no level here, so it is hlmv's own local cubemap.
    if let Some(name) = vmt.get("$envmap") {
        let (name, max_face) = if name.eq_ignore_ascii_case("env_cubemap") { (HLMV_CUBEMAP, DEFAULT_CUBEMAP_FACE) } else { (name, u32::MAX) };
        match load_cubemap(vpk, name, max_face) {
            Ok(faces) => textures.extend(faces.into_iter().enumerate().map(|(i, img)| (format!("env{i}"), img))),
            Err(e) => errors.push(format!("envmap: {e}")),
        }
    }
    Ok(Material { path: vmt_path.to_string(), shader: vmt.shader, params: vmt.params, proxies: vmt.proxies, textures, errors })
}
