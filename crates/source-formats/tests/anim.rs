//! Animation tests against the real TF2 install. Skipped when TF2 isn't found.

use source_formats::{anim::AnimSet, steam, VpkSet};

fn load(class: &str) -> Option<AnimSet> {
    let vpk = VpkSet::open_folder(&steam::find_tf2()?).unwrap();
    Some(AnimSet::load(&vpk, &format!("models/player/{class}.mdl")).unwrap_or_else(|e| panic!("{class}: {e}")))
}

#[test]
fn includemodels_are_merged_into_one_virtual_model() {
    let Some(set) = load("soldier") else { return };
    assert_eq!(set.num_bones(), 86);
    assert!(set.num_sequences() > 300, "sequences: {}", set.num_sequences());
    let names: Vec<&str> = set.pose_params.iter().map(|p| p.name.as_str()).collect();
    for want in ["body_yaw", "body_pitch", "move_x", "move_y"] {
        assert!(names.contains(&want), "missing pose parameter {want}: {names:?}");
    }
    // Sequences come from the $includemodel animation files, not the main MDL.
    assert!(set.find_sequence("stand_primary").is_some());
    assert!(set.find_sequence("run_primary").is_some());
}

#[test]
fn ref_sequence_is_the_bind_pose() {
    let Some(set) = load("soldier") else { return };
    let i = set.find_sequence("ref").unwrap();
    let pose = set.evaluate(i, 0.0, &set.default_pose_params());
    let names = set.bone_names();
    let spine = names.iter().position(|n| n == "bip_spine_0").unwrap();
    // bip_spine_0's base rotation is 0.0239 rad about X (see the MDL bone data).
    let q = pose.quat[spine];
    assert!((q[0] - (0.0239f32 * 0.5).sin()).abs() < 1e-3, "{q:?}");
    assert!(q[1].abs() < 1e-4 && q[2].abs() < 1e-4);
    let pelvis = names.iter().position(|n| n == "bip_pelvis").unwrap();
    // The posed reference has the root rotation applied: Source space, z up.
    assert!((pose.pos[pelvis][2] - 42.406).abs() < 0.01, "pelvis {:?}", pose.pos[pelvis]);
}

#[test]
fn stand_primary_is_a_stable_upright_looping_clip() {
    let Some(set) = load("soldier") else { return };
    let i = set.find_sequence("stand_primary").unwrap();
    let params = set.default_pose_params();
    let clip = set.bake(i, &params);
    assert_eq!((clip.frames, clip.fps as i32), (51, 30));
    assert!(clip.looping);
    assert!(clip.pos.iter().chain(&clip.quat).all(|v| v.is_finite()));
    // A looping clip ends where it starts.
    let nb = clip.num_bones;
    let first = &clip.quat[..nb * 4];
    let last = &clip.quat[(clip.frames - 1) * nb * 4..];
    let max_diff = first.iter().zip(last).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
    assert!(max_diff < 0.02, "loop seam {max_diff}");
    // Quaternions stay normalised.
    for q in clip.quat.chunks(4) {
        let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
        assert!((n - 1.0).abs() < 1e-3, "non-unit quaternion {q:?}");
    }
}

#[test]
fn every_class_bakes_its_idle_stand() {
    for class in ["scout", "sniper", "soldier", "demo", "medic", "heavy", "pyro", "spy", "engineer"] {
        let Some(set) = load(class) else { return };
        let i = ["stand_primary", "stand_secondary"].iter().find_map(|n| set.find_sequence(n)).unwrap_or_else(|| panic!("{class}: no stand sequence"));
        let clip = set.bake(i, &set.default_pose_params());
        assert!(clip.frames > 1, "{class}");
        assert!(clip.pos.iter().chain(&clip.quat).all(|v| v.is_finite()), "{class}: non-finite pose");
        // Root height: the pelvis sits roughly 30..50 units above the floor (Z up).
        let names = set.bone_names();
        let pelvis = names.iter().position(|n| n == "bip_pelvis").unwrap();
        let z = clip.pos[pelvis * 3 + 2];
        assert!((25.0..55.0).contains(&z), "{class}: pelvis height {z}");
    }
}

#[test]
fn pose_parameters_change_the_blend() {
    let Some(set) = load("soldier") else { return };
    let i = set.find_sequence("PRIMARY_aimmatrix_idle").unwrap();
    let names: Vec<&str> = set.pose_params.iter().map(|p| p.name.as_str()).collect();
    let yaw = names.iter().position(|n| *n == "body_yaw").unwrap();
    let mut a = set.default_pose_params();
    let mut b = a.clone();
    a[yaw] = 0.0;
    b[yaw] = 1.0;
    let (pa, pb) = (set.evaluate(i, 0.0, &a), set.evaluate(i, 0.0, &b));
    let diff: f32 = pa.quat.iter().zip(&pb.quat).flat_map(|(x, y)| x.iter().zip(y).map(|(u, v)| (u - v).abs())).sum();
    assert!(diff > 1e-4, "body_yaw has no effect on the aim matrix (diff {diff})");
}

/// A taunt's first and last frames hold nothing of their own (all-zero bones, the body flat on the ground when played alone): the game
/// plays it as a layer over the weapon's stand pose, so the baked clip begins and ends in that pose and the loop is seamless.
#[test]
fn a_taunt_is_baked_over_the_stand_pose() {
    let Some(set) = load("scout") else { return };
    let taunt = set.find_sequence("taunt_laugh").unwrap();
    let stand = set.find_sequence("stand_primary").unwrap();
    assert_eq!(set.layer_base(taunt), Some(stand));
    assert_eq!(set.layer_base(stand), None);
    let params = set.default_pose_params();
    let clip = set.bake(taunt, &params);
    let nb = set.num_bones();
    let rest = set.evaluate(stand, 0.0, &params);
    let dist = |frame: usize| -> f32 {
        (0..nb).map(|b| (0..3).map(|k| (clip.pos[(frame * nb + b) * 3 + k] - rest.pos[b][k]).abs()).sum::<f32>()).sum()
    };
    assert!(dist(0) < 0.5, "first frame is the stand pose: {}", dist(0));
    assert!(dist(clip.frames - 1) < 2.0, "last frame is (all but) the stand pose: {}", dist(clip.frames - 1));
    assert!(dist(clip.frames / 2) > 5.0, "the middle is the taunt");
}

/// A sentry's `fire` is an additive sequence (the recoil of the gun): the game plays it as a gesture over the running sentry, so it is baked
/// over `idle_off`, not over the bind pose.
#[test]
fn a_sentry_fire_is_baked_over_its_running_sequence() {
    let Some(root) = steam::find_tf2() else { return };
    let vpk = VpkSet::open_folder(&root).unwrap();
    let Ok(set) = AnimSet::load(&vpk, "models/buildables/sentry1.mdl") else { return };
    let fire = set.find_sequence("fire").unwrap();
    let idle = set.find_sequence("idle_off").unwrap();
    assert_eq!(set.delta_base(fire), Some(idle));
    assert_eq!(set.delta_base(idle), None);
    let params = set.default_pose_params();
    let clip = set.bake(fire, &params);
    let nb = set.num_bones();
    let rest = set.evaluate(idle, 0.0, &params);
    // the recoil moves the muzzle by a couple of units; played alone the additive pose would be nowhere near the sentry
    let drift: f32 = (0..nb).map(|b| (0..3).map(|k| (clip.pos[b * 3 + k] - rest.pos[b][k]).abs()).sum::<f32>()).sum();
    assert!(drift < 5.0, "frame 0 stays the idle pose: {drift}");
}
