//! Skeletal animation: sequence evaluation ported from the Source SDK 2013
//! (`public/bone_setup.cpp`, `public/studio_virtualmodel.cpp`, `public/studio.cpp`).
//!
//! Covered: the virtual model built from `$includemodel` (sequences, animations, bones and
//! pose parameters are merged by name), animation decoding (RLE values, raw and compressed
//! quaternions/vectors, frame sections), pose-parameter blends including the 3-way triangle blend,
//! auto layers, delta / local sequences, world-space slerp and autoplay sequences.
//!
//! Not covered: IK rules and locks, bone controllers, procedural bones, zero-frame data, local
//! hierarchy overrides and external animation blocks (`.ani`). Player class models need none of
//! these for their stand/run/attack sequences.

use std::collections::HashMap;

use crate::{
    binary::{fail, ParseError, Result},
    vpk::VpkSet,
};

const BONE_FIXED_ALIGNMENT: i32 = 0x0010_0000;

pub const STUDIO_LOOPING: i32 = 0x0001;
pub const STUDIO_DELTA: i32 = 0x0004;
pub const STUDIO_POST: i32 = 0x0010;
pub const STUDIO_ALLZEROS: i32 = 0x0020;
pub const STUDIO_CYCLEPOSE: i32 = 0x0080;
pub const STUDIO_REALTIME: i32 = 0x0100;
pub const STUDIO_LOCAL: i32 = 0x0200;
pub const STUDIO_HIDDEN: i32 = 0x0400;
pub const STUDIO_OVERRIDE: i32 = 0x0800;
pub const STUDIO_WORLD: i32 = 0x4000;
const STUDIO_AUTOPLAY: i32 = 0x0008;

const STUDIO_AL_SPLINE: i32 = 0x0040;
const STUDIO_AL_XFADE: i32 = 0x0080;
const STUDIO_AL_NOBLEND: i32 = 0x0200;
const STUDIO_AL_LOCAL: i32 = 0x1000;
const STUDIO_AL_POSE: i32 = 0x4000;

const ANIM_RAWPOS: u8 = 0x01;
const ANIM_RAWROT: u8 = 0x02;
const ANIM_ANIMPOS: u8 = 0x04;
const ANIM_ANIMROT: u8 = 0x08;
const ANIM_DELTA: u8 = 0x10;
const ANIM_RAWROT2: u8 = 0x20;

const SIZEOF_BONE: usize = 216;
const SIZEOF_SEQDESC: usize = 212;
const SIZEOF_ANIMDESC: usize = 100;
const SIZEOF_POSEPARAM: usize = 20;
const SIZEOF_AUTOLAYER: usize = 24;
const SIZEOF_MODELGROUP: usize = 8;

type Quat = [f32; 4]; // x y z w
type Vec3 = [f32; 3];

// --- tiny bounds-tolerant readers (corrupt data yields zeros instead of a panic) ---

fn i32at(d: &[u8], o: usize) -> i32 {
    d.get(o..o + 4).map_or(0, |b| i32::from_le_bytes(b.try_into().unwrap()))
}
fn f32at(d: &[u8], o: usize) -> f32 {
    d.get(o..o + 4).map_or(0.0, |b| f32::from_le_bytes(b.try_into().unwrap()))
}
fn i16at(d: &[u8], o: usize) -> i16 {
    d.get(o..o + 2).map_or(0, |b| i16::from_le_bytes(b.try_into().unwrap()))
}
fn u16at(d: &[u8], o: usize) -> u16 {
    d.get(o..o + 2).map_or(0, |b| u16::from_le_bytes(b.try_into().unwrap()))
}
fn u8at(d: &[u8], o: usize) -> u8 {
    d.get(o).copied().unwrap_or(0)
}
fn cstr(d: &[u8], o: usize) -> String {
    let rest = d.get(o..).unwrap_or(&[]);
    let end = rest.iter().position(|&c| c == 0).unwrap_or(rest.len());
    String::from_utf8_lossy(&rest[..end]).into_owned()
}
/// `base + rel` for offsets stored in files.
fn rel(base: usize, off: i32) -> usize {
    base.wrapping_add_signed(off as isize)
}

// --- quaternion math (mathlib_base.cpp) ---

fn q_align(p: Quat, q: Quat) -> Quat {
    let (mut a, mut b) = (0.0, 0.0);
    for i in 0..4 {
        a += (p[i] - q[i]) * (p[i] - q[i]);
        b += (p[i] + q[i]) * (p[i] + q[i]);
    }
    if a > b {
        [-q[0], -q[1], -q[2], -q[3]]
    } else {
        q
    }
}

fn q_normalize(q: &mut Quat) {
    let r = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if r != 0.0 {
        let i = 1.0 / r.sqrt();
        for v in q.iter_mut() {
            *v *= i;
        }
    }
}

fn q_blend_no_align(p: Quat, q: Quat, t: f32) -> Quat {
    let (sp, sq) = (1.0 - t, t);
    let mut r = [0.0; 4];
    for i in 0..4 {
        r[i] = sp * p[i] + sq * q[i];
    }
    q_normalize(&mut r);
    r
}

fn q_blend(p: Quat, q: Quat, t: f32) -> Quat {
    q_blend_no_align(p, q_align(p, q), t)
}

fn q_slerp_no_align(p: Quat, q: Quat, t: f32) -> Quat {
    let cosom = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3];
    let mut r = [0.0; 4];
    if 1.0 + cosom > 0.000001 {
        let (sclp, sclq);
        if 1.0 - cosom > 0.000001 {
            let omega = cosom.acos();
            let sinom = omega.sin();
            sclp = ((1.0 - t) * omega).sin() / sinom;
            sclq = (t * omega).sin() / sinom;
        } else {
            sclp = 1.0 - t;
            sclq = t;
        }
        for i in 0..4 {
            r[i] = sclp * p[i] + sclq * q[i];
        }
    } else {
        r[0] = -q[1];
        r[1] = q[0];
        r[2] = -q[3];
        r[3] = q[2];
        let sclp = ((1.0 - t) * (0.5 * std::f32::consts::PI)).sin();
        let sclq = (t * (0.5 * std::f32::consts::PI)).sin();
        for i in 0..3 {
            r[i] = sclp * p[i] + sclq * r[i];
        }
    }
    r
}

fn q_slerp(p: Quat, q: Quat, t: f32) -> Quat {
    q_slerp_no_align(p, q_align(p, q), t)
}

fn q_mult(p: Quat, q: Quat) -> Quat {
    let q2 = q_align(p, q);
    [
        p[0] * q2[3] + p[1] * q2[2] - p[2] * q2[1] + p[3] * q2[0],
        -p[0] * q2[2] + p[1] * q2[3] + p[2] * q2[0] + p[3] * q2[1],
        p[0] * q2[1] - p[1] * q2[0] + p[2] * q2[3] + p[3] * q2[2],
        -p[0] * q2[0] - p[1] * q2[1] - p[2] * q2[2] + p[3] * q2[3],
    ]
}

fn q_scale(p: Quat, t: f32) -> Quat {
    let sinom = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt().min(1.0);
    let sinsom = (sinom.asin() * t).sin();
    let k = sinsom / (sinom + f32::EPSILON);
    let r = (1.0 - sinsom * sinsom).max(0.0).sqrt();
    [p[0] * k, p[1] * k, p[2] * k, if p[3] < 0.0 { -r } else { r }]
}

/// qt = (s * p) * q
fn q_sm(s: f32, p: Quat, q: Quat) -> Quat {
    let mut r = q_mult(q_scale(p, s), q);
    q_normalize(&mut r);
    r
}

/// qt = p * (s * q)
fn q_ma(p: Quat, s: f32, q: Quat) -> Quat {
    let mut r = q_mult(p, q_scale(q, s));
    q_normalize(&mut r);
    r
}

fn q_identity_blend(p: Quat, t: f32) -> Quat {
    let sclp = 1.0 - t;
    let mut r = [p[0] * sclp, p[1] * sclp, p[2] * sclp, if p[3] < 0.0 { p[3] * sclp - t } else { p[3] * sclp + t }];
    q_normalize(&mut r);
    r
}

/// `AngleQuaternion(RadianEuler)`.
fn angle_quaternion(a: Vec3) -> Quat {
    let (sy, cy) = (a[2] * 0.5).sin_cos();
    let (sp, cp) = (a[1] * 0.5).sin_cos();
    let (sr, cr) = (a[0] * 0.5).sin_cos();
    let (srxcp, crxsp) = (sr * cp, cr * sp);
    let (crxcp, srxsp) = (cr * cp, sr * sp);
    [srxcp * cy - crxsp * sy, crxsp * cy + srxcp * sy, crxcp * sy - srxsp * cy, crxcp * cy + srxsp * sy]
}

fn half_to_f32(h: u16) -> f32 {
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = ((h >> 10) & 0x1f) as i32;
    let man = (h & 0x3ff) as f32;
    match exp {
        0 => sign * man * 2f32.powi(-24),
        31 => {
            if man == 0.0 {
                sign * f32::INFINITY
            } else {
                f32::NAN
            }
        }
        _ => sign * (1.0 + man / 1024.0) * 2f32.powi(exp - 15),
    }
}

fn quat48(d: &[u8], o: usize) -> Quat {
    let x = u16at(d, o) as i32;
    let y = u16at(d, o + 2) as i32;
    let zw = u16at(d, o + 4);
    let z = (zw & 0x7fff) as i32;
    let wneg = zw & 0x8000 != 0;
    let (qx, qy, qz) = ((x - 32768) as f32 * (1.0 / 32768.0), (y - 32768) as f32 * (1.0 / 32768.0), (z - 16384) as f32 * (1.0 / 16384.0));
    let w = (1.0 - qx * qx - qy * qy - qz * qz).max(0.0).sqrt();
    [qx, qy, qz, if wneg { -w } else { w }]
}

