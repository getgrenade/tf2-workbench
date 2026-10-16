//! Builds a cosmetic into the archive the game's item importer writes (item_import.cpp CTFFileImportDialog::Build -> CAssetTF::Compile):
//! a `.zip` with `manifest.txt`, a `game\` folder that mirrors the game's own layout (the compiled model, the materials, the backpack icon)
//! and a `content\` folder with the sources. The compiled model comes from the game's own studiomdl; the textures are converted natively
//! (`vtf_write`), which is the part of the importer that takes the time (it starts vtex for every texture).

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use crate::{
    tga,
    vpk::VpkSet,
    vtf_write::{self, Compression, Kind, Source},
    zipw::ZipBuilder,
};

/// One level of detail: the model as a Studiomdl Data text, and what the manifest records of the file it came from.
#[derive(Debug, Clone)]
pub struct LodSpec {
    /// The artist's file (recorded in the manifest).
    pub source_path: String,
    pub smd: String,
    /// The model as a binary Datamodel file instead, for a model that has flexes (shape keys): the game's compiler reads those from a .dmx only.
    pub dmx: Option<Vec<u8>>,
    pub triangles: u32,
    pub vertices: u32,
}

impl LodSpec {
    /// The name of the file of the LOD in the item's content folder.
    pub(crate) fn file(&self, model: &str, lod: usize) -> String {
        let ext = if self.dmx.is_some() { "dmx" } else { "smd" };
        if lod == 0 { format!("{model}.{ext}") } else { format!("{model}_lod{lod}.{ext}") }
    }
    /// What is written to that file (the text of an .smd gets the line ends of Windows).
    pub(crate) fn bytes(&self) -> Vec<u8> { match &self.dmx { Some(d) => d.clone(), None => crlf(&self.smd) } }
}

/// The models of one class: `scout`, `sniper`, `soldier`, `demo`, `medic`, `heavy`, `pyro`, `spy` or `engineer`, and its LODs.
#[derive(Debug, Clone)]
pub struct ClassSpec {
    pub folder: String,
    pub lods: Vec<LodSpec>,
    /** QC commands added at the end of the class's QC (the `$jigglebone` blocks of its bones). */
    pub qc_extra: String,
    /** The commands that go inside its `$lod` blocks, LOD 1 first (`bonetreecollapse "bip_head"`, `replacebone "a" "b"`, `nofacial`). */
    pub lod_commands: Vec<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct MaterialSpec {
    /// The name of the material in the artist's model (`ND_ID_MAT_TEAL`).
    pub source_name: String,
    /// The finished .vmt text.
    pub vmt: String,
    pub color: Option<PathBuf>,
    pub normal: Option<PathBuf>,
    pub phongexponent: Option<PathBuf>,
    pub illum: Option<PathBuf>,
    /// The material takes paint (the importer keeps this switch in its session as paintable<n>, which the text it saves has to say too).
    pub paintable: bool,
    /// The BLU skin of a team-coloured item: the material's own file and, when its diffuse texture is not the RED one, that texture.
    /// Normal, exponent and glow textures are shared by both skins (the importer's material editor has one of each).
    pub blue: Option<BlueSpec>,
}

#[derive(Debug, Clone)]
pub struct BlueSpec {
    /// The finished .vmt text of the BLU material.
    pub vmt: String,
    /// The BLU diffuse texture; none when BLU uses the RED one.
    pub color: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ItemSpec {
    /// The name of the item: a lowercase identifier.
    pub name: String,
    /// What players see (tf_english_name); may be empty.
    pub display_name: String,
    /// `hat` or `misc`.
    pub prefab: String,
    pub equip_region: String,
    pub bodygroups: Vec<String>,
    pub paintable: bool,
    /// The classes with a model of their own; more than one makes it an all-class item.
    pub classes: Vec<ClassSpec>,
    pub materials: Vec<MaterialSpec>,
    pub icon: PathBuf,
    /// How the model textures are stored (the importer always makes them DXT; the icon is DXT5 either way).
    pub compression: Compression,
}

#[derive(Debug)]
pub struct Built {
    pub zip: PathBuf,
    /// The importer's own session file next to the zip, which its "Load" button reads.
    pub session: PathBuf,
    pub log: Vec<String>,
    pub millis: u128,
}

const CLASSES: [&str; 9] = ["scout", "sniper", "soldier", "demo", "medic", "heavy", "pyro", "spy", "engineer"];
const BODYGROUPS: [&str; 10] = ["backpack", "dogtags", "grenades", "hands", "hat", "head", "headphones", "shoes", "shoes_socks", "bullets"];
/// itemtest_manifest.txt of the game: the directory of items and of their icons, and the distances of the LODs.
const ITEM_DIRECTORY: &str = "workshop/player/items";
const ICON_DIRECTORY: &str = "backpack/workshop/player/items";
const LOD_DISTANCES: [u32; 3] = [11, 22, 33];
/// `used_by_classes` names classes the way the item schema does.
fn usability(folder: &str) -> &str { if folder == "demo" { "demoman" } else { folder } }

impl ItemSpec {
    /// More than one class has a model (CTFFileImportDialog::IsMulticlass).
    pub fn multiclass(&self) -> bool { self.classes.len() > 1 }

    /// The item has a BLU skin of its own (skin_type 1 in the importer): a second material file per material, and a second skin family.
    pub fn team_colors(&self) -> bool { self.materials.iter().any(|m| m.blue.is_some()) }

    /// The class folder of the item's files: its class, or `all_class` (GetClassFolder).
    pub fn folder(&self) -> &str { if self.multiclass() { MULTICLASS_FOLDER } else { self.classes.first().map(|c| c.folder.as_str()).unwrap_or("") } }

