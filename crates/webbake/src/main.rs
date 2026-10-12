//! Extracts, from a TF2 install, exactly the files the web build reads.
//!
//! The web build runs the same backend as the desktop app (workbench-core, as WebAssembly) but over files fetched one by one from the site. To know
//! which files that is, this tool asks the backend the questions the viewer asks (every model of every class and item, their materials, their
//! animations and physics, the weapons' profiles, the particle effects with their materials, the skies...) while the game's archives record every
//! file the answers needed, and then copies those files out untouched. What it writes is generated: it is never committed.
//!
//!     webbake --out <folder> [--tf <TF2 tf folder>] [--quick]
use std::{collections::BTreeSet, fs, path::PathBuf, sync::Arc, time::Instant};

use workbench_core::{dispatch, state::AppState};
use serde_json::Value;
use source_formats::{items, steam, VpkSet};

/// The game's class names (as the item schema has them) with the folder name of their model.
const CLASSES: [(&str, &str); 9] = [
    ("scout", "scout"), ("soldier", "soldier"), ("pyro", "pyro"), ("demoman", "demo"), ("heavy", "heavy"),
    ("engineer", "engineer"), ("medic", "medic"), ("sniper", "sniper"), ("spy", "spy"),
];

struct Crawl<'a> {
    state: &'a AppState,
    vpk: Arc<VpkSet>,
    models_done: BTreeSet<String>,
    materials_done: BTreeSet<String>,
    failures: Vec<String>,
}

impl Crawl<'_> {
    fn fail(&mut self, what: &str, why: String) {
        if self.failures.len() < 4000 {
            self.failures.push(format!("{what}: {why}"));
        }
    }

    /// A model with its files, every material of every skin of every part, its animations and its physics (what the viewer asks for it).
    fn model(&mut self, path: &str) {
        let path = path.replace('\\', "/").to_ascii_lowercase();
        if !path.ends_with(".mdl") || !self.models_done.insert(path.clone()) {
            return;
        }
        match self.state.model(&path) {
            Ok(model) => {
                let mut materials = BTreeSet::new();
                for part in &model.body_parts {
                    for sub in &part.models {
                        for mesh in &sub.meshes {
                            if mesh.indices.is_empty() {
                                continue;
                            }
                            materials.extend(mesh.materials.iter().cloned());
                            materials.insert(mesh.material.clone());
                        }
                    }
                }
                for m in materials {
                    self.material(&m);
                }
                // animations: only models that have bones to move
                if model.bones.len() > 1 {
                    let _ = self.state.anim_set(&path);
                }
                for include in &model.include_models {
                    let _ = self.vpk.contains(include);
                }
            }
            Err(e) => self.fail(&path, e),
        }
        // the physics file, when the model has one
        let _ = workbench_core::game::model_physics(&self.vpk, &path);
    }

    fn material(&mut self, path: &str) {
        let path = path.replace('\\', "/").to_ascii_lowercase();
        let path = if path.starts_with("materials/") { path } else { format!("materials/{path}") };
        let path = if path.ends_with(".vmt") { path } else { format!("{path}.vmt") };
        if !self.materials_done.insert(path.clone()) {
            return;
        }
        if let Err(e) = self.state.material_payload(&path) {
            self.fail(&path, e);
        }
    }

    /// Every string of a PCF that names a material or a model.
    fn particle_file(&mut self, path: &str) {
        let Ok(bytes) = self.vpk.read(path) else { return };
        for raw in bytes.split(|b| *b == 0) {
            // (an attribute's string value follows a type byte, which is left on the front)
            let raw = &raw[raw.iter().take_while(|b| **b < 0x20).count()..];
            let Ok(text) = std::str::from_utf8(raw) else { continue };
            let text = text.trim().replace('\\', "/").to_ascii_lowercase();
            if text.len() < 5 || text.len() > 200 || !text.chars().all(|c| c.is_ascii_graphic()) {
                continue;
            }
            if text.ends_with(".vmt") {
                self.material(&text);
            } else if text.ends_with(".mdl") && text.starts_with("models/") {
                let _ = self.vpk.read(&text);
            } else if text.contains('/') && !text.contains('.') && !text.contains(' ') && self.vpk.contains(&format!("materials/{text}.vmt")) {
                // (a particle system names its material without the extension)
                self.material(&text);
            }
        }
    }

    fn json_models(&mut self, v: &Value) {
        match v {
            Value::String(s) if s.to_ascii_lowercase().ends_with(".mdl") => self.model(s),
            Value::Array(a) => a.iter().for_each(|x| self.json_models(x)),
            Value::Object(o) => o.values().for_each(|x| self.json_models(x)),
            _ => {}
        }
    }
}

