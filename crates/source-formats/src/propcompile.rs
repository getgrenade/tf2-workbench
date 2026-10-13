//! Builds a prop (a model for a map: a crate, a barrel, a lamp) into loose files in a folder the artist names, laid out as the game reads them
//! (`models/<folder>/<name>.mdl` and the rest, `materials/models/<folder>/...`) and a small file (`<name>.prop.txt`) that opens it again in the compiler. Like the
//! cosmetic compiler it runs the game's own studiomdl, and converts the textures natively. There is no archive and no schema: the folder is
//! what goes into `tf/custom/<something>/` (or beside a map).

use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use crate::{
    itemcompile::{crlf, plain_absolute, quoted_path, run_studiomdl, LodSpec},
    tga,
    vpk::VpkSet,
    vtf_write::{self, Compression, Kind, Source},
};

/// The surface properties a prop may name (the ones the game's props use most; any name of surfaceproperties.txt is valid in the QC).
pub const SURFACE_PROPS: &[&str] = &[
    "default", "wood", "wood_crate", "wood_box", "wood_furniture", "wood_plank", "metal", "metal_box", "metal_barrel", "metalpanel", "solidmetal",
    "metalgrate", "plastic", "plastic_barrel", "plastic_box", "glass", "gravel", "concrete", "brick", "tile", "cardboard", "paper", "rubber", "carpet",
    "dirt", "grass", "sand", "water", "flesh", "foliage", "ceiling_tile", "computer", "ice", "snow",
];

#[derive(Debug, Clone)]
pub struct PropMaterialSpec {
    /// The file name of the material (and the start of its textures' names): `crate_wood`.
    pub name: String,
    /// The text of the material file; it names its textures as `models/<folder>/<name>_color` and so on.
    pub vmt: String,
    pub color: Option<PathBuf>,
    pub normal: Option<PathBuf>,
    pub phongexponent: Option<PathBuf>,
    pub illum: Option<PathBuf>,
    /// How its textures are stored: DXT (small), or exact pixels (BGRA8888 / BGR888).
    pub compression: Compression,
}

#[derive(Debug, Clone)]
pub struct PropSpec {
    /// Lowercase letters, digits and underscores.
    pub name: String,
    /// Below `models/`: `props_custom`, `props_custom/crates`.
    pub folder: String,
    pub surfaceprop: String,
    /// Kilograms (for a prop that has collision).
    pub mass: f32,
    /// `$staticprop`: a prop that never moves is drawn faster and may be lit by the map's vertex lighting.
    pub static_prop: bool,
    /// The collision model (an .smd of convex pieces; its triangles must not use the same material as the model). None: no collision.
    pub collision: Option<String>,
    /// `$concave`: studiomdl splits the collision mesh into convex pieces itself.
    pub concave: bool,
    /// The model's levels of detail (one to three).
    pub lods: Vec<LodSpec>,
    pub materials: Vec<PropMaterialSpec>,
    /// The largest side a texture may have.
    pub max_texture: u32,
    /// More QC, appended as it is.
    pub qc_extra: String,
    /// The text of the file that lets the prop be opened again in the compiler (`<name>.prop.txt` beside the models folder); empty: none is written.
    pub session: String,
}

#[derive(Debug)]
pub struct PropBuilt {
    /// The folder the files were written to.
    pub folder: PathBuf,
    /// What was written, relative to it.
    pub files: Vec<String>,
    pub log: Vec<String>,
    pub millis: u128,
}

const NAME_OK: fn(&str) -> bool = |s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');

