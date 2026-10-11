//! Studio model (`.mdl`) geometry/header parser, versions 44–48 (TF2 / Source).
//! Struct layouts follow `public/studio.h` in the Source SDK 2013.
//!
//! Milestone 2 covers: bones, textures, skins, bodyparts/models/meshes and
//! `$includemodel` references. Sequences and animation come in milestone 4.

use crate::binary::{count, cstr_at, fail, half_to_f32, i32_at, offset, Reader, Result};

pub const MDL_VERSION: i32 = 48;

const STUDIOHDR_BONE_INDEX: usize = 160;
const SIZEOF_BONE: usize = 216;
const SIZEOF_BODYPART: usize = 16;
const SIZEOF_MODEL: usize = 148;
const SIZEOF_MESH: usize = 116;
const SIZEOF_TEXTURE: usize = 64;
const SIZEOF_MODELGROUP: usize = 8;
const SIZEOF_EYEBALL: usize = 172;
const BONE_ALWAYS_PROCEDURAL: i32 = 0x04;
const STUDIO_PROC_JIGGLE: i32 = 5;
const SIZEOF_FLEX: usize = 60;
const SIZEOF_ATTACHMENT: usize = 92;
const SIZEOF_FLEXCONTROLLER: usize = 20;
const SIZEOF_FLEXRULE: usize = 12;

/// `mstudiojigglebone_t`: physics-driven "jiggle" bone parameters (all angles in radians).
#[derive(Debug, Clone, Default)]
pub struct Jiggle {
    pub flags: i32,
    pub length: f32,
    pub tip_mass: f32,
    pub yaw_stiffness: f32,
    pub yaw_damping: f32,
    pub pitch_stiffness: f32,
    pub pitch_damping: f32,
    pub along_stiffness: f32,
    pub along_damping: f32,
    pub angle_limit: f32,
    pub min_yaw: f32,
    pub max_yaw: f32,
    pub min_pitch: f32,
    pub max_pitch: f32,
    pub base_mass: f32,
    pub base_stiffness: f32,
    pub base_damping: f32,
    /// Base spring limits: min/max left, up, forward and their frictions.
    pub base_min: [f32; 3],
    pub base_max: [f32; 3],
    pub base_friction: [f32; 3],
    pub boing_impact_speed: f32,
    pub boing_impact_angle: f32,
    pub boing_damping_rate: f32,
    pub boing_frequency: f32,
    pub boing_amplitude: f32,
}

#[derive(Debug, Clone)]
pub struct Bone {
    pub name: String,
    pub parent: i32,
    pub pos: [f32; 3],
    /// Quaternion, x y z w.
    pub quat: [f32; 4],
    /// Euler angles in radians (x y z).
    pub rot: [f32; 3],
    /// Inverse bind pose, 3x4 row-major.
    pub pose_to_bone: [f32; 12],
    pub flags: i32,
    /// Set for bones with a `STUDIO_PROC_JIGGLE` procedural rule that are always simulated.
    pub jiggle: Option<Jiggle>,
}

#[derive(Debug, Clone)]
pub struct MdlMesh {
    /// Index into the skin table (`skin_families[skin][material]`).
    pub material: i32,
    pub vertex_count: i32,
    /// Offset in vertices from the owning model's first vertex.
    pub vertex_offset: i32,
    pub mesh_id: i32,
    /// 1 = eyeball mesh (then `material_param` indexes the model's eyeballs).
    pub material_type: i32,
    pub material_param: i32,
    pub flexes: Vec<MdlFlex>,
}

/// One entry of `mstudiovertanim_t`: the vertex moves by `delta` (its normal by `ndelta`) at full weight.
#[derive(Debug, Clone)]
pub struct VertAnim {
    /// Vertex index within the mesh (`mstudiomesh_t` vertex numbering).
    pub index: u16,
    pub delta: [f32; 3],
    pub ndelta: [f32; 3],
}