    /// The name (without extension) of a class's model files: the item's, with the class after it for an all-class item.
    pub fn model_file(&self, class: &str) -> String { if self.multiclass() { format!("{}_{class}", self.name) } else { self.name.clone() } }
}

/// The folder of an item with models for several classes.
pub const MULTICLASS_FOLDER: &str = "all_class";

/// Why a spec cannot be built, or Ok.
pub fn validate(spec: &ItemSpec) -> Result<(), String> {
    let n = &spec.name;
    if n.is_empty() || !n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') { return Err(format!("\"{n}\" is not a usable item name (lowercase letters, digits and underscores)")); }
    if spec.classes.is_empty() { return Err("the item has no class with a model".into()); }
    for (i, c) in spec.classes.iter().enumerate() {
        if !CLASSES.contains(&c.folder.as_str()) { return Err(format!("unknown class {}", c.folder)); }
        if spec.classes[..i].iter().any(|o| o.folder == c.folder) { return Err(format!("class {} is given twice", c.folder)); }
        if c.lods.is_empty() || c.lods.len() > 3 { return Err(format!("{} needs one to three LODs", c.folder)); }
        if c.lods.iter().any(|l| l.dmx.is_none() && l.smd.trim().is_empty() || l.dmx.as_ref().is_some_and(|d| d.is_empty())) { return Err(format!("a LOD of {} has no geometry", c.folder)); }
        // AreClassesLODCountMatch
        if c.lods.len() != spec.classes[0].lods.len() { return Err("every class needs the same number of LODs".into()); }
    }
    if spec.prefab != "hat" && spec.prefab != "misc" { return Err(format!("unknown item type {}", spec.prefab)); }
    if spec.equip_region.is_empty() || !spec.equip_region.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') { return Err("the equip region is missing or malformed".into()); }
    if let Some(b) = spec.bodygroups.iter().find(|b| !BODYGROUPS.contains(&b.as_str())) { return Err(format!("unknown bodygroup {b}")); }
    if spec.materials.is_empty() || spec.materials.len() > 2 { return Err("an item has one or two materials".into()); }
    for (i, m) in spec.materials.iter().enumerate() {
        if m.color.is_none() { return Err(format!("material {} has no colour texture", i + 1)); }
        if m.vmt.trim().is_empty() { return Err(format!("material {} has no material file", i + 1)); }
        if spec.team_colors() {
            match &m.blue { None => return Err(format!("material {} has no BLU material (every material of a team-coloured item has one)", i + 1)), Some(b) if b.vmt.trim().is_empty() => return Err(format!("the BLU material {} has no material file", i + 1)), _ => {} }
        }
    }
    Ok(())
}

pub(crate) fn crlf(text: &str) -> Vec<u8> { text.replace("\r\n", "\n").replace('\n', "\r\n").into_bytes() }

/// Fills the game's QC template for the item the way the importer does (see itemtest_qc_template_*.txt).
fn fill_qc(template: &str, spec: &ItemSpec, class: &ClassSpec) -> String {
    let item_dir = format!("{ITEM_DIRECTORY}/{}/{}", spec.folder(), spec.name);
    let model = spec.model_file(&class.folder);
    let file = |lod: usize| class.lods.get(lod).map(|l| l.file(&model, lod)).unwrap_or_default();
    let mut text = template.replace("\r\n", "\n");
    text = text.replace("<ITEMTEST_REPLACE_MDLABSPATH>", &format!("{item_dir}/{model}.mdl"));
    text = text.replace("<ITEMTEST_REPLACE_LOD0>", &file(0));
    for lod in [1usize, 2] {
        let header = format!("<ITEMTEST_REPLACE_LOD{lod}_HEADER>");
        if lod < class.lods.len() {
            let lod_header = format!("$lod {}", LOD_DISTANCES[lod - 1]);
            text = text.replace(&header, &lod_header).replace(&format!("<ITEMTEST_REPLACE_LOD{lod}>"), &file(lod));
            // the class's bone commands for the LOD go at the end of its block
            if let Some(commands) = class.lod_commands.get(lod - 1).filter(|c| !c.is_empty()) {
                if let Some(start) = text.find(&lod_header) {
                    if let Some(end) = text[start..].find("
}") {
                        let lines: String = commands.iter().map(|c| format!("
{c}")).collect();
                        text.insert_str(start + end, &lines);
                    }
                }
            }
        } else if let Some(start) = text.find(&header) {
            // a LOD that is not there takes its whole block with it, leaving the blank line
            let end = text[start..].find("\n}").map(|e| start + e + 2).unwrap_or(text.len());
            text.replace_range(start..end, "");
        }
    }
    let materials_dir = format!("models\\{}", item_dir.replace('/', "\\"));
    let family = |team: u8| (0..spec.materials.len()).map(|i| format!("\"{}\"", material_file_team(&spec.name, i, team))).collect::<Vec<_>>().join(" ");
    // one family of skins for a single skin, two (RED, then BLU) for a team-coloured item
    let families = if spec.team_colors() { format!("    {{ {} }}\n    {{ {} }}", family(0), family(1)) } else { format!("    {{ {} }}", family(0)) };
    let skin = format!("$cdmaterials \"{materials_dir}\"\n$texturegroup skinfamilies\n{{\n{families}\n}}");
    text.replace("<ITEMTEST_REPLACE_SKIN_OPTIONALBLOCK>", &skin)
}

/// The game's QC template as the importer saves it in its session file: the markers stay, and the class's bone commands are inside its LOD blocks.
fn session_qc(template: &str, class: &ClassSpec) -> String {
    let mut text = template.replace("
", "
");
    for lod in [1usize, 2] {
        let Some(commands) = class.lod_commands.get(lod - 1).filter(|c| !c.is_empty()) else { continue };
        let header = format!("<ITEMTEST_REPLACE_LOD{lod}_HEADER>");
        if let Some(start) = text.find(&header) {
            if let Some(end) = text[start..].find("
}") {
                let lines: String = commands.iter().map(|c| format!("
{c}")).collect();
                text.insert_str(start + end, &lines);
            }
        }
    }
    // the commands the class's QC ends with (the `$jigglebone` blocks): opening the session brings them back
    if !class.qc_extra.trim().is_empty() { text = format!("{}

{}
", text.trim_end(), class.qc_extra.replace("
", "
").trim_end()); }
    text
}

/// The material file of the n-th material: the item's name, then `_1`, `_2`.
fn material_file(name: &str, index: usize) -> String { if index == 0 { name.to_string() } else { format!("{name}_{index}") } }

/// The material file of a skin (0 RED, 1 BLU): the BLU one has `_blue` after the material's name.
fn material_file_team(name: &str, index: usize, team: u8) -> String { format!("{}{}", material_file(name, index), if team == 1 { "_blue" } else { "" }) }

fn quote(s: &str) -> String { format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")) }

/// A little writer for the text the importer saves (KeyValues with two tabs between key and value, CRLF lines).
struct KvOut { out: String, depth: usize }
impl KvOut {
    fn new() -> Self { KvOut { out: String::new(), depth: 0 } }
    fn line(&mut self, text: &str) { self.out.push_str(&"\t".repeat(self.depth)); self.out.push_str(text); self.out.push_str("\r\n"); }
    fn open(&mut self, key: &str) { self.line(&quote(key)); self.line("{"); self.depth += 1; }
    fn close(&mut self) { self.depth -= 1; self.line("}"); }
    fn pair(&mut self, key: &str, value: &str) { self.line(&format!("{}\t\t{}", quote(key), quote(value))); }
}

fn win(path: &str) -> String { path.replace('/', "\\") }

struct Texture { kind: &'static str, /** 0 RED (or shared), 1 the BLU diffuse texture. */ team: u8, vtf_path: String, content_path: String, width: u32, height: u32, depth: u8, source: PathBuf }

/// The manifest.txt of the archive and the session text the importer's Load button reads: the same, except for where the files are.
fn session_text(spec: &ItemSpec, template: &str, textures: &[Vec<Texture>], icon_content: &str, zip_path: &Path, in_archive: bool, name_suffix: &str) -> String {
    let class = spec.folder();
    let item_dir = format!("{ITEM_DIRECTORY}/{class}/{}", spec.name);
    let mut kv = KvOut::new();
    kv.open(if in_archive { "asset" } else { "data" });
    kv.open("ImportSession");
    kv.pair("prefab", &spec.prefab);
    kv.pair("equip_region", &spec.equip_region);
    kv.pair("name", &spec.name);
    kv.pair("skin_type", if spec.team_colors() { "1" } else { "0" });
    // the bodygroups the item hides, then the icon and the switches of the importer's material editor (one for each of its two material slots)
    kv.open("bodygroup");
    for b in &spec.bodygroups { kv.pair(b, "1"); }
    kv.close();
    kv.pair("icon", &if in_archive { win(icon_content) } else { String::from(icon_content) });
    for i in 0..2 { kv.pair(&format!("paintable{i}"), if spec.materials.get(i).is_some_and(|m| m.paintable) { "1" } else { "0" }); }
    kv.open("Materials");
    for (i, m) in spec.materials.iter().enumerate() { kv.pair(&format!("Material{i}"), &m.source_name); }
    kv.open("Skins");
    // a skin: each material's material file and textures; the diffuse texture is the skin's own, the others are shared by both skins
    let skin = |kv: &mut KvOut, name: &str, team: u8| {
        kv.open(name);
        for (i, m) in spec.materials.iter().enumerate() {
            kv.open(&format!("Material{i}"));
            let vmt = if team == 1 { m.blue.as_ref().map(|b| b.vmt.as_str()).unwrap_or(&m.vmt) } else { &m.vmt };
            kv.pair("vmt", vmt.trim_end_matches(['\r', '\n']));
            let own = textures[i].iter().find(|t| t.kind == "base" && t.team == team).or_else(|| textures[i].iter().find(|t| t.kind == "base" && t.team == 0));
            for t in own.into_iter().chain(textures[i].iter().filter(|t| t.kind != "base" && t.team == 0)) {
                let file = if in_archive { win(&t.content_path) } else { t.source.to_string_lossy().into_owned() };
                kv.pair(&format!("{}_texture_file", t.kind), &file);
                kv.pair(&format!("{}_texture_width", t.kind), &t.width.to_string());
                kv.pair(&format!("{}_texture_height", t.kind), &t.height.to_string());
                kv.pair(&format!("{}_texture_channels", t.kind), &if t.depth == 24 { "3" } else { "4" }.to_string());
                kv.pair(&format!("{}_texture_alpha", t.kind), &if t.depth == 24 { "0" } else { "1" }.to_string());
            }
            kv.close();
        }
        for i in spec.materials.len()..2 { kv.open(&format!("Material{i}")); kv.close(); }
        kv.close();
    };
    skin(&mut kv, "Red", 0);
    if spec.team_colors() { skin(&mut kv, "blue", 1); } else { kv.open("blue"); kv.close(); }
    kv.close(); // Skins
    kv.close(); // Materials
    kv.open("classes");
    // every class has its block, in the importer's order; the ones the item has no model for are empty
    let order = ["scout", "sniper", "soldier", "demo", "medic", "heavy", "pyro", "spy", "engineer"];
    let mut shown: Vec<(String, Option<&ClassSpec>)> = order.iter().map(|f| (f.to_string(), spec.classes.iter().find(|c| c.folder == *f))).collect();
    for c in &spec.classes { if !order.contains(&c.folder.as_str()) { shown.push((c.folder.clone(), Some(c))); } }
    for (folder, class_spec) in shown {
        let Some(c) = class_spec else { kv.open(&folder); kv.close(); continue };
        kv.open(&c.folder);
        // the class's QC as the importer keeps it in its session: the game's template with the markers still in it, and the bone commands of the LODs
        kv.pair("QC", &session_qc(template, c));
        let model = spec.model_file(&c.folder);
        for (i, lod) in c.lods.iter().enumerate() {
            kv.open(&format!("LOD{i}"));
            let file = lod.file(&model, i);
            kv.pair("file", &if in_archive { win(&format!("content/models/{item_dir}/{file}")) } else { lod.source_path.clone() });
            kv.pair("polyCount", &lod.triangles.to_string());
            kv.pair("triangleCount", &lod.triangles.to_string());
            kv.pair("vertexCount", &lod.vertices.to_string());
            kv.pair("materialCount", &spec.materials.len().to_string());
            kv.close();
        }
        kv.close();
    }
    kv.close();
    kv.pair("loopable", "-1.000000");
    kv.pair("output", &zip_path.to_string_lossy().to_ascii_lowercase());
    kv.open("ItemSchema");
    kv.pair("import_name", &spec.name);
    if !spec.display_name.is_empty() { kv.pair("name", &spec.display_name); }
    kv.pair("prefab", &format!("no_craft {}", spec.prefab));
    kv.pair("item_name", &format!("#TF_{}{name_suffix}", spec.name));
    kv.pair("item_description", &format!("#TF_{}{name_suffix}_Desc", spec.name));
    kv.pair("equip_region", &spec.equip_region);
    if spec.display_name.to_ascii_lowercase().starts_with("the ") { kv.pair("propername", "1"); }
    if !spec.bodygroups.is_empty() {
        kv.open("visuals");
        kv.open("player_bodygroups");
        for b in &spec.bodygroups { kv.pair(b, "1"); }
        kv.close();
        kv.close();
    }
    kv.pair("image_inventory", &format!("{ICON_DIRECTORY}/{class}/{0}/{0}", spec.name));
    kv.open("capabilities");
    kv.pair("can_craft_count", "1");
    if spec.paintable { kv.pair("paintable", "1"); }
    kv.close();
    if spec.multiclass() {
        kv.open("model_player_per_class");
        for c in &spec.classes { kv.pair(usability(&c.folder), &format!("models/{item_dir}/{}.mdl", spec.model_file(&c.folder))); }
        kv.close();
    } else {
        kv.pair("model_player", &format!("models/{item_dir}/{}.mdl", spec.name));
    }
    kv.open("used_by_classes");
    for c in &spec.classes { kv.pair(usability(&c.folder), "1"); }
    kv.close();
    kv.close(); // ItemSchema
    kv.close(); // ImportSession
    if in_archive {
        kv.pair("name", &spec.name);
        kv.pair("class", class);
        kv.pair("steamid", "0x00000000");
        let mut n = 0;
        for c in &spec.classes {
            let model = spec.model_file(&c.folder);
            for (i, lod) in c.lods.iter().enumerate() {
                kv.open(&format!("LOD{n}"));
                n += 1;
                kv.pair("filename", &lod.source_path);
                let file = if i == 0 { format!("{model}.dmx") } else { format!("{model}_lod{i}.dmx") };
                kv.pair("out_filename", &win(&format!("models/{item_dir}/{file}")));
                kv.pair("polyCount", &lod.triangles.to_string());
                kv.pair("vertexCount", &lod.vertices.to_string());
                kv.close();
            }
        }
        for (i, m) in spec.materials.iter().enumerate() {
            kv.open(&format!("VMT{i}"));
            kv.pair("materialId", &m.source_name);
            kv.pair("materialType", "primary");
            kv.pair("duplicate", "0");
            kv.pair("target_width", "0");
            kv.pair("target_height", "0");
            kv.open("color");
            kv.pair("alphaType", "NoColorAlpha");
            kv.close();
            kv.close();
        }
    }
    kv.close();
    kv.out
}

/// Runs the game's studiomdl on a QC, with its output going into a private game folder instead of the install.
pub(crate) fn run_studiomdl(exe: &Path, game: &Path, qc: &Path, log: &mut Vec<String>) -> Result<(), String> {
    let log_path = qc.with_extension("log");
    let file = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.current_dir(exe.parent().unwrap()).arg("-nop4").arg("-game").arg(game).arg(qc)
        .stdout(Stdio::from(file.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(file));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Cannot start TF2's studiomdl: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let text = fs::read_to_string(&log_path).unwrap_or_default();
            if status.success() {
                log.push(format!("studiomdl finished in {} ms", start.elapsed().as_millis()));
                // the warnings worth showing
                for line in text.lines().filter(|l| l.to_ascii_lowercase().contains("warning")).take(8) { log.push(line.trim().to_string()); }
                return Ok(());
            }
            let tail: String = text.chars().rev().take(2500).collect::<String>().chars().rev().collect();
            return Err(format!("The model did not compile:\n{tail}"));
        }
        if start.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The model compiler took too long and was stopped".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// The absolute form of a path that exists, without the verbatim prefix Windows adds (Source's tools do not understand it).
pub(crate) fn plain_absolute(p: &Path) -> Result<PathBuf, String> {
    let full = fs::canonicalize(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let text = full.to_string_lossy();
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()))
}

pub(crate) fn quoted_path(p: &Path) -> Result<String, String> {
    let s = p.to_string_lossy().replace('\\', "/");
    if s.contains(['"', '\n', '\r']) { return Err("A folder name has a character the compiler cannot take".into()); }
    Ok(format!("\"{s}\""))
}

/// Builds the item. `work_root` holds the scratch folder of the build (the private game folder studiomdl writes into). An archive
/// and session file of the same name are replaced.
pub fn build(vpk: &VpkSet, spec: &ItemSpec, out_dir: &Path, work_root: &Path) -> Result<Built, String> {
    let started = Instant::now();
    validate(spec)?;
    let mut log = Vec::new();
    let tf = vpk.game_root().ok_or("TF2's game folder is unavailable")?;
    let exe = tf.parent().ok_or("Invalid TF2 folder")?.join("bin/studiomdl.exe");
    if !exe.is_file() { return Err("TF2's bin/studiomdl.exe is needed to compile the model".into()); }
    let class = spec.folder();
    let item_dir = format!("{ITEM_DIRECTORY}/{class}/{}", spec.name);
    let icon_dir = format!("{ICON_DIRECTORY}/{class}/{}", spec.name);

    // --- the textures: decoded, checked, converted on their own threads ----------------------------------------------------
    struct Job { index: usize, team: u8, kind: &'static str, file_kind: Kind, source: PathBuf, vtf_path: String, content_path: String }
    let mut jobs = Vec::new();
    for (i, m) in spec.materials.iter().enumerate() {
        let base = material_file(&spec.name, i);
        for (kind, file_kind, path) in [("base", Kind::Color, &m.color), ("normal", Kind::Normal, &m.normal), ("phongexponent", Kind::PhongExponent, &m.phongexponent), ("selfillum", Kind::Illum, &m.illum)] {
            let Some(source) = path else { continue };
            let suffix = match kind { "base" => "_color", "normal" => "_normal", "phongexponent" => "_phongexponent", _ => "_illum" };
            jobs.push(Job { index: i, team: 0, kind, file_kind, source: source.clone(),
                vtf_path: format!("game/materials/models/{item_dir}/{base}{suffix}.vtf"),
                content_path: format!("content/materialsrc/models/{item_dir}/{base}{suffix}.tga") });
        }
    }
    // the BLU diffuse texture of a team-coloured material, when it is not the RED one
    for (i, m) in spec.materials.iter().enumerate() {
        if let Some(source) = m.blue.as_ref().and_then(|b| b.color.as_ref()) {
            let base = material_file(&spec.name, i);
            jobs.push(Job { index: i, team: 1, kind: "base", file_kind: Kind::Color, source: source.clone(),
                vtf_path: format!("game/materials/models/{item_dir}/{base}_blue_color.vtf"),
                content_path: format!("content/materialsrc/models/{item_dir}/{base}_blue_color.tga") });
        }
    }
    struct Done { index: usize, texture: Texture, vtf: Vec<u8>, source_bytes: Vec<u8> }
    let compression = spec.compression;
    let results: Vec<Result<Done, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = jobs.iter().map(|job| scope.spawn(move || -> Result<Done, String> {
            let bytes = fs::read(&job.source).map_err(|e| format!("{}: {e}", job.source.display()))?;
            let image = tga::decode(&bytes).map_err(|e| format!("{}: {e}", job.source.display()))?;
            let limit = match job.file_kind { Kind::Color | Kind::Normal => 512, _ => 256 };
            if image.width > limit || image.height > limit { return Err(format!("{} is {}x{}; the limit is {limit}x{limit}", job.source.display(), image.width, image.height)); }
            if !image.width.is_power_of_two() || !image.height.is_power_of_two() { return Err(format!("{} is {}x{}; both sides must be a power of two", job.source.display(), image.width, image.height)); }
            let vtf = vtf_write::encode_with(&Source { width: image.width as usize, height: image.height as usize, rgba: &image.rgba }, job.file_kind, image.uses_alpha, compression);
            Ok(Done { index: job.index, vtf, source_bytes: bytes,
                texture: Texture { kind: job.kind, team: job.team, vtf_path: job.vtf_path.clone(), content_path: job.content_path.clone(), width: image.width, height: image.height, depth: image.depth, source: job.source.clone() } })
        })).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("a texture thread failed".into()))).collect()
    });
    let mut done = Vec::new();
    for r in results { done.push(r?); }
    log.push(format!("{} texture{} converted in {} ms", done.len(), if done.len() == 1 { "" } else { "s" }, started.elapsed().as_millis()));

    // --- the icon ---------------------------------------------------------------------------------------------------------
    let icon_bytes = fs::read(&spec.icon).map_err(|e| format!("{}: {e}", spec.icon.display()))?;
    let icon = tga::decode(&icon_bytes).map_err(|e| format!("{}: {e}", spec.icon.display()))?;
    if icon.width != 512 || icon.height != 512 { return Err(format!("The icon is {}x{}; it must be 512x512", icon.width, icon.height)); }
    let icon_large = vtf_write::encode(&Source { width: 512, height: 512, rgba: &icon.rgba }, Kind::Icon, true);
    let small = vtf_write::resize_box(&icon.rgba, 512, 512, 128, 128);
    let icon_small = vtf_write::encode(&Source { width: 128, height: 128, rgba: &small }, Kind::Icon, true);

    // --- the model: SMD + QC -> studiomdl in a private game folder ---------------------------------------------------------------
    let work = work_root.join(&spec.name);
    if work.exists() { fs::remove_dir_all(&work).map_err(|e| format!("Cannot clear {}: {e}", work.display()))?; }
    let content_models = work.join("content").join("models").join(&item_dir);
    let game = work.join("game");
    fs::create_dir_all(&content_models).map_err(|e| e.to_string())?;
    fs::create_dir_all(game.join("materials").join("models").join(&item_dir)).map_err(|e| e.to_string())?;
    fs::write(game.join("gameinfo.txt"), format!("\"GameInfo\" {{ \"game\" \"TF2 Workbench compiler\" \"FileSystem\" {{ \"SteamAppId\" \"440\" \"SearchPaths\" {{ \"Game\" \"|gameinfo_path|.\" \"Game\" {} }} }} }}", quoted_path(tf)?)).map_err(|e| e.to_string())?;
    for c in &spec.classes {
        let model = spec.model_file(&c.folder);
        for (i, lod) in c.lods.iter().enumerate() {
            fs::write(content_models.join(lod.file(&model, i)), lod.bytes()).map_err(|e| e.to_string())?;
        }
    }
    // the materials where studiomdl looks for them
    for (i, m) in spec.materials.iter().enumerate() {
        fs::write(game.join("materials/models").join(&item_dir).join(format!("{}.vmt", material_file(&spec.name, i))), crlf(&m.vmt)).map_err(|e| e.to_string())?;
        if let Some(b) = &m.blue { fs::write(game.join("materials/models").join(&item_dir).join(format!("{}.vmt", material_file_team(&spec.name, i, 1))), crlf(&b.vmt)).map_err(|e| e.to_string())?; }
    }
    let template_path = format!("scripts/itemtest_qc_template_{}.txt", spec.prefab);
    let template = String::from_utf8(vpk.read(&template_path).map_err(|e| format!("{template_path}: {e}"))?).map_err(|e| e.to_string())?;
    // one QC and one compile per class; the compiles run side by side (each in its own process, writing its own files)
    let mut qcs: Vec<(String, String, PathBuf)> = Vec::new();
    for c in &spec.classes {
        let model = spec.model_file(&c.folder);
        let mut qc_text = fill_qc(&template, spec, c);
        if !c.qc_extra.trim().is_empty() { qc_text = format!("{}
{}
", qc_text.trim_end(), c.qc_extra.replace("
", "
").trim_end()); }
        let qc_path = content_models.join(format!("{model}.qc"));
        fs::write(&qc_path, crlf(&qc_text)).map_err(|e| e.to_string())?;
        qcs.push((model, qc_text, plain_absolute(&qc_path)?));
    }
    // the tool runs in its own folder, so it needs paths that mean the same there
    let game_path = plain_absolute(&game)?;
    let compiled: Vec<Result<Vec<String>, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = qcs.iter().map(|(_, _, qc)| { let (exe, game_path) = (&exe, &game_path); scope.spawn(move || { let mut l = Vec::new(); run_studiomdl(exe, game_path, qc, &mut l).map(|_| l) }) }).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("a compile thread failed".into()))).collect()
    });
    for (c, r) in spec.classes.iter().zip(compiled) {
        match r { Ok(lines) => log.extend(lines.into_iter().map(|l| if spec.multiclass() { format!("{}: {l}", c.folder) } else { l })), Err(e) => return Err(if spec.multiclass() { format!("{}: {e}", c.folder) } else { e }) }
    }
    let mut model_files: Vec<(String, Vec<u8>)> = Vec::new();
    for (model, _, _) in &qcs {
        for ext in ["mdl", "dx80.vtx", "dx90.vtx", "sw.vtx", "vvd"] {
            let rel = format!("models/{item_dir}/{model}.{ext}");
            model_files.push((format!("game/{rel}"), fs::read(game.join(&rel)).map_err(|_| format!("The compiler did not make {rel}"))?));
        }
    }

    // --- the archive ------------------------------------------------------------------------------------------------------------
    let zip_path = out_dir.join(format!("{}.zip", spec.name));
    let icon_content = format!("content/materialsrc/{icon_dir}/{}_large.tga", spec.name);
    let textures: Vec<Vec<Texture>> = (0..spec.materials.len()).map(|i| done.iter().filter(|d| d.index == i).map(|d| Texture { kind: d.texture.kind, team: d.texture.team, vtf_path: d.texture.vtf_path.clone(), content_path: d.texture.content_path.clone(), width: d.texture.width, height: d.texture.height, depth: d.texture.depth, source: d.texture.source.clone() }).collect()).collect();
    let mut zip = ZipBuilder::new();
    zip.add("manifest.txt", crlf(&session_text(spec, &template, &textures, &icon_content, &zip_path, true, "")));
    let unlit = |texture: &str, vertex_color: bool| crlf(&format!("\"UnlitGeneric\"\n{{\n\t\"$basetexture\"\t\t\"{texture}\"\n\t\"$translucent\"\t\t\"1\"\n{}}}\n", if vertex_color { "\t\"$vertexcolor\"\t\t\"1\"\n" } else { "" }));
    zip.add(&format!("game/materials/{icon_dir}/{}.vmt", spec.name), unlit(&format!("{icon_dir}/{}", spec.name), true));
    zip.add(&format!("game/materials/{icon_dir}/{}.vtf", spec.name), icon_small);
    zip.add(&format!("content/materialsrc/{icon_dir}/{}.tga", spec.name), icon_bytes.clone());
    zip.add(&format!("content/materialsrc/{icon_dir}/{}.txt", spec.name), crlf("reduce 4\nnomip 1\nnolod 1\nnonice 1\n"));
    zip.add(&format!("game/materials/{icon_dir}/{}_large.vmt", spec.name), unlit(&format!("{icon_dir}/{}_large", spec.name), false));
    zip.add(&format!("game/materials/{icon_dir}/{}_large.vtf", spec.name), icon_large);
    zip.add(&icon_content, icon_bytes);
    zip.add(&format!("content/materialsrc/{icon_dir}/{}_large.txt", spec.name), crlf("nomip 1\nnolod 1\n"));
    for (i, m) in spec.materials.iter().enumerate() {
        zip.add(&format!("game/materials/models/{item_dir}/{}.vmt", material_file(&spec.name, i)), crlf(&m.vmt));
        if let Some(b) = &m.blue { zip.add(&format!("game/materials/models/{item_dir}/{}.vmt", material_file_team(&spec.name, i, 1)), crlf(&b.vmt)); }
        for d in done.iter().filter(|d| d.index == i) {
            zip.add(&d.texture.vtf_path, d.vtf.clone());
            zip.add(&d.texture.content_path, d.source_bytes.clone());
        }
    }
    for (path, bytes) in model_files { zip.add(&path, bytes); }
    for c in &spec.classes {
        let model = spec.model_file(&c.folder);
        for (i, lod) in c.lods.iter().enumerate() {
            zip.add(&format!("content/models/{item_dir}/{}", lod.file(&model, i)), lod.bytes());
        }
    }
    for (model, qc_text, _) in &qcs { zip.add(&format!("content/models/{item_dir}/{model}.qc"), crlf(qc_text)); }
    fs::create_dir_all(out_dir).map_err(|e| format!("Cannot create {}: {e}", out_dir.display()))?;
    zip.write(&zip_path).map_err(|e| format!("Cannot write {}: {e}", zip_path.display()))?;
    let session = out_dir.join(format!("{}.txt", spec.name));
    fs::write(&session, crlf(&session_text(spec, &template, &textures, &spec.icon.to_string_lossy(), &zip_path, false, ""))).map_err(|e| e.to_string())?;
    log.push(format!("{} files, {} KB, built in {} ms", zip.len(), fs::metadata(&zip_path).map(|m| m.len() / 1024).unwrap_or(0), started.elapsed().as_millis()));
    let _ = fs::remove_dir_all(&work);
    Ok(Built { zip: zip_path, session, log, millis: started.elapsed().as_millis() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> ItemSpec {
        ItemSpec {
            name: "a_cowboyhat".into(), display_name: "The Cowboy Hat".into(), prefab: "hat".into(), equip_region: "hat".into(),
            bodygroups: vec!["hat".into()], paintable: false,
            classes: vec![ClassSpec { folder: "sniper".into(), qc_extra: String::new(), lod_commands: Vec::new(), lods: vec![LodSpec { source_path: "C:\\hat.fbx".into(), smd: "version 1\n".into(), dmx: None, triangles: 100, vertices: 80 }, LodSpec { source_path: "C:\\hat_lod.fbx".into(), smd: "version 1\n".into(), dmx: None, triangles: 50, vertices: 40 }] }],
            materials: vec![MaterialSpec { source_name: "ND_ID_MAT_TEAL".into(), vmt: "\"VertexLitGeneric\"\n{\n}\n".into(), color: Some("c.tga".into()), normal: None, phongexponent: None, illum: None, paintable: false, blue: None }],
            icon: "icon.tga".into(), compression: Compression::Dxt,
        }
    }

    #[test]
    fn the_qc_is_what_the_importer_wrote_for_this_hat() {
        // the hat template of the game, and the QC the in-game importer made from it (a_cowboyhat.qc)
        let template = "$upaxis Y\n\n$modelname \"<ITEMTEST_REPLACE_MDLABSPATH>\"\n\n$surfaceprop \"default\"\n\n$body \"default\" \"<ITEMTEST_REPLACE_LOD0>\"\n\n<ITEMTEST_REPLACE_LOD1_HEADER>\n{\nreplacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"\n}\n\n<ITEMTEST_REPLACE_LOD2_HEADER>\n{\nreplacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD2>\"\n}\n\n<ITEMTEST_REPLACE_SKIN_OPTIONALBLOCK>\n\n$sequence \"ref\" \"<ITEMTEST_REPLACE_LOD0>\"\n\n$attachment unusual \"bip_head\" 0 0 0 rotate 0 0 0\n";
        let s = spec();
        let qc = fill_qc(template, &s, &s.classes[0]);
        let expected = "$upaxis Y\n\n$modelname \"workshop/player/items/sniper/a_cowboyhat/a_cowboyhat.mdl\"\n\n$surfaceprop \"default\"\n\n$body \"default\" \"a_cowboyhat.smd\"\n\n$lod 11\n{\nreplacemodel \"a_cowboyhat.smd\" \"a_cowboyhat_lod1.smd\"\n}\n\n\n\n$cdmaterials \"models\\workshop\\player\\items\\sniper\\a_cowboyhat\"\n$texturegroup skinfamilies\n{\n    { \"a_cowboyhat\" }\n}\n\n$sequence \"ref\" \"a_cowboyhat.smd\"\n\n$attachment unusual \"bip_head\" 0 0 0 rotate 0 0 0\n";
        assert_eq!(qc, expected);
    }

    #[test]
    fn the_session_keeps_the_qc_template_with_the_bone_commands() {
        let mut s = spec();
        s.classes[0].lod_commands = vec![vec!["replacebone \"bip_pack\" \"bip_pelvis\"".into()], vec![]];
        s.classes[0].qc_extra = "$jigglebone \"tail\"
{
	is_flexible
}".into();
        let template = "$body \"default\" \"<ITEMTEST_REPLACE_LOD0>\"
<ITEMTEST_REPLACE_LOD1_HEADER>
{
replacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"
}
";
        let session = session_text(&s, template, &[vec![]], "C:/icon.tga", Path::new("C:/a.zip"), false, "");
        assert!(session.contains("\"QC\""), "{session}");
        assert!(session.contains("$jigglebone \\\"tail\\\"
{
	is_flexible
}"), "{session}");
        assert!(session.contains("<ITEMTEST_REPLACE_LOD1_HEADER>
{
replacemodel \\\"<ITEMTEST_REPLACE_LOD0>\\\" \\\"<ITEMTEST_REPLACE_LOD1>\\\"
replacebone \\\"bip_pack\\\" \\\"bip_pelvis\\\"
}"), "{session}");
    }

    #[test]
    fn the_class_bone_commands_go_inside_the_lod_blocks() {
        let mut s = spec();
        let first = s.classes[0].lods[0].clone();
        s.classes[0].lods.push(first);
        s.classes[0].lod_commands = vec![vec!["bonetreecollapse \"bip_head\"".into()], vec!["replacebone \"bip_collar_L\" \"bip_spine_3\"".into(), "nofacial".into()]];
        let qc = fill_qc("<ITEMTEST_REPLACE_LOD1_HEADER>
{
replacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"
}

<ITEMTEST_REPLACE_LOD2_HEADER>
{
replacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD2>\"
}
<ITEMTEST_REPLACE_SKIN_OPTIONALBLOCK>", &s, &s.classes[0]);
        assert!(qc.starts_with("$lod 11
{
replacemodel \"a_cowboyhat.smd\" \"a_cowboyhat_lod1.smd\"
bonetreecollapse \"bip_head\"
}
"), "{qc}");
        assert!(qc.contains("$lod 22
{
replacemodel \"a_cowboyhat.smd\" \"a_cowboyhat_lod2.smd\"
replacebone \"bip_collar_L\" \"bip_spine_3\"
nofacial
}
"), "{qc}");
    }

    #[test]
    fn two_materials_and_three_lods() {
        let mut s = spec();
        let first = s.classes[0].lods[0].clone();
        s.classes[0].lods.push(first);
        s.materials.push(s.materials[0].clone());
        let qc = fill_qc("<ITEMTEST_REPLACE_LOD1_HEADER>\n{\nreplacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"\n}\n<ITEMTEST_REPLACE_LOD2_HEADER>\n{\nreplacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD2>\"\n}\n<ITEMTEST_REPLACE_SKIN_OPTIONALBLOCK>", &s, &s.classes[0]);
        assert!(qc.contains("$lod 11") && qc.contains("$lod 22") && qc.contains("a_cowboyhat_lod2.smd"));
        assert!(qc.contains("{ \"a_cowboyhat\" \"a_cowboyhat_1\" }"));
    }

    #[test]
    fn bad_specs_are_refused() {
        let mut s = spec();
        assert!(validate(&s).is_ok());
        s.name = "Bad Name".into();
        assert!(validate(&s).is_err());
        let mut s = spec(); s.classes[0].folder = "demoman".into(); assert!(validate(&s).is_err());
        let mut s = spec(); s.classes.push(s.classes[0].clone()); assert!(validate(&s).is_err(), "a class twice");
        let mut s = spec(); let mut other = s.classes[0].clone(); other.folder = "scout".into(); other.lods.pop(); s.classes.push(other); assert!(validate(&s).is_err(), "LOD counts differ");
        let mut s = spec(); s.materials.clear(); assert!(validate(&s).is_err());
        let mut s = spec(); s.bodygroups = vec!["feet".into()]; assert!(validate(&s).is_err());
        let mut s = spec(); s.materials[0].color = None; assert!(validate(&s).is_err());
    }

    #[test]
    fn the_session_text_has_the_importers_shape() {
        let s = spec();
        let textures = vec![vec![Texture { kind: "base", team: 0, vtf_path: "x".into(), content_path: "content/materialsrc/models/a.tga".into(), width: 512, height: 512, depth: 32, source: "C:\\a.tga".into() }]];
        let text = session_text(&s, "$body \"default\" \"<ITEMTEST_REPLACE_LOD0>\"
<ITEMTEST_REPLACE_LOD1_HEADER>
{
replacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"
}
", &textures, "content/materialsrc/backpack/x_large.tga", Path::new("C:\\Steam\\a_cowboyhat.zip"), true, "");
        assert!(text.starts_with("\"asset\"\r\n{\r\n\t\"ImportSession\"\r\n\t{\r\n\t\t\"prefab\"\t\t\"hat\"\r\n"));
        assert!(text.contains("\"base_texture_channels\"\t\t\"4\"") && text.contains("\"base_texture_alpha\"\t\t\"1\""));
        assert!(text.contains("\"model_player\"\t\t\"models/workshop/player/items/sniper/a_cowboyhat/a_cowboyhat.mdl\""));
        assert!(text.contains("\"propername\"\t\t\"1\""));
        assert!(text.contains("\"sniper\"\t\t\"1\""));
        assert!(text.contains("\"materialId\"\t\t\"ND_ID_MAT_TEAL\""));
        let session = session_text(&s, "$body \"default\" \"<ITEMTEST_REPLACE_LOD0>\"
<ITEMTEST_REPLACE_LOD1_HEADER>
{
replacemodel \"<ITEMTEST_REPLACE_LOD0>\" \"<ITEMTEST_REPLACE_LOD1>\"
}
", &textures, "C:\\icon.tga", Path::new("C:\\a.zip"), false, "");
        assert!(session.starts_with("\"data\"") && !session.contains("\"steamid\""));
        assert!(session.contains("\"file\"\t\t\"C:\\\\hat.fbx\""));
    }
}