/// Why a spec cannot be built, or Ok.
pub fn validate(spec: &PropSpec) -> Result<(), String> {
    if !NAME_OK(&spec.name) { return Err(format!("\"{}\" is not a usable name (lowercase letters, digits and underscores)", spec.name)); }
    if spec.folder.is_empty() || spec.folder.split('/').any(|p| !NAME_OK(p)) { return Err(format!("\"{}\" is not a usable folder (lowercase names joined by /)", spec.folder)); }
    if spec.lods.is_empty() || spec.lods.len() > 3 { return Err("a prop needs one to three levels of detail".into()); }
    if spec.lods.iter().any(|l| l.dmx.is_none() && l.smd.trim().is_empty() || l.dmx.as_ref().is_some_and(|d| d.is_empty())) { return Err("a level of detail has no geometry".into()); }
    if spec.materials.is_empty() { return Err("the model has no material".into()); }
    for m in &spec.materials {
        if !NAME_OK(&m.name) { return Err(format!("the material name \"{}\" is not usable (lowercase letters, digits and underscores)", m.name)); }
        if m.vmt.trim().is_empty() { return Err(format!("material {} has no material file", m.name)); }
        if m.color.is_none() { return Err(format!("material {} has no colour texture", m.name)); }
    }
    if spec.surfaceprop.is_empty() || !spec.surfaceprop.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') { return Err("the surface property is missing or malformed".into()); }
    if spec.collision.as_ref().is_some_and(|c| c.trim().is_empty()) { return Err("the collision model is empty".into()); }
    if spec.collision.is_some() && !(0.1..=50000.0).contains(&spec.mass) { return Err("the mass must be between 0.1 and 50000 kg".into()); }
    if !spec.max_texture.is_power_of_two() || spec.max_texture > 4096 { return Err("the texture limit must be a power of two up to 4096".into()); }
    Ok(())
}

/// The QC of a prop.
pub fn qc(spec: &PropSpec) -> String {
    let file = |lod: usize| spec.lods[lod].file(&spec.name, lod);
    let mut text = format!("$modelname \"{}/{}.mdl\"\n$upaxis Y\n$surfaceprop \"{}\"\n", spec.folder, spec.name, spec.surfaceprop);
    if spec.static_prop { text.push_str("$staticprop\n"); }
    text.push_str(&format!("\n$body \"{}\" \"{}\"\n", spec.name, file(0)));
    text.push_str(&format!("$cdmaterials \"models\\{}\"\n", spec.folder.replace('/', "\\")));
    for lod in 1..spec.lods.len() {
        let distance = [11, 22][lod - 1];
        text.push_str(&format!("\n$lod {distance}\n{{\nreplacemodel \"{}\" \"{}\"\n}}\n", file(0), file(lod)));
    }
    text.push_str(&format!("\n$sequence \"idle\" \"{}\"\n", file(0)));
    if let Some(_) = &spec.collision {
        text.push_str(&format!("\n$collisionmodel \"{}_phys.smd\"\n{{\n\t$mass {:.3}\n\t$inertia 1.00\n\t$damping 0.00\n\t$rotdamping 0.00\n{}}}\n", spec.name, spec.mass, if spec.concave { "\t$concave\n" } else { "" }));
    }
    if !spec.qc_extra.trim().is_empty() { text.push_str(&format!("\n{}\n", spec.qc_extra.trim_end())); }
    text
}