/// `mstudioflex_t`: the vertex deltas of one flex descriptor on one mesh, with its weight ramp
/// (`targets`: 0 below target0, rising to 1 at target1, 1 until target2, falling to 0 at target3).
#[derive(Debug, Clone)]
pub struct MdlFlex {
    pub desc: i32,
    pub targets: [f32; 4],
    pub verts: Vec<VertAnim>,
}

/// `mstudioflexcontroller_t`: a named slider with a real-value range.
#[derive(Debug, Clone)]
pub struct FlexController {
    pub name: String,
    pub min: f32,
    pub max: f32,
}

/// `mstudioflexop_t`: one op of a flex rule program (`index` and `value` share storage in the file).
#[derive(Debug, Clone, Copy)]
pub struct FlexOp {
    pub op: i32,
    pub index: i32,
    pub value: f32,
}

/// `mstudioflexrule_t`: computes the weight of flex descriptor `flex` from the controllers.
#[derive(Debug, Clone)]
pub struct FlexRule {
    pub flex: i32,
    pub ops: Vec<FlexOp>,
}

/// `mstudioattachment_t`: a named point on a bone (the "eyes" attachment is where the gaze originates).
#[derive(Debug, Clone)]
pub struct Attachment {
    pub name: String,
    pub bone: i32,
    /// Attachment to bone transform, 3x4 row-major.
    pub local: [f32; 12],
}

/// `mstudioeyeball_t`: an eyeball sphere attached to a bone (bone-space values).
#[derive(Debug, Clone)]
pub struct MdlEyeball {
    pub bone: i32,
    pub org: [f32; 3],
    /// tan(yaw offset) from `$eyeball`; opposite sign for the two eyes.
    pub zoffset: f32,
    pub radius: f32,
    pub up: [f32; 3],
    pub forward: [f32; 3],
    /// Index into `Mdl::textures` of the eyeball material.
    pub texture: i32,
    pub iris_scale: f32,
}

#[derive(Debug, Clone)]
pub struct MdlModel {
    pub name: String,
    pub vertex_count: i32,
    /// Byte offset into the VVD vertex array.
    pub vertex_index: i32,
    pub meshes: Vec<MdlMesh>,
    pub eyeballs: Vec<MdlEyeball>,
}

#[derive(Debug, Clone)]
pub struct MdlBodyPart {
    pub name: String,
    pub base: i32,
    pub models: Vec<MdlModel>,
}

#[derive(Debug, Clone)]
pub struct Mdl {
    pub name: String,
    pub checksum: i32,
    pub bones: Vec<Bone>,
    /// Material names (no directory), indexed by skin-ref value.
    pub textures: Vec<String>,
    pub cd_textures: Vec<String>,
    /// `skin_families[family][skin_ref] -> texture index`.
    pub skin_families: Vec<Vec<i16>>,
    pub body_parts: Vec<MdlBodyPart>,
    /// `$includemodel` paths (animation sources), e.g. `models/player/soldier_animations.mdl`.
    pub include_models: Vec<String>,
    /// Number of flex descriptors (the length of the weight array the rules fill).
    pub flex_desc_count: usize,
    pub flex_controllers: Vec<FlexController>,
    pub flex_rules: Vec<FlexRule>,
    pub attachments: Vec<Attachment>,
}