fn quat64(d: &[u8], o: usize) -> Quat {
    let v = d.get(o..o + 8).map_or(0u64, |b| u64::from_le_bytes(b.try_into().unwrap()));
    let x = (v & 0x1f_ffff) as i64;
    let y = ((v >> 21) & 0x1f_ffff) as i64;
    let z = ((v >> 42) & 0x1f_ffff) as i64;
    let wneg = (v >> 63) & 1 != 0;
    let f = |c: i64| (c - 1_048_576) as f32 * (1.0 / 1_048_576.5);
    let (qx, qy, qz) = (f(x), f(y), f(z));
    let w = (1.0 - qx * qx - qy * qy - qz * qz).max(0.0).sqrt();
    [qx, qy, qz, if wneg { -w } else { w }]
}

fn vec48(d: &[u8], o: usize) -> Vec3 {
    [half_to_f32(u16at(d, o)), half_to_f32(u16at(d, o + 2)), half_to_f32(u16at(d, o + 4))]
}

// --- model groups (virtual model) ---

#[derive(Debug, Clone)]
struct Bone {
    name: String,
    parent: i32,
    pos: Vec3,
    quat: Quat,
    rot: Vec3,
    posscale: Vec3,
    rotscale: Vec3,
    flags: i32,
    qalign: Quat,
}

#[derive(Debug, Clone)]
pub struct PoseParam {
    pub name: String,
    pub flags: i32,
    pub start: f32,
    pub end: f32,
    /// Looping range (360 for rotations), 0 for none.
    pub looping: f32,
}

struct Group {
    data: Vec<u8>,
    bones: Vec<Bone>,
    num_local_seq: usize,
    seq_index: usize,
    num_local_anim: usize,
    anim_index: usize,
    num_local_pose: usize,
    pose_index: usize,
    /// master bone -> this group's bone (or -1)
    bone_map: Vec<i32>,
    /// this group's bone -> master bone (or -1)
    master_bone: Vec<i32>,
    master_seq: Vec<usize>,
    master_anim: Vec<usize>,
    master_pose: Vec<usize>,
}

impl Group {
    fn seq_base(&self, i: usize) -> usize {
        self.seq_index + i * SIZEOF_SEQDESC
    }
    fn anim_base(&self, i: usize) -> usize {
        self.anim_index + i * SIZEOF_ANIMDESC
    }
    fn seq_name(&self, i: usize) -> String {
        let b = self.seq_base(i);
        cstr(&self.data, rel(b, i32at(&self.data, b + 4)))
    }
    fn anim_name(&self, i: usize) -> String {
        let b = self.anim_base(i);
        cstr(&self.data, rel(b, i32at(&self.data, b + 4)))
    }
    fn seq_flags(&self, i: usize) -> i32 {
        i32at(&self.data, self.seq_base(i) + 12)
    }
}

fn parse_group_header(data: Vec<u8>) -> Result<(Group, Vec<String>)> {
    if data.get(0..4) != Some(b"IDST") {
        return fail("not an MDL (missing IDST)");
    }
    let version = i32at(&data, 4);
    if version != 48 {
        return fail(format!("unsupported MDL version {version}"));
    }
    let num_bones = i32at(&data, 156).clamp(0, 1024) as usize;
    let bone_index = i32at(&data, 160) as usize;
    let mut bones = Vec::with_capacity(num_bones);
    for i in 0..num_bones {
        let b = bone_index + i * SIZEOF_BONE;
        let v3 = |o: usize| [f32at(&data, b + o), f32at(&data, b + o + 4), f32at(&data, b + o + 8)];
        bones.push(Bone {
            name: cstr(&data, rel(b, i32at(&data, b))),
            parent: i32at(&data, b + 4),
            pos: v3(32),
            quat: [f32at(&data, b + 44), f32at(&data, b + 48), f32at(&data, b + 52), f32at(&data, b + 56)],
            rot: v3(60),
            posscale: v3(72),
            rotscale: v3(84),
            qalign: [f32at(&data, b + 144), f32at(&data, b + 148), f32at(&data, b + 152), f32at(&data, b + 156)],
            flags: i32at(&data, b + 160),
        });
    }
    let num_include = i32at(&data, 336).clamp(0, 256) as usize;
    let include_index = i32at(&data, 340) as usize;
    let includes = (0..num_include)
        .map(|i| {
            let b = include_index + i * SIZEOF_MODELGROUP;
            cstr(&data, rel(b, i32at(&data, b + 4)))
        })
        .collect();
    let group = Group {
        num_local_seq: i32at(&data, 188).max(0) as usize,
        seq_index: i32at(&data, 192) as usize,
        num_local_anim: i32at(&data, 180).max(0) as usize,
        anim_index: i32at(&data, 184) as usize,
        num_local_pose: i32at(&data, 300).max(0) as usize,
        pose_index: i32at(&data, 304) as usize,
        data,
        bones,
        bone_map: Vec::new(),
        master_bone: Vec::new(),
        master_seq: Vec::new(),
        master_anim: Vec::new(),
        master_pose: Vec::new(),
    };
    Ok((group, includes))
}

/// An animatable model: the main MDL plus everything it `$includemodel`s, merged like the
/// engine's `virtualmodel_t`.
pub struct AnimSet {
    groups: Vec<Group>,
    /// master sequence -> (group, local index)
    seqs: Vec<(usize, usize)>,
    anims: Vec<(usize, usize)>,
    poses: Vec<(usize, usize)>,
    pub pose_params: Vec<PoseParam>,
    autoplay: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct SeqInfo {
    pub index: usize,
    pub name: String,
    pub flags: i32,
    pub looping: bool,
    pub hidden: bool,
    /// Number of frames of the (first) animation, for display.
    pub frames: i32,
    pub fps: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub fps: f32,
    /// Highest frame number (frames - 1).
    pub max_frame: i32,
    pub cycles_per_second: f32,
    pub duration: f32,
}

/// Local-space pose of every master bone.
#[derive(Debug, Clone)]
pub struct Pose {
    pub pos: Vec<Vec3>,
    pub quat: Vec<Quat>,
}

/// Baked animation: local bone transforms for each frame, sampled at the sequence frame rate.
#[derive(Debug, Clone)]
pub struct Clip {
    pub fps: f32,
    pub looping: bool,
    pub frames: usize,
    pub num_bones: usize,
    /// `frames * num_bones * 3`
    pub pos: Vec<f32>,
    /// `frames * num_bones * 4` (x y z w)
    pub quat: Vec<f32>,
}

impl AnimSet {
    /// Loads `mdl_path` and its (recursive) `$includemodel` files from the VPKs.
    pub fn load(vpk: &VpkSet, mdl_path: &str) -> Result<AnimSet> {
        let mut set = AnimSet {
            groups: Vec::new(),
            seqs: Vec::new(),
            anims: Vec::new(),
            poses: Vec::new(),
            pose_params: Vec::new(),
            autoplay: Vec::new(),
        };
        let data = vpk.read(mdl_path).map_err(|e| ParseError(e.to_string()))?;
        set.add_group(vpk, data, true)?;
        for (i, _) in set.seqs.iter().enumerate() {
            let (g, l) = set.seqs[i];
            if set.groups[g].seq_flags(l) & STUDIO_AUTOPLAY != 0 {
                set.autoplay.push(i);
            }
        }
        Ok(set)
    }

    fn add_group(&mut self, vpk: &VpkSet, data: Vec<u8>, is_root: bool) -> Result<()> {
        let (group, includes) = parse_group_header(data)?;
        let gi = self.groups.len();
        self.groups.push(group);
        self.append_sequences(gi);
        self.append_animations(gi);
        self.append_bonemap(gi, is_root);
        self.append_pose_params(gi);
        for inc in includes {
            let path = inc.replace('\\', "/");
            let Ok(bytes) = vpk.read(&path) else { continue };
            // Unreadable includes are skipped like missing models in the engine.
            if self.add_group(vpk, bytes, false).is_err() {
                continue;
            }
        }
        Ok(())
    }

    fn append_sequences(&mut self, gi: usize) {
        let num_check = self.seqs.len();
        let mut index: HashMap<String, usize> = HashMap::new();
        for (k, &(g, l)) in self.seqs.iter().enumerate() {
            index.entry(self.groups[g].seq_name(l).to_ascii_lowercase()).or_insert(k);
        }
        let n = self.groups[gi].num_local_seq;
        let mut master = Vec::with_capacity(n);
        for j in 0..n {
            let name = self.groups[gi].seq_name(j).to_ascii_lowercase();
            let found = index.get(&name).copied().filter(|&k| k < num_check);
            let k = match found {
                None => {
                    self.seqs.push((gi, j));
                    self.seqs.len() - 1
                }
                Some(k) => {
                    let (g, l) = self.seqs[k];
                    if self.groups[g].seq_flags(l) & STUDIO_OVERRIDE != 0 {
                        // a forward declared (empty) sequence is replaced by the real one
                        self.seqs[k] = (gi, j);
                    }
                    k
                }
            };
            master.push(k);
        }
        self.groups[gi].master_seq = master;
    }

    fn append_animations(&mut self, gi: usize) {
        let num_check = self.anims.len();
        let mut index: HashMap<String, usize> = HashMap::new();
        for (k, &(g, l)) in self.anims.iter().enumerate() {
            index.entry(self.groups[g].anim_name(l).to_ascii_lowercase()).or_insert(k);
        }
        let n = self.groups[gi].num_local_anim;
        let mut master = Vec::with_capacity(n);
        for j in 0..n {
            let name = self.groups[gi].anim_name(j).to_ascii_lowercase();
            let k = match index.get(&name).copied().filter(|&k| k < num_check) {
                Some(k) => k,
                None => {
                    self.anims.push((gi, j));
                    self.anims.len() - 1
                }
            };
            master.push(k);
        }
        self.groups[gi].master_anim = master;
    }

    fn append_bonemap(&mut self, gi: usize, is_root: bool) {
        let base_count = self.groups[0].bones.len();
        let n = self.groups[gi].bones.len();
        if is_root {
            let g = &mut self.groups[gi];
            g.bone_map = (0..n as i32).collect();
            g.master_bone = (0..n as i32).collect();
            return;
        }
        let base_names: Vec<String> = self.groups[0].bones.iter().map(|b| b.name.to_ascii_lowercase()).collect();
        let mut bone_map = vec![-1i32; base_count];
        let mut master_bone = vec![-1i32; n];
        for j in 0..n {
            let name = self.groups[gi].bones[j].name.to_ascii_lowercase();
            if let Some(k) = base_names.iter().position(|b| *b == name) {
                master_bone[j] = k as i32;
                bone_map[k] = j as i32;
            }
        }
        let g = &mut self.groups[gi];
        g.bone_map = bone_map;
        g.master_bone = master_bone;
    }