/// Compiles the prop into `out_dir` (the files of an earlier build of the same name are replaced). `work_root` is where the compiler works.
pub fn build(vpk: &VpkSet, spec: &PropSpec, out_dir: &Path, work_root: &Path) -> Result<PropBuilt, String> {
    let started = Instant::now();
    validate(spec)?;
    let mut log = Vec::new();
    let tf = vpk.game_root().ok_or("TF2's game folder is unavailable")?;
    let exe = tf.parent().ok_or("Invalid TF2 folder")?.join("bin/studiomdl.exe");
    if !exe.is_file() { return Err("TF2's bin/studiomdl.exe is needed to compile the model".into()); }
    let models = format!("models/{}", spec.folder);
    let materials = format!("materials/models/{}", spec.folder);

    // --- the textures, converted on their own threads ------------------------------------------------------------------------
    struct Job { kind: Kind, suffix: &'static str, source: PathBuf, name: String, compression: Compression }
    let mut jobs = Vec::new();
    for m in &spec.materials {
        for (kind, suffix, path) in [(Kind::Color, "_color", &m.color), (Kind::Normal, "_normal", &m.normal), (Kind::PhongExponent, "_phongexponent", &m.phongexponent), (Kind::Illum, "_illum", &m.illum)] {
            if let Some(source) = path { jobs.push(Job { kind, suffix, source: source.clone(), name: m.name.clone(), compression: m.compression }); }
        }
    }
    struct Done { file: String, vtf: Vec<u8> }
    let limit = spec.max_texture;
    let results: Vec<Result<Done, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = jobs.iter().map(|job| scope.spawn(move || -> Result<Done, String> {
            let bytes = fs::read(&job.source).map_err(|e| format!("{}: {e}", job.source.display()))?;
            let image = tga::decode(&bytes).map_err(|e| format!("{}: {e}", job.source.display()))?;
            if image.width > limit || image.height > limit { return Err(format!("{} is {}x{}; the limit is {limit}x{limit}", job.source.display(), image.width, image.height)); }
            if !image.width.is_power_of_two() || !image.height.is_power_of_two() { return Err(format!("{} is {}x{}; both sides must be a power of two", job.source.display(), image.width, image.height)); }
            let vtf = vtf_write::encode_with(&Source { width: image.width as usize, height: image.height as usize, rgba: &image.rgba }, job.kind, image.uses_alpha, job.compression);
            Ok(Done { file: format!("{}{}.vtf", job.name, job.suffix), vtf })
        })).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("a texture thread failed".into()))).collect()
    });
    let mut done = Vec::new();
    for r in results { done.push(r?); }
    log.push(format!("{} texture{} converted in {} ms", done.len(), if done.len() == 1 { "" } else { "s" }, started.elapsed().as_millis()));

    // --- the model: the files and the QC in a private game folder, then studiomdl ------------------------------------------------
    let work = work_root.join(&spec.name);
    if work.exists() { fs::remove_dir_all(&work).map_err(|e| format!("Cannot clear {}: {e}", work.display()))?; }
    let content = work.join("content").join(&models);
    let game = work.join("game");
    fs::create_dir_all(&content).map_err(|e| e.to_string())?;
    fs::create_dir_all(game.join(&materials)).map_err(|e| e.to_string())?;
    fs::write(game.join("gameinfo.txt"), format!("\"GameInfo\" {{ \"game\" \"TF2 Workbench compiler\" \"FileSystem\" {{ \"SteamAppId\" \"440\" \"SearchPaths\" {{ \"Game\" \"|gameinfo_path|.\" \"Game\" {} }} }} }}", quoted_path(tf)?)).map_err(|e| e.to_string())?;
    for (i, lod) in spec.lods.iter().enumerate() { fs::write(content.join(lod.file(&spec.name, i)), lod.bytes()).map_err(|e| e.to_string())?; }
    if let Some(c) = &spec.collision { fs::write(content.join(format!("{}_phys.smd", spec.name)), crlf(c)).map_err(|e| e.to_string())?; }
    for m in &spec.materials { fs::write(game.join(&materials).join(format!("{}.vmt", m.name)), crlf(&m.vmt)).map_err(|e| e.to_string())?; }
    let qc_text = qc(spec);
    let qc_path = content.join(format!("{}.qc", spec.name));
    fs::write(&qc_path, crlf(&qc_text)).map_err(|e| e.to_string())?;
    run_studiomdl(&exe, &plain_absolute(&game)?, &plain_absolute(&qc_path)?, &mut log)?;
    let mut extensions = vec!["mdl", "dx80.vtx", "dx90.vtx", "sw.vtx", "vvd"];
    if spec.collision.is_some() { extensions.push("phy"); }
    let mut model_files: Vec<(String, Vec<u8>)> = Vec::new();
    for ext in extensions {
        let rel = format!("{models}/{}.{ext}", spec.name);
        model_files.push((rel.clone(), fs::read(game.join(&rel)).map_err(|_| format!("The compiler did not make {rel}"))?));
    }

    // --- the folder --------------------------------------------------------------------------------------------------------------------
    let mut files: Vec<(String, Vec<u8>)> = model_files;
    for m in &spec.materials { files.push((format!("{materials}/{}.vmt", m.name), crlf(&m.vmt))); }
    for d in done { files.push((format!("{materials}/{}", d.file), d.vtf)); }
    // no sources: what the game reads is all that is written (the compiler's own file says how to build it again)
    if !spec.session.trim().is_empty() { files.push((format!("{}.prop.txt", spec.name), crlf(&spec.session))); }
    let mut written = Vec::new();
    for (rel, bytes) in files {
        let target = out_dir.join(&rel);
        fs::create_dir_all(target.parent().unwrap()).map_err(|e| format!("{}: {e}", target.display()))?;
        fs::write(&target, bytes).map_err(|e| format!("{}: {e}", target.display()))?;
        written.push(rel);
    }
    let _ = fs::remove_dir_all(&work);
    Ok(PropBuilt { folder: out_dir.to_path_buf(), files: written, log, millis: started.elapsed().as_millis() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> PropSpec {
        PropSpec {
            name: "crate_a".into(), folder: "props_custom/crates".into(), surfaceprop: "wood_crate".into(), mass: 40.0, static_prop: false, collision: Some("version 1\n".into()), concave: false,
            lods: vec![LodSpec { source_path: "a.fbx".into(), smd: "version 1\n".into(), dmx: None, triangles: 12, vertices: 8 }, LodSpec { source_path: "b.fbx".into(), smd: "version 1\n".into(), dmx: None, triangles: 6, vertices: 8 }],
            materials: vec![PropMaterialSpec { name: "crate_a".into(), vmt: "\"VertexLitGeneric\"\n{\n}\n".into(), color: Some("c.tga".into()), normal: None, phongexponent: None, illum: None, compression: Compression::Dxt }],
            max_texture: 1024, qc_extra: String::new(), session: String::new(),
        }
    }

    #[test]
    fn the_qc_says_what_the_prop_is() {
        let text = qc(&spec());
        assert!(text.contains("$modelname \"props_custom/crates/crate_a.mdl\""), "{text}");
        assert!(text.contains("$surfaceprop \"wood_crate\"") && !text.contains("$staticprop"));
        assert!(text.contains("$body \"crate_a\" \"crate_a.smd\"") && text.contains("$cdmaterials \"models\\props_custom\\crates\""));
        assert!(text.contains("$lod 11") && text.contains("replacemodel \"crate_a.smd\" \"crate_a_lod1.smd\""));
        assert!(text.contains("$collisionmodel \"crate_a_phys.smd\"") && text.contains("$mass 40.000") && !text.contains("$concave"));
        let mut fixed = spec();
        fixed.static_prop = true; fixed.collision = None; fixed.concave = true;
        let text = qc(&fixed);
        assert!(text.contains("$staticprop") && !text.contains("$collisionmodel"));
    }

    #[test]
    fn bad_specs_are_refused() {
        assert!(validate(&spec()).is_ok());
        let mut s = spec(); s.name = "Crate".into(); assert!(validate(&s).is_err());
        let mut s = spec(); s.folder = "props/../x".into(); assert!(validate(&s).is_err());
        let mut s = spec(); s.lods.clear(); assert!(validate(&s).is_err());
        let mut s = spec(); s.materials[0].color = None; assert!(validate(&s).is_err());
        let mut s = spec(); s.mass = 0.0; assert!(validate(&s).is_err());
        let mut s = spec(); s.max_texture = 1000; assert!(validate(&s).is_err());
    }
}