pub fn parse(data: &[u8]) -> Result<Mdl> {
    let mut r = Reader::new(data);
    if r.bytes(4)? != b"IDST" {
        return fail("not an MDL (missing IDST)");
    }
    let version = r.i32()?;
    // Studio_ConvertStudioHdrToNewVersion preserves the geometry/bone layouts;
    // old shell/gib models only need these fields, not the replaced animation/lighting flags.
    if !(44..=MDL_VERSION).contains(&version) {
        return fail(format!("unsupported MDL version {version} (expected 44–{MDL_VERSION})"));
    }
    let checksum = r.i32()?;
    let name = r.fixed_str(64)?;

    // Header fields we need, by byte offset (see studiohdr_t).
    let h = |off: usize| i32_at(data, off);
    let num_bones = count(h(156)?, "bone", 1024)?;
    let num_textures = count(h(204)?, "texture", 1024)?;
    let texture_index = h(208)? as usize;
    let num_cd = count(h(212)?, "cdtexture", 256)?;
    let cd_index = h(216)? as usize;
    let num_skin_ref = count(h(220)?, "skinref", 1024)?;
    let num_skin_fam = count(h(224)?, "skin family", 256)?;
    let skin_index = h(228)? as usize;
    let num_bodyparts = count(h(232)?, "bodypart", 256)?;
    let bodypart_index = h(236)? as usize;
    let num_include = count(h(336)?, "includemodel", 256)?;
    let include_index = h(340)? as usize;
    let bone_index = h(STUDIOHDR_BONE_INDEX)? as usize;
    let flex_desc_count = count(h(260)?, "flexdesc", 4096)?;
    let num_flex_ctrl = count(h(268)?, "flexcontroller", 1024)?;
    let flex_ctrl_index = h(272)? as usize;
    let num_flex_rules = count(h(276)?, "flexrule", 4096)?;
    let flex_rule_index = h(280)? as usize;
    let num_attachments = count(h(240)?, "attachment", 1024)?;
    let attachment_index = h(244)? as usize;

    let mut bones = Vec::with_capacity(num_bones);
    for i in 0..num_bones {
        let base = bone_index + i * SIZEOF_BONE;
        let mut b = Reader::at(data, base);
        let name_idx = b.i32()?;
        let parent = b.i32()?;
        b.skip(24); // bonecontroller[6]
        let pos = b.f32s::<3>()?;
        let quat = b.f32s::<4>()?;
        let rot = b.f32s::<3>()?;
        b.skip(24); // posscale, rotscale
        let pose_to_bone = b.f32s::<12>()?;
        b.skip(16); // qAlignment
        let flags = b.i32()?;
        let proc_type = b.i32()?;
        let proc_index = b.i32()?;
        let jiggle = if flags & BONE_ALWAYS_PROCEDURAL != 0 && proc_type == STUDIO_PROC_JIGGLE && proc_index != 0 {
            Some(parse_jiggle(data, offset(base, proc_index)?)?)
        } else {
            None
        };
        bones.push(Bone {
            name: cstr_at(data, offset(base, name_idx)?)?,
            parent,
            pos,
            quat,
            rot,
            pose_to_bone,
            flags,
            jiggle,
        });
    }

    let mut textures = Vec::with_capacity(num_textures);
    for i in 0..num_textures {
        let base = texture_index + i * SIZEOF_TEXTURE;
        let name_idx = i32_at(data, base)?;
        textures.push(cstr_at(data, offset(base, name_idx)?)?);
    }

    let mut cd_textures = Vec::with_capacity(num_cd);
    for i in 0..num_cd {
        let str_off = i32_at(data, cd_index + i * 4)?;
        cd_textures.push(cstr_at(data, str_off as usize)?);
    }

    let mut skin_families = Vec::with_capacity(num_skin_fam);
    let mut sr = Reader::at(data, skin_index);
    for _ in 0..num_skin_fam {
        let mut row = Vec::with_capacity(num_skin_ref);
        for _ in 0..num_skin_ref {
            row.push(sr.i16()?);
        }
        skin_families.push(row);
    }

    let mut body_parts = Vec::with_capacity(num_bodyparts);
    for i in 0..num_bodyparts {
        let bp_base = bodypart_index + i * SIZEOF_BODYPART;
        let mut b = Reader::at(data, bp_base);
        let name_idx = b.i32()?;
        let num_models = count(b.i32()?, "model", 256)?;
        let base = b.i32()?;
        let model_index = b.i32()?;
        let mut models = Vec::with_capacity(num_models);
        for j in 0..num_models {
            let m_base = offset(bp_base, model_index)? + j * SIZEOF_MODEL;
            models.push(parse_model(data, m_base)?);
        }
        body_parts.push(MdlBodyPart {
            name: cstr_at(data, offset(bp_base, name_idx)?)?,
            base,
            models,
        });
    }

    let mut include_models = Vec::with_capacity(num_include);
    for i in 0..num_include {
        let base = include_index + i * SIZEOF_MODELGROUP;
        let name_idx = i32_at(data, base + 4)?;
        include_models.push(cstr_at(data, offset(base, name_idx)?)?);
    }

    let mut flex_controllers = Vec::with_capacity(num_flex_ctrl);
    for i in 0..num_flex_ctrl {
        let base = flex_ctrl_index + i * SIZEOF_FLEXCONTROLLER;
        let mut r = Reader::at(data, base);
        r.skip(4); // sztypeindex
        let name_idx = r.i32()?;
        r.skip(4); // localToGlobal (runtime)
        let min = r.f32()?;
        let max = r.f32()?;
        flex_controllers.push(FlexController { name: cstr_at(data, offset(base, name_idx)?)?, min, max });
    }

    let mut flex_rules = Vec::with_capacity(num_flex_rules);
    for i in 0..num_flex_rules {
        let base = flex_rule_index + i * SIZEOF_FLEXRULE;
        let mut r = Reader::at(data, base);
        let flex = r.i32()?;
        let num_ops = count(r.i32()?, "flexop", 4096)?;
        let op_index = r.i32()?;
        let mut ops = Vec::with_capacity(num_ops);
        for j in 0..num_ops {
            let mut o = Reader::at(data, offset(base, op_index)? + j * 8);
            let op = o.i32()?;
            let raw = o.i32()?;
            ops.push(FlexOp { op, index: raw, value: f32::from_bits(raw as u32) });
        }
        flex_rules.push(FlexRule { flex, ops });
    }

    let mut attachments = Vec::with_capacity(num_attachments);
    for i in 0..num_attachments {
        let base = attachment_index + i * SIZEOF_ATTACHMENT;
        let mut r = Reader::at(data, base);
        let name_idx = r.i32()?;
        r.skip(4); // flags
        let bone = r.i32()?;
        let local = r.f32s::<12>()?;
        attachments.push(Attachment { name: cstr_at(data, offset(base, name_idx)?)?, bone, local });
    }

    Ok(Mdl {
        name,
        checksum,
        bones,
        textures,
        cd_textures,
        skin_families,
        body_parts,
        include_models,
        flex_desc_count,
        flex_controllers,
        flex_rules,
        attachments,
    })
}