    fn append_pose_params(&mut self, gi: usize) {
        let num_check = self.poses.len();
        let n = self.groups[gi].num_local_pose;
        let mut master = Vec::with_capacity(n);
        for j in 0..n {
            let b = self.groups[gi].pose_index + j * SIZEOF_POSEPARAM;
            let d = &self.groups[gi].data;
            let pp = PoseParam {
                name: cstr(d, rel(b, i32at(d, b))),
                flags: i32at(d, b + 4),
                start: f32at(d, b + 8),
                end: f32at(d, b + 12),
                looping: f32at(d, b + 16),
            };
            let found = self.pose_params[..num_check.min(self.pose_params.len())]
                .iter()
                .position(|p| p.name.eq_ignore_ascii_case(&pp.name));
            let k = match found {
                Some(k) => {
                    // duplicate: widen the range to fit both
                    let p = &mut self.pose_params[k];
                    let start = p.end.min(pp.end).min(p.start).min(pp.start);
                    let end = p.end.max(pp.end).max(p.start).max(pp.start);
                    p.start = start;
                    p.end = end;
                    k
                }
                None => {
                    self.poses.push((gi, j));
                    self.pose_params.push(pp);
                    self.pose_params.len() - 1
                }
            };
            master.push(k);
        }
        self.groups[gi].master_pose = master;
    }

    // ---------------------------------------------------------------- queries

    pub fn num_bones(&self) -> usize {
        self.groups[0].bones.len()
    }

    pub fn num_sequences(&self) -> usize {
        self.seqs.len()
    }

    pub fn bone_names(&self) -> Vec<String> {
        self.groups[0].bones.iter().map(|b| b.name.clone()).collect()
    }

    /// The local rotation of every bone in the model's own bind pose (x y z w).
    pub fn bind_local_quats(&self) -> Vec<[f32; 4]> {
        self.groups[0].bones.iter().map(|b| b.quat).collect()
    }

    pub fn bone_parents(&self) -> Vec<i32> {
        self.groups[0].bones.iter().map(|b| b.parent).collect()
    }

    /// Gives the left arm of `pose` (everything below the collar bone) the orientation it has in `from`, in model space, keeping its own
    /// shoulder: a gesture's arm animation is authored over the standing pose, so a crouching character takes the arm's world pose
    /// from a standing one and the arm points where it does when standing instead of following the crouched shoulder down.
    pub fn copy_left_arm(&self, pose: &mut Pose, from: &Pose) {
        let names = self.bone_names();
        let parents = self.bone_parents();
        let Some(root) = names.iter().position(|n| n.eq_ignore_ascii_case("bip_collar_L")) else {
            return;
        };
        let target = world_transforms(&parents, from).1;
        let mut world = world_transforms(&parents, pose).1;
        for i in 0..parents.len() {
            let mut p = i as i32;
            while p >= 0 && p as usize != root {
                p = parents[p as usize];
            }
            if p < 0 || i == root {
                continue;
            }
            let parent = parents[i] as usize;
            pose.quat[i] = q_mul(q_conj(world[parent]), target[i]);
            world[i] = target[i];
        }
    }

    /// Model-space positions of every bone for a local pose.
    pub fn world_positions(&self, pose: &Pose) -> Vec<[f32; 3]> {
        world_transforms(&self.bone_parents(), pose).0
    }

    /// Plants the feet like the game's foot IK: both legs of `pose` are bent (two-bone IK about their current knee direction) so
    /// that each foot stands where it does in `base` (a pose of the same movement without the aim), with the foot flat as in
    /// `base`. Leg bones are found by name (`bip_hip_L`, `bip_knee_L`, `bip_foot_L` and the right side); other skeletons are left alone.
    pub fn plant_feet(&self, pose: &mut Pose, base: &Pose) {
        let names = self.bone_names();
        let parents = self.bone_parents();
        let find = |n: &str| names.iter().position(|x| x.eq_ignore_ascii_case(n));
        let base_world = world_transforms(&parents, base);
        for side in ["L", "R"] {
            let (Some(h), Some(k), Some(f)) = (find(&format!("bip_hip_{side}")), find(&format!("bip_knee_{side}")), find(&format!("bip_foot_{side}"))) else {
                continue;
            };
            let target = base_world.0[f];
            // hip
            let w = world_transforms(&parents, pose);
            let (ap, bp, cp) = (w.0[h], w.0[k], w.0[f]);
            let l1 = v_len(v_sub(bp, ap));
            let l2 = v_len(v_sub(cp, bp));
            let to_target = v_sub(target, ap);
            let raw = v_len(to_target);
            if raw < 1e-4 || l1 < 1e-4 || l2 < 1e-4 {
                continue;
            }
            let dist = raw.clamp((l1 - l2).abs() + 1e-3, l1 + l2 - 1e-3);
            let u = v_scale(to_target, 1.0 / raw);
            let knee = v_sub(bp, ap);
            let mut bend = v_sub(knee, v_scale(u, v_dot(knee, u)));
            let bl = v_len(bend);
            if bl < 1e-5 {
                continue;
            }
            bend = v_scale(bend, 1.0 / bl);
            let cos_a = ((l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist)).clamp(-1.0, 1.0);
            let sin_a = (1.0 - cos_a * cos_a).sqrt();
            let mid = v_add(ap, v_add(v_scale(u, l1 * cos_a), v_scale(bend, l1 * sin_a)));
            let end = v_add(ap, v_scale(u, dist));
            // turn the hip so the knee reaches its new place
            let turn = q_between(v_sub(bp, ap), v_sub(mid, ap));
            turn_bone(pose, &parents, h, turn);
            // then the knee so the ankle reaches the end point
            let w = world_transforms(&parents, pose);
            let turn = q_between(v_sub(w.0[f], w.0[k]), v_sub(end, w.0[k]));
            turn_bone(pose, &parents, k, turn);
            // the foot keeps its flat orientation from the base pose
            let w = world_transforms(&parents, pose);
            pose.quat[f] = q_mul(q_conj(w.1[k]), base_world.1[f]);
        }
    }

    pub fn find_sequence(&self, name: &str) -> Option<usize> {
        (0..self.seqs.len()).find(|&i| self.seq_name(i).eq_ignore_ascii_case(name))
    }

    pub fn seq_name(&self, seq: usize) -> String {
        let (g, l) = self.seqs[seq];
        self.groups[g].seq_name(l)
    }

    /// Authored activity name; numeric activity IDs are assigned by the game DLL at load time.
    pub fn activity_name(&self, seq: usize) -> String {
        let (g, l) = self.seqs[seq]; let grp = &self.groups[g]; let base = grp.seq_base(l);
        cstr(&grp.data, rel(base, i32at(&grp.data, base + 8)))
    }

    /// Every animation event of a sequence as (seconds after its start, event number, authored name).
    pub fn events(&self, seq: usize) -> Vec<(f32, i32, String)> {
        let (g,l) = self.seqs[seq]; let grp = &self.groups[g]; let base = grp.seq_base(l);
        let info = &self.sequences()[seq];
        let duration = if info.fps > 0.0 { info.frames.saturating_sub(1) as f32 / info.fps } else { 0.0 };
        let count = i32at(&grp.data, base+24).clamp(0,128) as usize;
        let start = rel(base,i32at(&grp.data,base+28));
        (0..count).map(|i| { let e = start+i*80;
            (f32at(&grp.data,e)*duration, i32at(&grp.data,e+4), cstr(&grp.data,rel(e,i32at(&grp.data,e+76)))) }).collect()
    }

    /// Shell-ejection events in an authored viewmodel sequence (seconds after firing).
    pub fn brass_events(&self, seq: usize) -> Vec<f32> {
        let (g,l) = self.seqs[seq]; let grp = &self.groups[g]; let base = grp.seq_base(l);
        let info = &self.sequences()[seq];
        let duration = if info.fps > 0.0 { info.frames.saturating_sub(1) as f32 / info.fps } else { 0.0 };
        let count = i32at(&grp.data, base+24).clamp(0,128) as usize;
        let start = rel(base,i32at(&grp.data,base+28));
        (0..count).filter_map(|i| { let e = start+i*80; let event = i32at(&grp.data,e+4);
            let name = cstr(&grp.data,rel(e,i32at(&grp.data,e+76)));
            (event == 6002 || name == "AE_WPN_EJECTBRASS").then(|| f32at(&grp.data,e)*duration)
        }).collect()
    }

    pub fn sequences(&self) -> Vec<SeqInfo> {
        (0..self.seqs.len())
            .map(|i| {
                let (g, l) = self.seqs[i];
                let grp = &self.groups[g];
                let flags = grp.seq_flags(l);
                let sb = Seq { grp, base: grp.seq_base(l) };
                let a0 = self.anim_desc(g, sb.anim(0, 0));
                SeqInfo {
                    index: i,
                    name: grp.seq_name(l),
                    flags,
                    looping: flags & STUDIO_LOOPING != 0,
                    hidden: flags & STUDIO_HIDDEN != 0,
                    frames: a0.map_or(0, |a| a.numframes()),
                    fps: a0.map_or(0.0, |a| a.fps()),
                }
            })
            .collect()
    }

    /// `Studio_CalcDefaultPoseParameters`: the zero state when the range spans zero, else the middle.
    pub fn default_pose_params(&self) -> Vec<f32> {
        self.pose_params
            .iter()
            .map(|p| {
                if p.start < 0.0 && p.end > 0.0 {
                    -p.start / (p.end - p.start)
                } else {
                    0.5
                }
            })
            .collect()
    }

    /// All pose parameters at their lowest encoded value (0). This is what hlmv's zero-initialised
    /// parameter array starts at.
    pub fn zero_pose_params(&self) -> Vec<f32> {
        vec![0.0; self.pose_params.len()]
    }

    fn seq_view(&self, seq: usize) -> (usize, Seq<'_>) {
        let (g, l) = self.seqs[seq];
        let grp = &self.groups[g];
        (g, Seq { grp, base: grp.seq_base(l) })
    }

