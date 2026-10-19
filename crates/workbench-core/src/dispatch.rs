//! The animation questions of the backend: baking a sequence and posing live (play mode).
use crate::{payload, state::AppState};

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