fn parse_model(data: &[u8], base: usize) -> Result<MdlModel> {
    let mut r = Reader::at(data, base);
    let name = r.fixed_str(64)?;
    r.skip(8); // type, boundingradius
    let num_meshes = count(r.i32()?, "mesh", 1024)?;
    let mesh_index = r.i32()?;
    let vertex_count = r.i32()?;
    let vertex_index = r.i32()?;

    let mut meshes = Vec::with_capacity(num_meshes);
    for k in 0..num_meshes {
        let mb = offset(base, mesh_index)? + k * SIZEOF_MESH;
        let mut m = Reader::at(data, mb);
        let material = m.i32()?;
        m.skip(4); // modelindex
        let vertex_count = m.i32()?;
        let vertex_offset = m.i32()?;
        let num_flexes = count(m.i32()?, "flex", 4096)?;
        let flex_index = m.i32()?;
        let material_type = m.i32()?;
        let material_param = m.i32()?;
        let mesh_id = m.i32()?;
        let mut flexes = Vec::with_capacity(num_flexes);
        for f in 0..num_flexes {
            flexes.push(parse_flex(data, offset(mb, flex_index)? + f * SIZEOF_FLEX)?);
        }
        meshes.push(MdlMesh { material, vertex_count, vertex_offset, mesh_id, material_type, material_param, flexes });
    }
    // numeyeballs / eyeballindex follow tangentsindex, numattachments, attachmentindex.
    let mut e = Reader::at(data, base + 100);
    let num_eyeballs = count(e.i32()?, "eyeball", 16)?;
    let eyeball_index = e.i32()?;
    let mut eyeballs = Vec::with_capacity(num_eyeballs);
    for k in 0..num_eyeballs {
        let mut b = Reader::at(data, offset(base, eyeball_index)? + k * SIZEOF_EYEBALL);
        b.skip(4); // sznameindex
        let bone = b.i32()?;
        let org = b.f32s::<3>()?;
        let zoffset = b.f32()?;
        let radius = b.f32()?;
        let up = b.f32s::<3>()?;
        let forward = b.f32s::<3>()?;
        let texture = b.i32()?;
        b.skip(4); // unused1
        let iris_scale = b.f32()?;
        eyeballs.push(MdlEyeball { bone, org, zoffset, radius, up, forward, texture, iris_scale });
    }
    Ok(MdlModel { name, vertex_count, vertex_index, meshes, eyeballs })
}

