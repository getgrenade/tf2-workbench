//! Binary wire format for sending a parsed model to the frontend:
//! `[u32 LE json_len][json][pad to 4][blob]`. The JSON describes every mesh and
//! gives its array offsets (in bytes) into the blob.

use serde::Serialize;
use source_formats::Model;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeshJson<'a> {
    material: &'a str,
    /// Material per skin family (RED, BLU, ...).
    materials: &'a [String],
    flexes: Vec<FlexJson>,
    vertex_count: usize,
    index_count: usize,
    pos: usize,
    normal: usize,
    uv: usize,
    tangent: usize,
    /// 4 x u8 bone indices per vertex.
    skin_index: usize,
    /// 4 x f32 bone weights per vertex.
    skin_weight: usize,
    index: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlexJson {
    desc: u32,
    targets: [f32; 4],
    count: usize,
    /// u32 vertex indices, then f32 xyz deltas, then f32 xyz normal deltas (byte offsets into the blob).
    vertices: usize,
    deltas: usize,
    normal_deltas: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlexControllerJson<'a> {
    name: &'a str,
    min: f32,
    max: f32,
}

#[derive(Serialize)]
struct FlexRuleJson {
    flex: i32,
    /// `[op, operand]` pairs; the operand is the controller / descriptor index, or the constant for CONST.
    ops: Vec<(i32, f32)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EyeballJson<'a> {
    material: &'a str,
    bone: i32,
    origin: [f32; 3],
    radius: f32,
    iris_u: [f32; 4],
    iris_v: [f32; 4],
    bone_origin: [f32; 3],
    bone_up: [f32; 3],
    iris_scale: f32,
    zoffset: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EyeAttachmentJson {
    bone: i32,
    local: [f32; 12],
}

#[derive(Serialize)]
struct SubModelJson<'a> {
    name: &'a str,
    meshes: Vec<MeshJson<'a>>,
    eyeballs: Vec<EyeballJson<'a>>,
}

#[derive(Serialize)]
struct BodyPartJson<'a> {
    name: &'a str,
    models: Vec<SubModelJson<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoneJson<'a> {
    name: &'a str,
    parent: i32,
    /// World -> bone bind transform (3x4, row-major).
    pose_to_bone: [f32; 12],
    jiggle: Option<JiggleJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JiggleJson {
    flags: i32,
    length: f32,
    tip_mass: f32,
    yaw_stiffness: f32,
    yaw_damping: f32,
    pitch_stiffness: f32,
    pitch_damping: f32,
    along_stiffness: f32,
    along_damping: f32,
    angle_limit: f32,
    min_yaw: f32,
    max_yaw: f32,
    yaw_friction: f32,
    yaw_bounce: f32,
    min_pitch: f32,
    max_pitch: f32,
    pitch_friction: f32,
    pitch_bounce: f32,
    base_mass: f32,
    base_stiffness: f32,
    base_damping: f32,
    base_min: [f32; 3],
    base_max: [f32; 3],
    base_friction: [f32; 3],
    boing_impact_speed: f32,
    boing_impact_angle: f32,
    boing_damping_rate: f32,
    boing_frequency: f32,
    boing_amplitude: f32,
}

