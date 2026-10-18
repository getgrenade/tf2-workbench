//! The backend's questions and answers in one place: the web build asks them by name (see `call`), the desktop commands call the same functions.
use serde_json::Value;

use crate::{game, payload, state::AppState};

/// What a command answers: raw bytes (models, pixels, clips) or JSON.
pub enum Reply {
    Bytes(Vec<u8>),
    Json(Value),
}

/// The class model of a compiled Workshop taunt's animation (`models/workshop/workbench/<key>/<class folder>/animation.mdl`).
fn workshop_taunt_class(path: &str) -> Option<String> {
    let lower = path.to_ascii_lowercase().replace('\\', "/");
    let rest = lower.strip_prefix("models/workshop/workbench/")?;
    let mut parts = rest.split('/');
    let (_key, folder) = (parts.next()?, parts.next()?);
    Some(format!("models/player/{}.mdl", if folder == "demo" { "demoman" } else { folder }))
}

/// Bakes a sequence at its native frame rate with the given encoded (0..1) pose parameters. `blend` (default on) plays a taunt over the
/// class's stand pose as the game does; off, it is sampled alone, as the animation file holds it.
pub fn bake_sequence(state: &AppState, path: &str, sequence: usize, params: &[f32], target_path: Option<&str>, blend: Option<bool>) -> Result<Vec<u8>, String> {
    let blend = blend.unwrap_or(true);
    let set = state.anim_set(path)?;
    if sequence >= set.num_sequences() {
        return Err(format!("sequence {sequence} out of range ({})", set.num_sequences()));
    }
    // A Workshop taunt is compiled on its own, with no stand pose: it is layered over its class's, as the game layers a taunt over the player
    let class = workshop_taunt_class(path).map(|c| state.anim_set(&c)).transpose()?;
    let clip = if let Some(target) = target_path {
        let model = state.model(target)?;
        set.bake_for_bones_with(sequence, params, &model.bones, class.as_deref(), blend)
    } else {
        set.bake_with(sequence, params, class.as_deref(), blend)
    };
    Ok(payload::encode_clip(&clip))
}

/// One request of [`eval_poses`]: sequence, cycle, the layers over it (sequence, cycle, weight), how many of those belong to the movement,
/// and the sequence the left arm is taken from (or -1).
pub type PoseRequest = (i64, f32, Vec<(i64, f32, f32)>, usize, i64);