fn parse_flex(data: &[u8], base: usize) -> Result<MdlFlex> {
    let mut r = Reader::at(data, base);
    let desc = r.i32()?;
    let targets = r.f32s::<4>()?;
    let num_verts = count(r.i32()?, "flex vertex", 1 << 20)?;
    let vert_index = r.i32()?;
    r.skip(4); // flexpair
    let anim_type = r.bytes(1)?[0];
    // STUDIO_VERT_ANIM_WRINKLE entries carry one extra short after the normal delta.
    let stride = if anim_type == 0 { 16 } else { 18 };
    let start = offset(base, vert_index)?;
    let mut verts = Vec::with_capacity(num_verts);
    for i in 0..num_verts {
        let mut v = Reader::at(data, start + i * stride);
        let index = v.u16()?;
        v.skip(2); // speed, side
        let mut delta = [0.0; 3];
        let mut ndelta = [0.0; 3];
        for d in &mut delta {
            *d = half_to_f32(v.u16()?);
        }
        for d in &mut ndelta {
            *d = half_to_f32(v.u16()?);
        }
        verts.push(VertAnim { index, delta, ndelta });
    }
    Ok(MdlFlex { desc, targets, verts })
}

fn parse_jiggle(data: &[u8], base: usize) -> Result<Jiggle> {
    let mut r = Reader::at(data, base);
    let flags = r.i32()?;
    let length = r.f32()?;
    let tip_mass = r.f32()?;
    let yaw_stiffness = r.f32()?;
    let yaw_damping = r.f32()?;
    let pitch_stiffness = r.f32()?;
    let pitch_damping = r.f32()?;
    let along_stiffness = r.f32()?;
    let along_damping = r.f32()?;
    let angle_limit = r.f32()?;
    let min_yaw = r.f32()?;
    let max_yaw = r.f32()?;
    r.skip(8); // yawFriction, yawBounce (unused by the simulation)
    let min_pitch = r.f32()?;
    let max_pitch = r.f32()?;
    r.skip(8); // pitchFriction, pitchBounce
    let base_mass = r.f32()?;
    let base_stiffness = r.f32()?;
    let base_damping = r.f32()?;
    // left, up, forward: min, max, friction
    let (l, u, f) = (r.f32s::<3>()?, r.f32s::<3>()?, r.f32s::<3>()?);
    let boing = r.f32s::<5>()?;
    Ok(Jiggle {
        flags,
        length,
        tip_mass,
        yaw_stiffness,
        yaw_damping,
        pitch_stiffness,
        pitch_damping,
        along_stiffness,
        along_damping,
        angle_limit,
        min_yaw,
        max_yaw,
        min_pitch,
        max_pitch,
        base_mass,
        base_stiffness,
        base_damping,
        base_min: [l[0], u[0], f[0]],
        base_max: [l[1], u[1], f[1]],
        base_friction: [l[2], u[2], f[2]],
        boing_impact_speed: boing[0],
        boing_impact_angle: boing[1],
        boing_damping_rate: boing[2],
        boing_frequency: boing[3],
        boing_amplitude: boing[4],
    })
}