    /// Anim desc for a group-local animation index of the sequence's group (`iRelativeAnim` + `pAnimdesc`).
    fn anim_for_seq(&self, group: usize, local_anim: i32) -> Option<AnimDesc<'_>> {
        let master = *self.groups[group].master_anim.get(usize::try_from(local_anim).ok()?)?;
        let (ag, al) = *self.anims.get(master)?;
        let grp = &self.groups[ag];
        Some(AnimDesc { grp, base: grp.anim_base(al), group: ag })
    }

    fn anim_desc(&self, group: usize, local_anim: i32) -> Option<AnimDesc<'_>> {
        self.anim_for_seq(group, local_anim)
    }

    /// `Studio_LocalPoseParameter`: blend setting (0..1) and cell index for blend axis `axis`.
    fn local_pose_param(&self, group: usize, seq: &Seq, axis: usize, params: &[f32]) -> (f32, i32) {
        let local_pose = seq.paramindex(axis);
        if local_pose == -1 {
            return (0.0, 0);
        }
        let Some(&ipose) = self.groups[group].master_pose.get(local_pose as usize) else { return (0.0, 0) };
        let pose = &self.pose_params[ipose];
        let mut value = params.get(ipose).copied().unwrap_or(0.0);

        if pose.looping != 0.0 {
            let wrap = (pose.start + pose.end) / 2.0 + pose.looping / 2.0;
            let shift = pose.looping - wrap;
            value -= pose.looping * ((value + shift) / pose.looping).floor();
        }

        let gs = seq.groupsize(axis);
        let (mut setting, mut index);
        if seq.posekeyindex() == 0 {
            let local_start = (seq.paramstart(axis) - pose.start) / (pose.end - pose.start);
            let local_end = (seq.paramend(axis) - pose.start) / (pose.end - pose.start);
            setting = (value - local_start) / (local_end - local_start);
            setting = setting.clamp(0.0, 1.0);
            index = 0;
            if gs > 2 {
                index = (setting * (gs - 1) as f32) as i32;
                if index == gs - 1 {
                    index = gs - 2;
                }
                setting = setting * (gs - 1) as f32 - index as f32;
            }
        } else {
            value = value * (pose.end - pose.start) + pose.start;
            index = 0;
            loop {
                let k0 = seq.pose_key(axis, index);
                let k1 = seq.pose_key(axis, index + 1);
                setting = (value - k0) / (k1 - k0);
                if index < gs - 2 && setting > 1.0 {
                    index += 1;
                    continue;
                }
                break;
            }
            setting = setting.clamp(0.0, 1.0);
        }
        (setting, index)
    }

    /// Up to four anims with weights (`Studio_SeqAnims`).
    fn seq_anims(&self, seq: usize, params: &[f32]) -> Vec<(AnimDesc<'_>, f32)> {
        let (g, sv) = self.seq_view(seq);
        let (s0, i0) = self.local_pose_param(g, &sv, 0, params);
        let (s1, i1) = self.local_pose_param(g, &sv, 1, params);
        let cells = [
            (sv.anim(i0, i1), (1.0 - s0) * (1.0 - s1)),
            (sv.anim(i0 + 1, i1), s0 * (1.0 - s1)),
            (sv.anim(i0, i1 + 1), (1.0 - s0) * s1),
            (sv.anim(i0 + 1, i1 + 1), s0 * s1),
        ];
        cells.into_iter().filter_map(|(a, w)| self.anim_for_seq(g, a).map(|ad| (ad, w))).collect()
    }

    pub fn timing(&self, seq: usize, params: &[f32]) -> Timing {
        let anims = self.seq_anims(seq, params);
        let mut max_frame = 0.0f32;
        let mut fps = 0.0f32;
        let mut cps = 0.0f32;
        for (a, w) in &anims {
            if *w > 0.0 {
                max_frame += a.numframes() as f32 * w;
                fps += a.fps() * w;
                if a.numframes() > 1 {
                    cps += a.fps() / (a.numframes() - 1) as f32 * w;
                }
            }
        }
        if max_frame > 1.0 {
            max_frame -= 1.0;
        }
        Timing {
            fps,
            max_frame: (max_frame + 0.01) as i32,
            cycles_per_second: cps,
            duration: if cps == 0.0 { 0.0 } else { 1.0 / cps },
        }
    }

    // ---------------------------------------------------------------- evaluation

    fn init_pose(&self) -> Pose {
        let bones = &self.groups[0].bones;
        Pose { pos: bones.iter().map(|b| b.pos).collect(), quat: bones.iter().map(|b| b.quat).collect() }
    }

    /// `CBoneSetup::InitPose` + `AccumulatePose(seq, cycle, 1)` + autoplay sequences, which is
    /// how hlmv builds a pose (`StudioModel::SetUpBones`) without IK, layers or head turn.
    pub fn evaluate(&self, seq: usize, cycle: f32, params: &[f32]) -> Pose {
        let mut pose = self.init_pose();
        self.accumulate_pose(&mut pose, seq as i32, cycle, 1.0, params);
        for &a in &self.autoplay {
            let (_, sv) = self.seq_view(a);
            if sv.flags() & STUDIO_AUTOPLAY != 0 {
                // cycle at real time 0
                self.accumulate_pose(&mut pose, a as i32, 0.0, 1.0, params);
            }
        }
        pose
    }

    /// `evaluate` with more sequences accumulated on top (`layers`: sequence, cycle, weight, in order): how additive (delta)
    /// sequences such as the jump landing, an attack or a gesture are played over the pose of the movement underneath.
    pub fn evaluate_layered(&self, seq: usize, cycle: f32, layers: &[(usize, f32, f32)], params: &[f32]) -> Pose {
        let mut pose = self.evaluate(seq, cycle, params);
        for &(s, c, w) in layers {
            self.accumulate_pose(&mut pose, s as i32, c, w, params);
        }
        pose
    }

    fn accumulate_pose(&self, pose: &mut Pose, seq: i32, cycle: f32, weight: f32, params: &[f32]) {
        if seq < 0 || seq as usize >= self.seqs.len() {
            return;
        }
        let seq = seq as usize;
        let weight = weight.clamp(0.0, 1.0);
        let (g, sv) = self.seq_view(seq);
        let nb = self.num_bones();

        let mut pose2 = Pose { pos: vec![[0.0; 3]; nb], quat: vec![[0.0, 0.0, 0.0, 1.0]; nb] };
        if sv.flags() & STUDIO_LOCAL != 0 {
            pose2 = self.init_pose();
        }
        if self.calc_pose_single(&mut pose2, seq, cycle, params) {
            self.add_local_layers(&mut pose2, seq, cycle, 1.0, params);
            self.slerp_bones(pose, &pose2, g, &sv, weight);
        }
        self.add_sequence_layers(pose, seq, cycle, weight, params);
    }

    fn add_sequence_layers(&self, pose: &mut Pose, seq: usize, cycle: f32, weight: f32, params: &[f32]) {
        let (g, sv) = self.seq_view(seq);
        for i in 0..sv.num_autolayers() {
            let layer = sv.autolayer(i);
            if layer.flags & STUDIO_AL_LOCAL != 0 {
                continue;
            }
            let mut layer_cycle = cycle;
            let mut layer_weight = weight;
            if layer.start != layer.end {
                let mut s = 1.0f32;
                let index;
                if layer.flags & STUDIO_AL_POSE == 0 {
                    index = cycle;
                } else {
                    let target = self.groups[g].master_seq.get(layer.seq as usize).copied();
                    let ipose = target.and_then(|t| {
                        let (tg, _) = self.seq_view(t);
                        self.groups[tg].master_pose.get(layer.pose as usize).copied()
                    });
                    index = match ipose {
                        Some(ip) => {
                            let p = &self.pose_params[ip];
                            params.get(ip).copied().unwrap_or(0.0) * (p.end - p.start) + p.start
                        }
                        None => 0.0,
                    };
                }
                if index < layer.start || index >= layer.end {
                    continue;
                }
                if index < layer.peak && layer.start != layer.peak {
                    s = (index - layer.start) / (layer.peak - layer.start);
                } else if index > layer.tail && layer.end != layer.tail {
                    s = (layer.end - index) / (layer.end - layer.tail);
                }
                if layer.flags & STUDIO_AL_SPLINE != 0 {
                    s = 3.0 * s * s - 2.0 * s * s * s;
                }
                layer_weight = if layer.flags & STUDIO_AL_XFADE != 0 && index > layer.tail {
                    (s * weight) / (1.0 - weight + s * weight)
                } else if layer.flags & STUDIO_AL_NOBLEND != 0 {
                    s
                } else {
                    weight * s
                };
                if layer.flags & STUDIO_AL_POSE == 0 {
                    layer_cycle = (cycle - layer.start) / (layer.end - layer.start);
                }
            }
            let target = self.groups[g].master_seq.get(layer.seq as usize).copied();
            if let Some(t) = target {
                self.accumulate_pose(pose, t as i32, layer_cycle, layer_weight, params);
            }
        }
    }

    fn add_local_layers(&self, pose: &mut Pose, seq: usize, cycle: f32, weight: f32, params: &[f32]) {
        let (g, sv) = self.seq_view(seq);
        if sv.flags() & STUDIO_LOCAL == 0 {
            return;
        }
        for i in 0..sv.num_autolayers() {
            let layer = sv.autolayer(i);
            if layer.flags & STUDIO_AL_LOCAL == 0 {
                continue;
            }
            let mut layer_cycle = cycle;
            let mut layer_weight = weight;
            if layer.start != layer.end {
                let mut s = 1.0f32;
                if cycle < layer.start || cycle >= layer.end {
                    continue;
                }
                if cycle < layer.peak && layer.start != layer.peak {
                    s = (cycle - layer.start) / (layer.peak - layer.start);
                } else if cycle > layer.tail && layer.end != layer.tail {
                    s = (layer.end - cycle) / (layer.end - layer.tail);
                }
                if layer.flags & STUDIO_AL_SPLINE != 0 {
                    s = 3.0 * s * s - 2.0 * s * s * s;
                }
                layer_weight = if layer.flags & STUDIO_AL_XFADE != 0 && cycle > layer.tail {
                    (s * weight) / (1.0 - weight + s * weight)
                } else if layer.flags & STUDIO_AL_NOBLEND != 0 {
                    s
                } else {
                    weight * s
                };
                layer_cycle = (cycle - layer.start) / (layer.end - layer.start);
            }
            if let Some(&t) = self.groups[g].master_seq.get(layer.seq as usize) {
                self.accumulate_pose(pose, t as i32, layer_cycle, layer_weight, params);
            }
        }
    }

    /// `CalcPoseSingle`. Returns false when the pose is a "zero" blend that should be skipped.
    fn calc_pose_single(&self, pose: &mut Pose, seq: usize, mut cycle: f32, params: &[f32]) -> bool {
        let (g, sv) = self.seq_view(seq);
        let nb = self.num_bones();
        let (s0, i0) = self.local_pose_param(g, &sv, 0, params);
        let (s1, i1) = self.local_pose_param(g, &sv, 1, params);
        let flags = sv.flags();

        if flags & STUDIO_REALTIME != 0 {
            cycle = 0.0; // driven by a real-time clock, which is fixed at 0 here
        } else if flags & STUDIO_CYCLEPOSE != 0 {
            let local = sv.cycleposeindex();
            cycle = if local >= 0 {
                self.groups[g].master_pose.get(local as usize).and_then(|&ip| params.get(ip)).copied().unwrap_or(0.0)
            } else {
                0.0
            };
        } else if !(0.0..1.0).contains(&cycle) {
            if flags & STUDIO_LOOPING != 0 {
                cycle -= cycle.trunc();
                if cycle < 0.0 {
                    cycle += 1.0;
                }
            } else {
                cycle = cycle.clamp(0.0, 1.0);
            }
        }

        let all_zeros = |x: i32, y: i32| -> bool {
            self.anim_for_seq(g, sv.anim(x, y)).is_some_and(|a| a.flags() & STUDIO_ALLZEROS != 0)
        };
        let calc = |pose: &mut Pose, a: i32| self.calc_animation(pose, seq, a, cycle, nb);
        let blend = |a: &mut Pose, b: &Pose, s: f32| self.blend_bones(a, b, g, &sv, s);
        let mk = || Pose { pos: vec![[0.0; 3]; nb], quat: vec![[0.0, 0.0, 0.0, 1.0]; nb] };

        if s0 < 0.001 {
            if s1 < 0.001 {
                if all_zeros(i0, i1) {
                    return false;
                }
                calc(pose, sv.anim(i0, i1));
            } else if s1 > 0.999 {
                calc(pose, sv.anim(i0, i1 + 1));
            } else {
                let mut p2 = mk();
                calc(pose, sv.anim(i0, i1));
                calc(&mut p2, sv.anim(i0, i1 + 1));
                blend(pose, &p2, s1);
            }
        } else if s0 > 0.999 {
            if s1 < 0.001 {
                if all_zeros(i0 + 1, i1) {
                    return false;
                }
                calc(pose, sv.anim(i0 + 1, i1));
            } else if s1 > 0.999 {
                calc(pose, sv.anim(i0 + 1, i1 + 1));
            } else {
                let mut p2 = mk();
                calc(pose, sv.anim(i0 + 1, i1));
                calc(&mut p2, sv.anim(i0 + 1, i1 + 1));
                blend(pose, &p2, s1);
            }
        } else if s1 < 0.001 {
            if all_zeros(i0 + 1, i1) {
                calc(pose, sv.anim(i0, i1));
                self.scale_bones(pose, g, &sv, 1.0 - s0);
            } else if all_zeros(i0, i1) {
                calc(pose, sv.anim(i0 + 1, i1));
                self.scale_bones(pose, g, &sv, s0);
            } else {
                let mut p2 = mk();
                calc(pose, sv.anim(i0, i1));
                calc(&mut p2, sv.anim(i0 + 1, i1));
                blend(pose, &p2, s0);
            }
        } else if s1 > 0.999 {
            let mut p2 = mk();
            calc(pose, sv.anim(i0, i1 + 1));
            calc(&mut p2, sv.anim(i0 + 1, i1 + 1));
            blend(pose, &p2, s0);
        } else {
            // 3-way triangle blend
            let (idx, w) = calc_3way_blend(i0, i1, s0, s1, &sv);
            let mut p2 = mk();
            if w[1] < 0.001 {
                calc(pose, idx[0]);
                calc(&mut p2, idx[2]);
                blend(pose, &p2, w[2] / (w[0] + w[2]));
            } else {
                calc(pose, idx[0]);
                calc(&mut p2, idx[1]);
                blend(pose, &p2, w[1] / (w[0] + w[1]));
                let mut p3 = mk();
                calc(&mut p3, idx[2]);
                blend(pose, &p3, w[2]);
            }
        }
        true
    }

    /// `CalcVirtualAnimation`: decode one animation (group-local index `local_anim` in the sequence's
    /// group) at `cycle`, writing only the bones the sequence weights.
    fn calc_animation(&self, pose: &mut Pose, seq: usize, local_anim: i32, cycle: f32, nb: usize) {
        let (sg, sv) = self.seq_view(seq);
        let Some(anim) = self.anim_for_seq(sg, local_anim) else { return };
        let seq_group = &self.groups[sg];
        let anim_group = &self.groups[anim.group];

        let num_frames = anim.numframes();
        let f_frame = cycle * (num_frames - 1) as f32;
        let i_frame = f_frame as i32;
        let s = f_frame - i_frame as f32;
        let mut local_frame = i_frame;
        let delta = anim.flags() & STUDIO_DELTA != 0;

        // pre-initialise every weighted bone from the sequence group's base pose
        for i in 0..nb {
            let j = seq_group.bone_map[i];
            if j >= 0 && sv.weight(j as usize) > 0.0 {
                if delta {
                    pose.quat[i] = [0.0, 0.0, 0.0, 1.0];
                    pose.pos[i] = [0.0; 3];
                } else {
                    let b = &seq_group.bones[j as usize];
                    pose.quat[i] = b.quat;
                    pose.pos[i] = b.pos;
                }
            }
        }

        let Some(mut p) = anim.panim(&mut local_frame) else { return };
        let d = &anim_group.data;
        let mut guard = 0;
        loop {
            let bone_id = u8at(d, p);
            if bone_id >= 255 || guard > 4096 {
                break;
            }
            guard += 1;
            let flags = u8at(d, p + 1);
            let next = i16at(d, p + 2);
            let j = anim_group.master_bone.get(bone_id as usize).copied().unwrap_or(-1);
            if j >= 0 {
                let k = seq_group.bone_map.get(j as usize).copied().unwrap_or(-1);
                if k >= 0 && sv.weight(k as usize) > 0.0 {
                    let ab = &anim_group.bones[bone_id as usize];
                    pose.quat[j as usize] = calc_bone_quaternion(d, p, flags, local_frame, s, ab);
                    pose.pos[j as usize] = calc_bone_position(d, p, flags, local_frame, s, ab);
                }
            }
            if next == 0 {
                break;
            }
            p = rel(p, next as i32);
        }
    }

    fn blend_bones(&self, q1: &mut Pose, q2: &Pose, sg: usize, sv: &Seq, s: f32) {
        if s <= 0.0 {
            return;
        }
        let seq_group = &self.groups[sg];
        let nb = self.num_bones();
        let (s2, s1) = (s, 1.0 - s);
        for i in 0..nb {
            let j = seq_group.bone_map[i];
            if j < 0 || sv.weight(j as usize) <= 0.0 {
                continue;
            }
            let fixed = self.groups[0].bones[i].flags & BONE_FIXED_ALIGNMENT != 0;
            let q3 = if s >= 1.0 {
                q2.quat[i]
            } else if fixed {
                q_blend_no_align(q2.quat[i], q1.quat[i], s1)
            } else {
                q_blend(q2.quat[i], q1.quat[i], s1)
            };
            q1.quat[i] = q3;
            if s >= 1.0 {
                q1.pos[i] = q2.pos[i];
            } else {
                for c in 0..3 {
                    q1.pos[i][c] = q1.pos[i][c] * s1 + q2.pos[i][c] * s2;
                }
            }
        }
    }

    fn scale_bones(&self, q1: &mut Pose, sg: usize, sv: &Seq, s: f32) {
        let seq_group = &self.groups[sg];
        for i in 0..self.num_bones() {
            let j = seq_group.bone_map[i];
            if j >= 0 && sv.weight(j as usize) > 0.0 {
                q1.quat[i] = q_identity_blend(q1.quat[i], 1.0 - s);
                for c in 0..3 {
                    q1.pos[i][c] *= s;
                }
            }
        }
    }

    /// `SlerpBones`: blend `q2` (the sequence's pose) over `q1` by `s`, weighted per bone.
    fn slerp_bones(&self, q1: &mut Pose, q2: &Pose, sg: usize, sv: &Seq, s: f32) {
        if s <= 0.0 {
            return;
        }
        let s = s.min(1.0);
        let seq_group = &self.groups[sg];
        let nb = self.num_bones();
        let flags = sv.flags();

        if flags & STUDIO_WORLD != 0 {
            self.world_space_slerp(q1, q2, sg, sv, s);
            return;
        }

        let weights: Vec<f32> = (0..nb)
            .map(|i| {
                let j = seq_group.bone_map[i];
                if j >= 0 {
                    s * sv.weight(j as usize)
                } else {
                    0.0
                }
            })
            .collect();

        if flags & STUDIO_DELTA != 0 {
            for i in 0..nb {
                let s2 = weights[i];
                if s2 <= 0.0 {
                    continue;
                }
                q1.quat[i] = if flags & STUDIO_POST != 0 {
                    q_ma(q1.quat[i], s2, q2.quat[i])
                } else {
                    q_sm(s2, q2.quat[i], q1.quat[i])
                };
                for c in 0..3 {
                    q1.pos[i][c] += q2.pos[i][c] * s2;
                }
            }
            return;
        }

        for i in 0..nb {
            let s2 = weights[i];
            if s2 <= 0.0 {
                continue;
            }
            let s1 = 1.0 - s2;
            q1.quat[i] = if self.groups[0].bones[i].flags & BONE_FIXED_ALIGNMENT != 0 {
                q_slerp_no_align(q2.quat[i], q1.quat[i], s1)
            } else {
                q_slerp(q2.quat[i], q1.quat[i], s1)
            };
            for c in 0..3 {
                q1.pos[i][c] = q1.pos[i][c] * s1 + q2.pos[i][c] * s2;
            }
        }
    }

    /// `WorldSpaceSlerp`: blend orientations in world space (used by `STUDIO_WORLD` sequences).
    fn world_space_slerp(&self, q1: &mut Pose, q2: &Pose, sg: usize, sv: &Seq, s: f32) {
        let seq_group = &self.groups[sg];
        let bones = &self.groups[0].bones;
        let nb = bones.len();
        let world = |pose: &Pose, i: usize| -> (Quat, Vec3) {
            // accumulate the chain from the root
            let mut chain = vec![i];
            let mut p = bones[i].parent;
            while p >= 0 {
                chain.push(p as usize);
                p = bones[p as usize].parent;
            }
            let mut m = IDENTITY;
            for &b in chain.iter().rev() {
                m = mat_mul(&m, &quat_pos_matrix(pose.quat[b], pose.pos[b]));
            }
            (matrix_quat(&m), [m[3], m[7], m[11]])
        };
        for i in 0..nb {
            let n = bones[i].parent;
            let j = seq_group.bone_map[i];
            let mut s1 = 0.0f32; // weight of the parent
            let s2 = if j >= 0 {
                if n != -1 {
                    let nj = seq_group.bone_map[n as usize];
                    if nj >= 0 {
                        s1 = s * sv.weight(nj as usize);
                    }
                }
                s * sv.weight(j as usize)
            } else {
                0.0
            };
            if s1 == 1.0 && s2 == 1.0 {
                q1.pos[i] = q2.pos[i];
                q1.quat[i] = q2.quat[i];
            } else if s2 > 0.0 {
                let (dest_q, dest_p) = world(q1, i);
                let (src_q, _) = world(q2, i);
                let target_q = q_slerp(dest_q, src_q, s2);
                let target = quat_pos_matrix(target_q, dest_p);
                if n == -1 {
                    q1.quat[i] = matrix_quat(&target);
                } else {
                    // the parent was already blended (parents come first), so q1 holds its target
                    let (pq, pp) = world(q1, n as usize);
                    let parent_target = quat_pos_matrix(pq, pp);
                    let local = mat_mul(&mat_invert(&parent_target), &target);
                    q1.quat[i] = matrix_quat(&local);
                    for c in 0..3 {
                        q1.pos[i][c] += (q2.pos[i][c] - q1.pos[i][c]) * s2;
                    }
                }
            }
        }
    }
}