/// Poses evaluated live (play mode): the reply is, per request, the local bone positions (`bones * 3` f32) followed by the rotations
/// (`bones * 4` f32, x y z w), all little endian. `params` are the encoded (0..1) pose parameters. With `pin_params` the feet are planted
/// where they stand under those parameters, like the game's foot IK.
pub fn eval_poses(state: &AppState, path: &str, requests: Vec<PoseRequest>, params: &[f32], pin_params: Option<&[f32]>) -> Result<Vec<u8>, String> {
    let set = state.anim_set(path)?;
    let nb = set.num_bones();
    let mut out: Vec<u8> = Vec::with_capacity(requests.len() * nb * 7 * 4);
    for (seq, cycle, layers, base_layers, arm_base) in requests {
        if seq < 0 || seq as usize >= set.num_sequences() {
            return Err(format!("sequence {seq} out of range ({})", set.num_sequences()));
        }
        let seq = seq as usize;
        let layers: Vec<(usize, f32, f32)> =
            layers.into_iter().filter(|(s, _, _)| *s >= 0 && (*s as usize) < set.num_sequences()).map(|(s, c, w)| (s as usize, c, w)).collect();
        let mut pose = set.evaluate_layered(seq, cycle, &layers, params);
        if arm_base >= 0 && (arm_base as usize) < set.num_sequences() {
            let standing = set.evaluate_layered(arm_base as usize, 0.0, &layers, params);
            set.copy_left_arm(&mut pose, &standing);
        }
        if let Some(pin) = pin_params {
            // the feet stand where the movement alone (no aim, no attack or gesture on top) has them
            let base = set.evaluate_layered(seq, cycle, &layers[..base_layers.min(layers.len())], pin);
            set.plant_feet(&mut pose, &base);
        }
        for p in &pose.pos {
            for v in p {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        for q in &pose.quat {
            for v in q {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    Ok(out)
}

fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| format!("missing argument: {key}"))
}
fn floats(args: &Value, key: &str) -> Vec<f32> {
    args.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect()).unwrap_or_default()
}

/// Answers a command of the web build: the name and arguments are the ones of the desktop command (arguments as a JSON object).
pub fn call(state: &AppState, command: &str, args: &Value) -> Result<Reply, String> {
    let vpk = || state.vpk();
    Ok(match command {
        "load_model" => {
            let lod = args.get("lod").and_then(Value::as_u64).unwrap_or(0) as usize;
            Reply::Bytes(payload::encode(&*state.model_lod(text(args, "path")?, lod)?))
        }
        "load_material" => Reply::Bytes(state.material_payload(text(args, "path")?)?.as_ref().clone()),
        "load_texture_frames" => {
            let max = args.get("maxFrames").and_then(Value::as_u64).unwrap_or(128) as usize;
            Reply::Bytes(source_formats::material::texture_frames(&*vpk()?, text(args, "path")?, max).map_err(|e| e.to_string())?)
        }
        "load_particle_asset" => Reply::Bytes(game::read_particle_asset(&*vpk()?, text(args, "path")?)?),
        "load_overlay_font" => Reply::Bytes(game::read_overlay_font(&*vpk()?, text(args, "path")?)?),
        "list_sequences" => Reply::Bytes(payload::encode_anim_info(&*state.anim_set(text(args, "path")?)?)),
        "bake_sequence" => Reply::Bytes(bake_sequence(
            state,
            text(args, "path")?,
            args.get("sequence").and_then(Value::as_u64).ok_or("missing argument: sequence")? as usize,
            &floats(args, "params"),
            args.get("targetPath").and_then(Value::as_str),
            args.get("blend").and_then(Value::as_bool),
        )?),
        "eval_poses" => {
            let requests: Vec<PoseRequest> = serde_json::from_value(args.get("requests").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let pin = args.get("pinParams").filter(|v| !v.is_null()).map(|_| floats(args, "pinParams"));
            Reply::Bytes(eval_poses(state, text(args, "path")?, requests, &floats(args, "params"), pin.as_deref())?)
        }
        "get_weapon_profile" => Reply::Json(game::weapon_profile(
            &*vpk()?,
            args.get("itemId").and_then(Value::as_u64).ok_or("missing argument: itemId")? as u32,
            text(args, "class")?,
            args.get("team").and_then(Value::as_u64).unwrap_or(0) as u32,
        )?),
        "player_gibs" => Reply::Json(game::gib_definitions(&*vpk()?, text(args, "path")?)?),
        "model_physics" => Reply::Json(game::model_physics(&*vpk()?, text(args, "path")?)?),
        "load_scene" => Reply::Json(crate::voice::scene(state, text(args, "path")?)?),
        "scene_playing" => {
            let paths: Vec<String> = serde_json::from_value(args.get("paths").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            Reply::Json(crate::voice::scene_playing(state, &paths, text(args, "sequence")?)?.map_or(Value::Null, Value::String))
        }
        "voice_lines" => Reply::Json(crate::voice::voice_lines(state, text(args, "class")?)?),
        "phoneme_classes" => Reply::Json(crate::voice::phoneme_classes(state, text(args, "class")?)?),
        "lip_sync" => Reply::Json(crate::voice::lip_sync(state, text(args, "wave")?)?),
        "read_sound" => Reply::Bytes(crate::voice::read_sound(state, text(args, "wave")?)?),
        "list_items" => Reply::Bytes(state.items_payload()?.as_ref().clone()),
        "list_unusual_effects" => Reply::Json(serde_json::to_value(game::unusual_effects(&*vpk()?)?).map_err(|e| e.to_string())?),
        "particle_system_file" => {
            let system = text(args, "system")?;
            let files = state.particle_files()?;
            let file = files.get(system).cloned().or_else(|| files.iter().find(|(name, _)| name.eq_ignore_ascii_case(system)).map(|(_, file)| file.clone()));
            Reply::Json(Value::String(file.ok_or_else(|| format!("Particle system not installed: {system}"))?))
        }
        "search_paths" => {
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
            Reply::Json(Value::Array(vpk()?.search(text(args, "query")?, limit).into_iter().map(|p| Value::String(p.to_owned())).collect()))
        }
        other => return Err(format!("unknown command: {other}")),
    })
}