fn main() {
    let mut out = PathBuf::from("web-assets");
    let mut tf: Option<PathBuf> = None;
    let mut quick = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--out" => out = PathBuf::from(args.next().expect("--out needs a folder")),
            "--tf" => tf = Some(PathBuf::from(args.next().expect("--tf needs a folder"))),
            "--quick" => quick = true,
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let tf = tf.or_else(steam::find_tf2).unwrap_or_else(|| {
        eprintln!("Team Fortress 2 was not found: pass its tf folder with --tf");
        std::process::exit(1)
    });
    println!("reading {}", tf.display());
    let started = Instant::now();
    let state = AppState::default();
    state.set_vpk(VpkSet::open_folder_game_only(&tf).expect("cannot open the game's archives"));
    let vpk = state.vpk().expect("vpk");
    vpk.record(true);
    let mut crawl = Crawl { state: &state, vpk: vpk.clone(), models_done: BTreeSet::new(), materials_done: BTreeSet::new(), failures: Vec::new() };

    // the item catalog and what the web build answers without asking (the lists)
    let items_bytes = state.items_payload().expect("items");
    println!("items payload {} bytes", items_bytes.len());
    let db = items::load(&vpk).expect("items_game");
    let effects = dispatch::call(&state, "list_unusual_effects", &Value::Null);
    println!("unusual effects listed: {}", effects.is_ok());

    // the classes: their models, gibs and physics
    for (_, folder) in CLASSES {
        crawl.model(&format!("models/player/{folder}.mdl"));
        if let Ok(dispatch::Reply::Json(gibs)) = dispatch::call(&state, "player_gibs", &serde_json::json!({ "path": format!("models/player/{folder}.mdl") })) {
            crawl.json_models(&gibs);
        }
    }

    // the cosmetics, weapons and taunts: a model per class that can use them, their styles and their backpack picture
    let everyone: Vec<&str> = CLASSES.iter().map(|c| c.0).collect();
    let mut count = 0usize;
    let limit = if quick { 120 } else { usize::MAX };
    for item in db.items.iter().chain(db.weapons.iter()).chain(db.taunts.iter()).take(limit) {
        count += 1;
        if count % 500 == 0 {
            println!("  {count} items, {} models, {} materials", crawl.models_done.len(), crawl.materials_done.len());
        }
        if let Some(image) = &item.image {
            crawl.material(image);
        }
        for style in &item.styles {
            if let Some(image) = &style.image {
                crawl.material(image);
            }
            if let Some(m) = &style.model {
                crawl.model(m);
            }
            for m in style.per_class.values() {
                crawl.model(m);
            }
        }
        if let Some(m) = &item.model {
            crawl.model(m);
        }
        for m in item.per_class.values() {
            crawl.model(m);
        }
        for m in &item.extra_models {
            crawl.model(m);
        }
        for class in &everyone {
            if let Some(m) = item.model_for(class) {
                crawl.model(m);
            }
        }
    }
    println!("{count} items: {} models, {} materials", crawl.models_done.len(), crawl.materials_done.len());

    // the weapons' profiles (muzzle flashes, brass, projectiles) for every class and team
    let mut profiles = 0;
    for item in db.weapons.iter().take(limit) {
        for class in everyone.iter().filter(|c| item.usable_by(c)) {
            for team in 0..2u32 {
                for name in [*class, if *class == "demoman" { "demo" } else { *class }] {
                    let answer = dispatch::call(&state, "get_weapon_profile", &serde_json::json!({ "itemId": item.id, "class": name, "team": team }));
                    if let Ok(dispatch::Reply::Json(profile)) = answer {
                        crawl.json_models(&profile);
                        profiles += 1;
                    }
                }
            }
        }
    }
    println!("{profiles} weapon profiles");

    // the particle effects: every file with the materials and models it names
    let pcfs: Vec<String> = vpk.search("particles/", usize::MAX).into_iter().filter(|p| p.ends_with(".pcf")).map(str::to_owned).collect();
    for pcf in &pcfs {
        crawl.particle_file(pcf);
    }
    println!("{} particle files, {} materials in all", pcfs.len(), crawl.materials_done.len());

    // the skies, the class icons, the fonts of the overlays and the light ramps
    for prefix in ["materials/skybox/sky_", "materials/hud/leaderboard_class_", "materials/effects/invuln", "materials/hlmv/"] {
        let found: Vec<String> = vpk.search(prefix, usize::MAX).into_iter().filter(|p| p.ends_with(".vmt")).map(str::to_owned).collect();
        for p in found {
            crawl.material(&p);
        }
    }
    // the cubemaps that can light a scene (the viewer asks for each as a material of its own, see `material::CUBEMAP_PREFIX`)
    let cubemaps: Vec<String> = vpk.search("materials/cubemaps/cubemap_", usize::MAX).into_iter()
        .filter(|p| p.ends_with(".vtf") && !p.ends_with(".hdr.vtf") && !p.contains("render_source")).map(str::to_owned).collect();
    for p in cubemaps {
        crawl.material(&format!("{}{}.vmt", source_formats::material::CUBEMAP_PREFIX, p.trim_start_matches("materials/").trim_end_matches(".vtf")));
    }
    for name in ["hlmv/cubemap", "effects/saxxy/saxxy_gold", "effects/pyrocube"] {
        crawl.material(&format!("{}{name}.vmt", source_formats::material::CUBEMAP_PREFIX));
    }
    // the buildings, the shells and gibs, the screens of the dispenser, the blood decals and the glow of an uber charge
    for prefix in ["models/buildables/", "models/weapons/shells/", "models/effects/", "models/player/gibs/"] {
        let found: Vec<String> = vpk.search(prefix, usize::MAX).into_iter().filter(|p| p.ends_with(".mdl")).map(str::to_owned).collect();
        for p in found {
            crawl.model(&p);
        }
    }
    for name in [
        "decals/decals_mod2x", "decals/blood1_subrect", "decals/blood2_subrect", "decals/blood3_subrect", "decals/blood4_subrect", "decals/blood5_subrect",
        "decals/blood6_subrect", "vgui/dispenser_meter_bg_red", "vgui/dispenser_meter_bg_blue", "vgui/dispenser_meter_arrow", "models/effects/invulnfx_red",
        "models/effects/invulnfx_blue",
    ] {
        crawl.material(name);
    }
    for font in ["tf", "tf2", "tf2build", "tf2secondary", "tf2professor", "tfd", "ocra"] {
        let _ = vpk.read(&format!("resource/{font}.ttf"));
    }
    for ramp in [
        "models/player/pyro/pyro_lightwarp", "models/lightwarps/weapon_lightwarp", "models/lightwarps/robot_lightwarp", "models/lightwarps/jarate_lightwarp",
        "models/buildables/sentry1/sentry1_lightwarp", "models/buildables/sentry2/sentry2_lightwarp", "models/buildables/sentry3/sentry3_lightwarp",
        "models/weapons/c_items/c_ambassador_lightwarp",
    ] {
        let _ = dispatch::call(&state, "load_texture_frames", &serde_json::json!({ "path": ramp, "maxFrames": 1 }));
    }

    // the answers that are lists, ready made
    fs::create_dir_all(out.join("assets")).expect("output folder");
    fs::write(out.join("static-list_items.bin"), items_bytes.as_ref()).unwrap();
    if let Ok(dispatch::Reply::Json(v)) = effects {
        fs::write(out.join("static-list_unusual_effects.json"), serde_json::to_vec(&v).unwrap()).unwrap();
    }
    if let Ok(files) = state.particle_files() {
        fs::write(out.join("static-particle_files.json"), serde_json::to_vec(&*files).unwrap()).unwrap();
    }

    // copy what was read
    let paths = vpk.recorded();
    let mut bytes_total = 0u64;
    let mut missing = 0;
    for (i, p) in paths.iter().enumerate() {
        if i % 5000 == 0 {
            println!("  copying {i}/{}", paths.len());
        }
        match vpk.read(p) {
            Ok(data) => {
                bytes_total += data.len() as u64;
                let target = out.join("assets").join(p);
                if let Some(dir) = target.parent() {
                    fs::create_dir_all(dir).unwrap();
                }
                fs::write(&target, data).unwrap();
            }
            Err(_) => missing += 1,
        }
    }
    fs::write(out.join("index.txt"), paths.join("\n")).unwrap();
    fs::write(out.join("failures.txt"), crawl.failures.join("\n")).unwrap();
    println!(
        "{} files, {:.1} MB ({} unreadable) in {:.0} s; {} things could not be loaded (see failures.txt)",
        paths.len(), bytes_total as f64 / 1048576.0, missing, started.elapsed().as_secs_f64(), crawl.failures.len()
    );
}