// --- 3x4 matrices (row-major, 12 floats), for the world-space blend only ---

type Mat = [f32; 12];
const IDENTITY: Mat = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];

fn quat_pos_matrix(q: Quat, p: Vec3) -> Mat {
    [
        1.0 - 2.0 * q[1] * q[1] - 2.0 * q[2] * q[2],
        2.0 * q[0] * q[1] - 2.0 * q[3] * q[2],
        2.0 * q[0] * q[2] + 2.0 * q[3] * q[1],
        p[0],
        2.0 * q[0] * q[1] + 2.0 * q[3] * q[2],
        1.0 - 2.0 * q[0] * q[0] - 2.0 * q[2] * q[2],
        2.0 * q[1] * q[2] - 2.0 * q[3] * q[0],
        p[1],
        2.0 * q[0] * q[2] - 2.0 * q[3] * q[1],
        2.0 * q[1] * q[2] + 2.0 * q[3] * q[0],
        1.0 - 2.0 * q[0] * q[0] - 2.0 * q[1] * q[1],
        p[2],
    ]
}

fn mat_mul(a: &Mat, b: &Mat) -> Mat {
    let mut o = [0.0; 12];
    for r in 0..3 {
        for c in 0..3 {
            o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
        }
        o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
    }
    o
}

fn mat_invert(m: &Mat) -> Mat {
    // rigid transform inverse: R^T, -R^T t
    let mut o = [0.0; 12];
    for r in 0..3 {
        for c in 0..3 {
            o[r * 4 + c] = m[c * 4 + r];
        }
    }
    for r in 0..3 {
        o[r * 4 + 3] = -(o[r * 4] * m[3] + o[r * 4 + 1] * m[7] + o[r * 4 + 2] * m[11]);
    }
    o
}