impl From<&source_formats::mdl::Jiggle> for JiggleJson {
    fn from(j: &source_formats::mdl::Jiggle) -> Self {
        JiggleJson {
            flags: j.flags,
            length: j.length,
            tip_mass: j.tip_mass,
            yaw_stiffness: j.yaw_stiffness,
            yaw_damping: j.yaw_damping,
            pitch_stiffness: j.pitch_stiffness,
            pitch_damping: j.pitch_damping,
            along_stiffness: j.along_stiffness,
            along_damping: j.along_damping,
            angle_limit: j.angle_limit,
            min_yaw: j.min_yaw,
            max_yaw: j.max_yaw,
            yaw_friction: j.yaw_friction,
            yaw_bounce: j.yaw_bounce,
            min_pitch: j.min_pitch,
            max_pitch: j.max_pitch,
            pitch_friction: j.pitch_friction,
            pitch_bounce: j.pitch_bounce,
            base_mass: j.base_mass,
            base_stiffness: j.base_stiffness,
            base_damping: j.base_damping,
            base_min: j.base_min,
            base_max: j.base_max,
            base_friction: j.base_friction,
            boing_impact_speed: j.boing_impact_speed,
            boing_impact_angle: j.boing_impact_angle,
            boing_damping_rate: j.boing_damping_rate,
            boing_frequency: j.boing_frequency,
            boing_amplitude: j.boing_amplitude,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelJson<'a> {
    path: &'a str,
    bones: Vec<BoneJson<'a>>,
    include_models: &'a [String],
    body_parts: Vec<BodyPartJson<'a>>,
    flex_desc_count: usize,
    flex_controllers: Vec<FlexControllerJson<'a>>,
    flex_rules: Vec<FlexRuleJson>,
    skin_count: usize,
    lod: usize,
    lod_count: usize,
    eye_attachment: Option<EyeAttachmentJson>,
}

fn align4(v: &mut Vec<u8>) {
    while v.len() % 4 != 0 {
        v.push(0);
    }
}

fn push_f32(blob: &mut Vec<u8>, data: &[f32]) -> usize {
    align4(blob);
    let at = blob.len();
    blob.reserve(data.len() * 4);
    for f in data {
        blob.extend_from_slice(&f.to_le_bytes());
    }
    at
}

fn push_u8(blob: &mut Vec<u8>, data: &[u8]) -> usize {
    align4(blob);
    let at = blob.len();
    blob.extend_from_slice(data);
    at
}

fn push_u32(blob: &mut Vec<u8>, data: &[u32]) -> usize {
    align4(blob);
    let at = blob.len();
    blob.reserve(data.len() * 4);
    for u in data {
        blob.extend_from_slice(&u.to_le_bytes());
    }
    at
}

pub fn encode(model: &Model) -> Vec<u8> {
    let mut blob = Vec::new();
    let mut body_parts = Vec::new();
    for bp in &model.body_parts {
        let mut models = Vec::new();
        for sub in &bp.models {
            let mut meshes = Vec::new();
            for m in &sub.meshes {
                let flexes = m
                    .flexes
                    .iter()
                    .map(|f| FlexJson {
                        desc: f.desc,
                        targets: f.targets,
                        count: f.vertices.len(),
                        vertices: push_u32(&mut blob, &f.vertices),
                        deltas: push_f32(&mut blob, &f.deltas),
                        normal_deltas: push_f32(&mut blob, &f.normal_deltas),
                    })
                    .collect();
                meshes.push(MeshJson {
                    material: &m.material,
                    materials: &m.materials,
                    flexes,
                    vertex_count: m.vertex_count(),
                    index_count: m.indices.len(),
                    pos: push_f32(&mut blob, &m.positions),
                    normal: push_f32(&mut blob, &m.normals),
                    uv: push_f32(&mut blob, &m.uvs),
                    tangent: push_f32(&mut blob, &m.tangents),
                    skin_index: push_u8(&mut blob, &m.bone_indices),
                    skin_weight: push_f32(&mut blob, &m.bone_weights),
                    index: push_u32(&mut blob, &m.indices),
                });
            }
            let eyeballs = sub
                .eyeballs
                .iter()
                .map(|e| EyeballJson { material: &e.material, bone: e.bone, origin: e.origin, radius: e.radius, iris_u: e.iris_u, iris_v: e.iris_v, bone_origin: e.bone_origin, bone_up: e.bone_up, iris_scale: e.iris_scale, zoffset: e.zoffset })
                .collect();
            models.push(SubModelJson { name: &sub.name, meshes, eyeballs });
        }
        body_parts.push(BodyPartJson { name: &bp.name, models });
    }
    let json = serde_json::to_vec(&ModelJson {
        path: &model.path,
        bones: model.bones.iter().map(|b| BoneJson { name: &b.name, parent: b.parent, pose_to_bone: b.pose_to_bone, jiggle: b.jiggle.as_ref().map(JiggleJson::from) }).collect(),
        include_models: &model.include_models,
        body_parts,
        flex_desc_count: model.flex_desc_count,
        flex_controllers: model.flex_controllers.iter().map(|c| FlexControllerJson { name: &c.name, min: c.min, max: c.max }).collect(),
        flex_rules: model
            .flex_rules
            .iter()
            .map(|r| FlexRuleJson {
                flex: r.flex,
                // STUDIO_CONST carries a float; every other op carries an integer index.
                ops: r.ops.iter().map(|o| (o.op, if o.op == 1 { o.value } else { o.index as f32 })).collect(),
            })
            .collect(),
        skin_count: model.skin_count,
        lod: model.lod,
        lod_count: model.lod_count,
        eye_attachment: model.eye_attachment.as_ref().map(|a| EyeAttachmentJson { bone: a.bone, local: a.local }),
    })
    .expect("model json");

    let mut out = Vec::with_capacity(4 + json.len() + 4 + blob.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    align4(&mut out);
    out.extend_from_slice(&blob);
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextureJson<'a> {
    slot: &'a str,
    width: u32,
    height: u32,
    clamp_s: bool,
    clamp_t: bool,
    /// Byte offset of the RGBA8 pixels in the blob.
    offset: usize,
}

#[derive(Serialize)]
struct ProxyJson<'a> {
    name: &'a str,
    params: &'a std::collections::HashMap<String, String>,
}

#[derive(Serialize)]
struct MaterialJson<'a> {
    path: &'a str,
    shader: &'a str,
    params: &'a std::collections::HashMap<String, String>,
    proxies: Vec<ProxyJson<'a>>,
    textures: Vec<TextureJson<'a>>,
    errors: &'a [String],
}

/// Material wire format: `[u32 LE json_len][json][pad to 4][RGBA8 pixel blocks]`.
pub fn encode_material(m: &source_formats::Material) -> Vec<u8> {
    let mut blob = Vec::new();
    let textures = m
        .textures
        .iter()
        .map(|(slot, img)| {
            align4(&mut blob);
            let offset = blob.len();
            blob.extend_from_slice(&img.rgba);
            TextureJson { slot, width: img.width, height: img.height, clamp_s: img.flags & 0x4 != 0, clamp_t: img.flags & 0x8 != 0, offset }
        })
        .collect();
    let json = serde_json::to_vec(&MaterialJson {
        path: &m.path,
        shader: &m.shader,
        params: &m.params,
        proxies: m.proxies.iter().map(|p| ProxyJson { name: &p.name, params: &p.params }).collect(),
        textures,
        errors: &m.errors,
    })
    .expect("material json");
    let mut out = Vec::with_capacity(8 + json.len() + blob.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    align4(&mut out);
    out.extend_from_slice(&blob);
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SeqJson {
    index: usize,
    name: String,
    frames: i32,
    fps: f32,
    looping: bool,
    hidden: bool,
    /// The authored activity (`ACT_MP_THROW`), empty for a sequence that has none.
    activity: String,
    /// A taunt's part of the cycle (0..1) outside the blends in and out of it (see `taunt_window`).
    #[serde(skip_serializing_if = "Option::is_none")]
    window: Option<[f32; 2]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PoseParamJson<'a> {
    name: &'a str,
    start: f32,
    end: f32,
    looping: f32,
    /// Encoded (0..1) default, `Studio_CalcDefaultPoseParameters`.
    default: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimInfoJson<'a> {
    sequences: Vec<SeqJson>,
    pose_params: Vec<PoseParamJson<'a>>,
}

/// Sequence list and pose parameters of an animation set, as JSON.
pub fn encode_anim_info(set: &source_formats::anim::AnimSet) -> Vec<u8> {
    let defaults = set.default_pose_params();
    let info = AnimInfoJson {
        sequences: set
            .sequences()
            .into_iter()
            .map(|s| { let activity = set.activity_name(s.index); SeqJson { index: s.index, name: s.name, frames: s.frames, fps: s.fps, looping: s.looping, hidden: s.hidden, activity, window: set.taunt_window(s.index).map(|(a, b)| [a, b]) } })
            .collect(),
        pose_params: set
            .pose_params
            .iter()
            .zip(&defaults)
            .map(|(p, &d)| PoseParamJson { name: &p.name, start: p.start, end: p.end, looping: p.looping, default: d })
            .collect(),
    };
    serde_json::to_vec(&info).expect("anim info json")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipJson {
    fps: f32,
    looping: bool,
    frames: usize,
    num_bones: usize,
}

/// Clip wire format: `[u32 LE json_len][json][pad to 4][pos f32 * frames*bones*3][quat f32 * frames*bones*4]`.
pub fn encode_clip(clip: &source_formats::anim::Clip) -> Vec<u8> {
    let json = serde_json::to_vec(&ClipJson { fps: clip.fps, looping: clip.looping, frames: clip.frames, num_bones: clip.num_bones })
        .expect("clip json");
    let mut out = Vec::with_capacity(8 + json.len() + (clip.pos.len() + clip.quat.len()) * 4);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    align4(&mut out);
    for f in clip.pos.iter().chain(&clip.quat) {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleJson<'a> {
    name: &'a str,
    model: Option<&'a str>,
    per_class: &'a std::collections::BTreeMap<String, String>,
    skin_red: Option<i32>,
    skin_blu: Option<i32>,
    image: Option<&'a str>,
    bodygroups: &'a std::collections::BTreeMap<String, i32>,
}

/// A particle effect an item always shows: by the game's effect id, or a system by name at an attachment of the item.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParticleJson<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    effect: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemJson<'a> {
    anim_slot: &'a str,
    base_item: bool,
    pose_params: &'a std::collections::BTreeMap<String, f32>,
    extra_models: &'a [String],
    class_slots: &'a std::collections::BTreeMap<String, String>,
    styles: Vec<StyleJson<'a>>,
    id: u32,
    name: &'a str,
    display_name: &'a str,
    slot: &'a str,
    classes: &'a [String],
    model: Option<&'a str>,
    per_class: &'a std::collections::BTreeMap<String, String>,
    image: Option<&'a str>,
    bodygroups: &'a std::collections::BTreeMap<String, i32>,
    equip_regions: &'a [String],
    paintable: bool,
    /// Wearing the item puts the character in the zombie skin (the Voodoo-Cursed souls).
    skin_override: bool,
    /// The particle effects the item always shows.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    particles: Vec<ParticleJson<'a>>,
    medal: bool,
    quality: &'a str,
    taunt_scenes: &'a std::collections::BTreeMap<String, String>,
    taunt_prop_scenes: &'a std::collections::BTreeMap<String, String>,
    taunt_scene_paths: &'a std::collections::BTreeMap<String, String>,
    workshop: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaintJson<'a> {
    id: u32,
    name: &'a str,
    display_name: &'a str,
    /// Packed 0xRRGGBB.
    rgb: u32,
    rgb2: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemDbJson<'a> {
    items: Vec<ItemJson<'a>>,
    weapons: Vec<ItemJson<'a>>,
    taunts: Vec<ItemJson<'a>>,
    paints: Vec<PaintJson<'a>>,
    equip_conflicts: &'a std::collections::BTreeMap<String, Vec<String>>,
}

fn item_json(i: &source_formats::items::Item) -> ItemJson<'_> {
    ItemJson {
        id: i.id,
        name: &i.name,
        display_name: &i.display_name,
        slot: &i.slot,
        anim_slot: &i.anim_slot,
        base_item: i.base_item,
        pose_params: &i.pose_params,
        extra_models: &i.extra_models,
        class_slots: &i.class_slots,
        classes: &i.classes,
        model: i.model.as_deref(),
        per_class: &i.per_class,
        image: i.image.as_deref(),
        bodygroups: &i.bodygroups,
        equip_regions: &i.equip_regions,
        paintable: i.paintable,
        skin_override: i.skin_override,
        particles: i.particles.iter().map(|p| ParticleJson { effect: p.effect, system: p.system.as_deref(), attachment: p.attachment.as_deref() }).collect(),
        medal: i.is_medal(),
        quality: &i.quality,
        taunt_scenes: &i.taunt_scenes,
        taunt_prop_scenes: &i.taunt_prop_scenes,
        taunt_scene_paths: &i.taunt_scene_paths,
        workshop: i.workshop,
        styles: i
            .styles
            .iter()
            .map(|s| StyleJson { name: &s.name, model: s.model.as_deref(), per_class: &s.per_class, skin_red: s.skin_red, skin_blu: s.skin_blu, image: s.image.as_deref(), bodygroups: &s.bodygroups })
            .collect(),
    }
}

/// The cosmetics and weapons catalog as JSON bytes.
pub fn encode_items(db: &source_formats::items::ItemDb) -> Vec<u8> {
    let items = db.items.iter().map(item_json).collect();
    let weapons = db.weapons.iter().map(item_json).collect();
    let taunts = db.taunts.iter().map(item_json).collect();
    let paints = db
        .paints
        .iter()
        .map(|p| PaintJson { id: p.id, name: &p.name, display_name: &p.display_name, rgb: p.rgb, rgb2: p.rgb2 })
        .collect();
    serde_json::to_vec(&ItemDbJson { items, weapons, taunts, paints, equip_conflicts: &db.equip_conflicts }).expect("items json")
}