fn matrix_quat(m: &Mat) -> Quat {
    let trace = m[0] + m[5] + m[10];
    let mut q = [0.0f32; 4];
    if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        q[3] = 0.25 * s;
        q[0] = (m[9] - m[6]) / s;
        q[1] = (m[2] - m[8]) / s;
        q[2] = (m[4] - m[1]) / s;
    } else if m[0] > m[5] && m[0] > m[10] {
        let s = (1.0 + m[0] - m[5] - m[10]).sqrt() * 2.0;
        q[3] = (m[9] - m[6]) / s;
        q[0] = 0.25 * s;
        q[1] = (m[1] + m[4]) / s;
        q[2] = (m[2] + m[8]) / s;
    } else if m[5] > m[10] {
        let s = (1.0 + m[5] - m[0] - m[10]).sqrt() * 2.0;
        q[3] = (m[2] - m[8]) / s;
        q[0] = (m[1] + m[4]) / s;
        q[1] = 0.25 * s;
        q[2] = (m[6] + m[9]) / s;
    } else {
        let s = (1.0 + m[10] - m[0] - m[5]).sqrt() * 2.0;
        q[3] = (m[4] - m[1]) / s;
        q[0] = (m[2] + m[8]) / s;
        q[1] = (m[6] + m[9]) / s;
        q[2] = 0.25 * s;
    }
    q_normalize(&mut q);
    q
}

// --- views over raw sequence / animation descriptors ---

struct AutoLayer {
    seq: i16,
    pose: i16,
    flags: i32,
    start: f32,
    peak: f32,
    tail: f32,
    end: f32,
}

struct Seq<'a> {
    grp: &'a Group,
    base: usize,
}

impl Seq<'_> {
    fn d(&self) -> &[u8] {
        &self.grp.data
    }
    fn flags(&self) -> i32 {
        i32at(self.d(), self.base + 12)
    }
    fn groupsize(&self, axis: usize) -> i32 {
        i32at(self.d(), self.base + 68 + axis * 4)
    }
    fn paramindex(&self, axis: usize) -> i32 {
        i32at(self.d(), self.base + 76 + axis * 4)
    }
    fn paramstart(&self, axis: usize) -> f32 {
        f32at(self.d(), self.base + 84 + axis * 4)
    }
    fn paramend(&self, axis: usize) -> f32 {
        f32at(self.d(), self.base + 92 + axis * 4)
    }
    fn posekeyindex(&self) -> i32 {
        i32at(self.d(), self.base + 160)
    }
    fn cycleposeindex(&self) -> i32 {
        i32at(self.d(), self.base + 180)
    }
    fn pose_key(&self, axis: usize, anim: i32) -> f32 {
        let o = rel(self.base, self.posekeyindex()) + (axis * self.groupsize(0).max(0) as usize + anim.max(0) as usize) * 4;
        f32at(self.d(), o)
    }
    /// `seqdesc.anim(x, y)` with the same clamping as the SDK.
    fn anim(&self, mut x: i32, mut y: i32) -> i32 {
        let (g0, g1) = (self.groupsize(0), self.groupsize(1));
        if x >= g0 {
            x = g0 - 1;
        }
        if y >= g1 {
            y = g1 - 1;
        }
        let offset = (y * g0 + x).max(0) as usize;
        let o = rel(self.base, i32at(self.d(), self.base + 60)) + offset * 2;
        i16at(self.d(), o) as i32
    }
    fn weight(&self, bone: usize) -> f32 {
        f32at(self.d(), rel(self.base, i32at(self.d(), self.base + 156)) + bone * 4)
    }
    fn num_autolayers(&self) -> usize {
        i32at(self.d(), self.base + 148).clamp(0, 64) as usize
    }
    fn autolayer(&self, i: usize) -> AutoLayer {
        let o = rel(self.base, i32at(self.d(), self.base + 152)) + i * SIZEOF_AUTOLAYER;
        let d = self.d();
        AutoLayer {
            seq: i16at(d, o),
            pose: i16at(d, o + 2),
            flags: i32at(d, o + 4),
            start: f32at(d, o + 8),
            peak: f32at(d, o + 12),
            tail: f32at(d, o + 16),
            end: f32at(d, o + 20),
        }
    }
}

#[derive(Clone, Copy)]
struct AnimDesc<'a> {
    grp: &'a Group,
    base: usize,
    group: usize,
}

impl AnimDesc<'_> {
    fn d(&self) -> &[u8] {
        &self.grp.data
    }
    fn fps(&self) -> f32 {
        f32at(self.d(), self.base + 8)
    }
    fn flags(&self) -> i32 {
        i32at(self.d(), self.base + 12)
    }
    fn numframes(&self) -> i32 {
        i32at(self.d(), self.base + 16)
    }

    /// `mstudioanimdesc_t::pAnim`: byte position of the first per-bone entry for `*frame`, adjusting
    /// `frame` to be section-local. Only data stored in this MDL is supported.
    fn panim(&self, frame: &mut i32) -> Option<usize> {
        let d = self.d();
        let animblock = i32at(d, self.base + 52);
        let animindex = i32at(d, self.base + 56);
        let sectionindex = i32at(d, self.base + 80);
        let sectionframes = i32at(d, self.base + 84);
        let num_frames = self.numframes();

        let (block, index) = if sectionframes != 0 {
            let section = if num_frames > sectionframes && *frame == num_frames - 1 {
                // last frame on long anims is stored separately
                *frame = 0;
                num_frames / sectionframes + 1
            } else {
                let s = *frame / sectionframes;
                *frame -= s * sectionframes;
                s
            };
            let so = rel(self.base, sectionindex) + section as usize * 8;
            (i32at(d, so), i32at(d, so + 4))
        } else {
            (animblock, animindex)
        };
        match block {
            0 => Some(rel(self.base, index)),
            _ => None, // -1 = needs recompile, >0 = external .ani block (unsupported)
        }
    }
}

fn calc_3way_blend(i0: i32, i1: i32, s0: f32, s1: f32, sv: &Seq) -> ([i32; 3], [f32; 3]) {
    let even = ((i0 + i1) & 1) == 0;
    let (x1, y1, x2, y2, x3, y3);
    let mut w = [0.0f32; 3];
    if even {
        if s0 > s1 {
            (x1, y1, x2, y2, x3, y3) = (0, 0, 1, 0, 1, 1);
            w[0] = 1.0 - s0;
            w[1] = s0 - s1;
        } else {
            (x1, y1, x2, y2, x3, y3) = (1, 1, 0, 1, 0, 0);
            w[0] = s0;
            w[1] = s1 - s0;
        }
    } else if s0 + s1 > 1.0 {
        (x1, y1, x2, y2, x3, y3) = (1, 0, 1, 1, 0, 1);
        w[0] = 1.0 - s1;
        w[1] = s0 - 1.0 + s1;
    } else {
        (x1, y1, x2, y2, x3, y3) = (0, 1, 0, 0, 1, 0);
        w[0] = s1;
        w[1] = 1.0 - s0 - s1;
    }
    let idx = [sv.anim(i0 + x1, i1 + y1), sv.anim(i0 + x2, i1 + y2), sv.anim(i0 + x3, i1 + y3)];
    if w[1] < 0.001 {
        w[1] = 0.0;
    }
    w[2] = 1.0 - w[0] - w[1];
    (idx, w)
}

// --- animation value decoding (ExtractAnimValue, CalcBoneQuaternion, CalcBonePosition) ---

/// Returns the pair `(v1, v2)` of frame values, `v2` being the next frame's value for interpolation.
fn extract_anim_value(d: &[u8], start: Option<usize>, frame: i32, scale: f32) -> (f32, f32) {
    let Some(mut p) = start else { return (0.0, 0.0) };
    let valid = |p: usize| u8at(d, p) as i32;
    let total = |p: usize| u8at(d, p + 1) as i32;
    let value = |p: usize, j: i32| i16at(d, p + 2 * j.max(0) as usize) as f32 * scale;

    if total(p) == 1 && valid(p) == 1 {
        let v = value(p, 1);
        return (v, v);
    }
    let mut k = frame;
    while total(p) <= k {
        k -= total(p);
        p += (valid(p) as usize + 1) * 2;
        if total(p) == 0 {
            return (0.0, 0.0);
        }
    }
    let (v1, v2);
    if valid(p) > k {
        v1 = value(p, k + 1);
        v2 = if valid(p) > k + 1 {
            value(p, k + 2)
        } else if total(p) > k + 1 {
            v1
        } else {
            value(p, valid(p) + 2)
        };
    } else {
        v1 = value(p, valid(p));
        v2 = if total(p) > k + 1 { v1 } else { value(p, valid(p) + 2) };
    }
    (v1, v2)
}

fn value_ptr(d: &[u8], vp: usize, i: usize) -> Option<usize> {
    let off = i16at(d, vp + 2 * i) as i32;
    if off > 0 {
        Some(rel(vp, off))
    } else {
        None
    }
}

fn calc_bone_quaternion(d: &[u8], p: usize, flags: u8, frame: i32, s: f32, bone: &Bone) -> Quat {
    let data = p + 4;
    if flags & ANIM_RAWROT != 0 {
        return quat48(d, data);
    }
    if flags & ANIM_RAWROT2 != 0 {
        return quat64(d, data);
    }
    if flags & ANIM_ANIMROT == 0 {
        return if flags & ANIM_DELTA != 0 { [0.0, 0.0, 0.0, 1.0] } else { bone.quat };
    }
    let vp = data; // rotation value pointers come first
    let delta = flags & ANIM_DELTA != 0;
    let q;
    if s > 0.001 {
        let mut a1 = [0.0f32; 3];
        let mut a2 = [0.0f32; 3];
        for c in 0..3 {
            let (v1, v2) = extract_anim_value(d, value_ptr(d, vp, c), frame, bone.rotscale[c]);
            a1[c] = v1;
            a2[c] = v2;
        }
        if !delta {
            for c in 0..3 {
                a1[c] += bone.rot[c];
                a2[c] += bone.rot[c];
            }
        }
        q = if a1 != a2 {
            q_blend(angle_quaternion(a1), angle_quaternion(a2), s)
        } else {
            angle_quaternion(a1)
        };
    } else {
        let mut a = [0.0f32; 3];
        for c in 0..3 {
            a[c] = extract_anim_value(d, value_ptr(d, vp, c), frame, bone.rotscale[c]).0;
        }
        if !delta {
            for c in 0..3 {
                a[c] += bone.rot[c];
            }
        }
        q = angle_quaternion(a);
    }
    if !delta && bone.flags & BONE_FIXED_ALIGNMENT != 0 {
        return q_align(bone.qalign, q);
    }
    q
}

fn calc_bone_position(d: &[u8], p: usize, flags: u8, frame: i32, s: f32, bone: &Bone) -> Vec3 {
    let data = p + 4;
    if flags & ANIM_RAWPOS != 0 {
        let off = data + if flags & ANIM_RAWROT != 0 { 6 } else { 0 } + if flags & ANIM_RAWROT2 != 0 { 8 } else { 0 };
        return vec48(d, off);
    }
    if flags & ANIM_ANIMPOS == 0 {
        return if flags & ANIM_DELTA != 0 { [0.0; 3] } else { bone.pos };
    }
    let vp = data + if flags & ANIM_ANIMROT != 0 { 6 } else { 0 };
    let mut pos = [0.0f32; 3];
    for c in 0..3 {
        let (v1, v2) = extract_anim_value(d, value_ptr(d, vp, c), frame, bone.posscale[c]);
        pos[c] = if s > 0.001 { v1 * (1.0 - s) + v2 * s } else { v1 };
    }
    if flags & ANIM_DELTA == 0 {
        for c in 0..3 {
            pos[c] += bone.pos[c];
        }
    }
    pos
}

impl AnimSet {
    /// The sequence a taunt is played over. The game plays a taunt scene's sequence as a layer over the player's own animation (the
    /// weapon's stand pose), and a taunt is authored for that: its first and last frames hold nothing (the all-zero pose, which on its own
    /// lies the body flat on the ground) and its auto layer brings the real motion in over the first few frames and out over the last.
    /// None for anything but a taunt, and for a model without a stand pose (a prop).
    pub fn layer_base(&self, seq: usize) -> Option<usize> {
        let name = self.seq_name(seq).to_ascii_lowercase();
        if !name.contains("taunt") || name.starts_with("layer_") {
            return None;
        }
        self.layer_base_of_stand()
    }

    /// Samples `seq` at its native frame rate into a [`Clip`] using the given pose parameters. A taunt is sampled over its base pose ([`layer_base`]).
    pub fn bake(&self, seq: usize, params: &[f32]) -> Clip {
        self.bake_over(seq, params, None)
    }

    /// The stand pose of a class model, in the bones of this set (matched by name; a bone the class lacks keeps its bind pose): what a
    /// taunt that was compiled on its own (a Workshop taunt's animation model has no stand sequence) is played over.
    fn pose_from(&self, class: &AnimSet) -> Option<Pose> {
        let stand = class.layer_base_of_stand()?;
        let from = class.evaluate(stand, 0.0, &class.default_pose_params());
        let names = class.bone_names();
        let mut pose = self.init_pose();
        for (i, n) in self.bone_names().iter().enumerate() {
            if let Some(j) = names.iter().position(|m| m.eq_ignore_ascii_case(n)) {
                pose.pos[i] = from.pos[j];
                pose.quat[i] = from.quat[j];
            }
        }
        Some(pose)
    }

    /// The sequence an additive (delta) sequence of a building is played over: a sentry's `fire` is the gun's recoil on top of the sentry's
    /// own running animation (the game plays it as a gesture), and alone it would be a pile of deltas on the bind pose.
    pub fn delta_base(&self, seq: usize) -> Option<usize> {
        let (_, sv) = self.seq_view(seq);
        if sv.flags() & STUDIO_DELTA == 0 || sv.flags() & STUDIO_HIDDEN != 0 {
            return None;
        }
        ["idle_off", "running"].iter().find_map(|n| self.find_sequence(n)).filter(|&base| base != seq)
    }

    fn layer_base_of_stand(&self) -> Option<usize> {
        ["stand_primary", "stand_melee", "stand_secondary"].iter().find_map(|n| self.find_sequence(n))
    }

    /// `bake`, with `class` (the player model whose stand pose the sequence is layered over) for a set that has no stand pose of its
    /// own: then the sequence is layered whatever its name.
    pub fn bake_over(&self, seq: usize, params: &[f32], class: Option<&AnimSet>) -> Clip {
        self.bake_with(seq, params, class, true)
    }

    /// `bake_over`, with `blend` off the sequence is sampled alone, as the animation files hold it.
    pub fn bake_with(&self, seq: usize, params: &[f32], class: Option<&AnimSet>, blend: bool) -> Clip {
        let gesture = self.delta_base(seq);
        let outside = class.filter(|_| blend && gesture.is_none()).and_then(|c| self.pose_from(c));
        let base = if outside.is_some() || !blend || gesture.is_some() { None } else { self.layer_base(seq) };
        let timing = self.timing(seq, params);
        let frames = (timing.max_frame.max(0) as usize + 1).max(1);
        let nb = self.num_bones();
        let (_, sv) = self.seq_view(seq);
        let mut pos = Vec::with_capacity(frames * nb * 3);
        let mut quat = Vec::with_capacity(frames * nb * 4);
        for f in 0..frames {
            let cycle = if frames > 1 { f as f32 / (frames - 1) as f32 } else { 0.0 };
            let pose = match (&outside, base) {
                _ if gesture.is_some() => self.evaluate_layered(gesture.unwrap(), cycle, &[(seq, cycle, 1.0)], params),
                (Some(under), _) => {
                    let mut pose = under.clone();
                    self.accumulate_pose(&mut pose, seq as i32, cycle, 1.0, params);
                    pose
                }
                (None, Some(base)) => self.evaluate_layered(base, 0.0, &[(seq, cycle, 1.0)], params),
                (None, None) => self.evaluate(seq, cycle, params),
            };
            for b in 0..nb {
                pos.extend_from_slice(&pose.pos[b]);
                quat.extend_from_slice(&pose.quat[b]);
            }
        }
        Clip {
            fps: if timing.fps > 0.0 { timing.fps } else { 30.0 },
            looping: sv.flags() & STUDIO_LOOPING != 0,
            frames,
            num_bones: nb,
            pos,
            quat,
        }
    }
}

impl AnimSet {
    /// Human-readable structure of a sequence (blend grid, pose parameters, auto layers), for debugging.
    pub fn describe(&self, seq: usize) -> String {
        use std::fmt::Write;
        let (g, sv) = self.seq_view(seq);
        let mut s = String::new();
        let _ = writeln!(
            s,
            "seq {seq} '{}' flags={:#x} groupsize=[{}, {}] posekeyindex={}",
            self.seq_name(seq),
            sv.flags(),
            sv.groupsize(0),
            sv.groupsize(1),
            sv.posekeyindex()
        );
        for axis in 0..2 {
            let pi = sv.paramindex(axis);
            if pi >= 0 {
                let name = self.groups[g].master_pose.get(pi as usize).map(|&k| self.pose_params[k].name.as_str()).unwrap_or("?");
                let _ = writeln!(s, "  axis {axis}: pose param '{name}' range {}..{}", sv.paramstart(axis), sv.paramend(axis));
            }
        }
        for y in 0..sv.groupsize(1).max(1) {
            let row: Vec<String> = (0..sv.groupsize(0).max(1))
                .map(|x| {
                    self.anim_for_seq(g, sv.anim(x, y))
                        .map(|a| format!("{}({}f{})", cstr(&a.grp.data, rel(a.base, i32at(&a.grp.data, a.base + 4))), a.numframes(), if a.flags() & STUDIO_DELTA != 0 { " delta" } else { "" }))
                        .unwrap_or_else(|| "?".into())
                })
                .collect();
            let _ = writeln!(s, "  row {y}: {}", row.join(" | "));
        }
        for i in 0..sv.num_autolayers() {
            let l = sv.autolayer(i);
            let target = self.groups[g].master_seq.get(l.seq as usize).map(|&t| self.seq_name(t)).unwrap_or_else(|| "?".into());
            let pose_name = self.groups[g]
                .master_seq
                .get(l.seq as usize)
                .and_then(|&t| {
                    let (tg, _) = self.seq_view(t);
                    self.groups[tg].master_pose.get(l.pose as usize).map(|&k| self.pose_params[k].name.clone())
                })
                .unwrap_or_else(|| "?".into());
            let _ = writeln!(s, "  layer {i}: '{target}' flags={:#x} pose='{pose_name}' start={} peak={} tail={} end={}", l.flags, l.start, l.peak, l.tail, l.end);
        }
        s
    }
}

impl AnimSet {
    /// SDK bone_merge_cache.cpp matches by name in model space. Imported taunts
    /// can have extra prop bones and a different bone order/parent hierarchy.
    /// Re-express the matched world transforms in the destination skeleton's local
    /// space, so the same animation drives both the player and the prop's own bones.
    pub fn bake_for_bones(&self, seq: usize, params: &[f32], target: &[crate::mdl::Bone]) -> Clip {
        self.bake_for_bones_over(seq, params, target, None)
    }

    /// `bake_for_bones` over the stand pose of `class` (see `bake_over`).
    pub fn bake_for_bones_over(&self, seq: usize, params: &[f32], target: &[crate::mdl::Bone], class: Option<&AnimSet>) -> Clip {
        self.bake_for_bones_with(seq, params, target, class, true)
    }

    /// `bake_for_bones_over`, with `blend` off the sequence is sampled alone.
    pub fn bake_for_bones_with(&self, seq: usize, params: &[f32], target: &[crate::mdl::Bone], class: Option<&AnimSet>, blend: bool) -> Clip {
        let source = self.bake_with(seq, params, class, blend);
        let names = self.bone_names();
        let parents = self.bone_parents();
        let map: Vec<_> = target.iter().map(|b| names.iter().position(|n| n.eq_ignore_ascii_case(&b.name))).collect();
        let mut out = Clip { fps: source.fps, looping: source.looping, frames: source.frames, num_bones: target.len(), pos: Vec::new(), quat: Vec::new() };
        for frame in 0..source.frames {
            let pose = Pose {
                pos: (0..source.num_bones).map(|i| source.pos[(frame * source.num_bones + i) * 3..][..3].try_into().unwrap()).collect(),
                quat: (0..source.num_bones).map(|i| source.quat[(frame * source.num_bones + i) * 4..][..4].try_into().unwrap()).collect(),
            };
            let (sp, sq) = world_transforms(&parents, &pose);
            let mut wp = vec![[0.0; 3]; target.len()];
            let mut wq = vec![[0.0, 0.0, 0.0, 1.0]; target.len()];
            for (i, b) in target.iter().enumerate() {
                let p = (b.parent >= 0).then_some(b.parent as usize);
                let (pos, quat) = if let Some(j) = map[i] {
                    wp[i] = sp[j]; wq[i] = sq[j];
                    if let Some(p) = p { (q_rotate(q_conj(wq[p]), v_sub(sp[j], wp[p])), q_mul(q_conj(wq[p]), sq[j])) }
                    else { (sp[j], sq[j]) }
                } else {
                    if let Some(p) = p {
                        wp[i] = v_add(wp[p], q_rotate(wq[p], b.pos));
                        wq[i] = q_mul(wq[p], b.quat);
                    } else { wp[i] = b.pos; wq[i] = b.quat; }
                    (b.pos, b.quat)
                };
                out.pos.extend_from_slice(&pos); out.quat.extend_from_slice(&quat);
            }
        }
        out
    }
}

impl AnimSet {
    /// Lists the per-bone entries (bone, flags) of the named animation, for debugging.
    pub fn dump_anim_entries(&self, name: &str) -> String {
        use std::fmt::Write;
        let mut s = String::new();
        let Some(&(g, l)) = self.anims.iter().find(|&&(g, l)| self.groups[g].anim_name(l).eq_ignore_ascii_case(name)) else {
            return format!("animation '{name}' not found");
        };
        let grp = &self.groups[g];
        let ad = AnimDesc { grp, base: grp.anim_base(l), group: g };
        let _ = writeln!(s, "anim '{name}': frames={} fps={} flags={:#x} animblock={} animindex={} sectionframes={}", ad.numframes(), ad.fps(), ad.flags(), i32at(&grp.data, ad.base + 52), i32at(&grp.data, ad.base + 56), i32at(&grp.data, ad.base + 84));
        let mut frame = 0;
        let Some(mut p) = ad.panim(&mut frame) else { return s + "  (no data)" };
        for _ in 0..200 {
            let bone = u8at(&grp.data, p);
            if bone >= 255 {
                break;
            }
            let flags = u8at(&grp.data, p + 1);
            let next = i16at(&grp.data, p + 2);
            let bname = grp.bones.get(bone as usize).map_or("?", |b| b.name.as_str());
            let _ = writeln!(s, "  bone {bone:3} {bname:<16} flags={flags:#04x}{}{}{}{}{}{} next={next}",
                if flags & ANIM_RAWPOS != 0 { " RAWPOS" } else { "" },
                if flags & ANIM_RAWROT != 0 { " RAWROT" } else { "" },
                if flags & ANIM_ANIMPOS != 0 { " ANIMPOS" } else { "" },
                if flags & ANIM_ANIMROT != 0 { " ANIMROT" } else { "" },
                if flags & ANIM_DELTA != 0 { " DELTA" } else { "" },
                if flags & ANIM_RAWROT2 != 0 { " RAWROT2" } else { "" });
            if next == 0 {
                break;
            }
            p = rel(p, next as i32);
        }
        s
    }
}

type World = (Vec<Vec3>, Vec<Quat>);

/// Model-space position and rotation of every bone of a local pose (parents come before their children).
fn world_transforms(parents: &[i32], pose: &Pose) -> World {
    let n = pose.pos.len();
    let mut wp = vec![[0.0; 3]; n];
    let mut wq = vec![[0.0, 0.0, 0.0, 1.0]; n];
    for i in 0..n {
        let p = parents[i];
        if p < 0 {
            wp[i] = pose.pos[i];
            wq[i] = pose.quat[i];
        } else {
            let p = p as usize;
            wp[i] = v_add(wp[p], q_rotate(wq[p], pose.pos[i]));
            wq[i] = q_mul(wq[p], pose.quat[i]);
        }
    }
    (wp, wq)
}

/// Turns a bone by `delta` (a rotation in model space), keeping its position.
fn turn_bone(pose: &mut Pose, parents: &[i32], bone: usize, delta: Quat) {
    let w = world_transforms(parents, pose);
    let new_world = q_mul(delta, w.1[bone]);
    let p = parents[bone];
    pose.quat[bone] = if p < 0 { new_world } else { q_mul(q_conj(w.1[p as usize]), new_world) };
}

fn v_add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn v_sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn v_scale(a: Vec3, s: f32) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn v_dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn v_cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn v_len(a: Vec3) -> f32 {
    v_dot(a, a).sqrt()
}
fn q_conj(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}
fn q_mul(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
fn q_rotate(q: Quat, v: Vec3) -> Vec3 {
    let qv = [q[0], q[1], q[2]];
    let t = v_scale(v_cross(qv, v), 2.0);
    v_add(v_add(v, v_scale(t, q[3])), v_cross(qv, t))
}
/// The smallest rotation taking the direction `a` to the direction `b`.
fn q_between(a: Vec3, b: Vec3) -> Quat {
    let (la, lb) = (v_len(a), v_len(b));
    if la < 1e-6 || lb < 1e-6 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let (a, b) = (v_scale(a, 1.0 / la), v_scale(b, 1.0 / lb));
    let d = v_dot(a, b);
    if d < -0.999999 {
        // opposite: any axis perpendicular to a
        let axis = if a[0].abs() < 0.9 { v_cross(a, [1.0, 0.0, 0.0]) } else { v_cross(a, [0.0, 1.0, 0.0]) };
        let l = v_len(axis);
        return [axis[0] / l, axis[1] / l, axis[2] / l, 0.0];
    }
    let c = v_cross(a, b);
    let q = [c[0], c[1], c[2], 1.0 + d];
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
