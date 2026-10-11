//! Assembles MDL + VVD + VTX into renderable meshes.

use std::collections::HashMap;

use crate::{
    binary::ParseError,
    mdl::{self, Bone, Mdl},
    vpk::{VpkError, VpkSet},
    vtx, vvd,
};

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error(transparent)]
    Vpk(#[from] VpkError),
    #[error("{path}: {source}")]
    Parse { path: String, source: ParseError },
}

fn parse_err(path: &str) -> impl FnOnce(ParseError) -> ModelError + '_ {
    move |source| ModelError::Parse { path: path.to_string(), source }
}

/// One drawable mesh (one material). Triangles are emitted counter-clockwise
/// in Source's right-handed Z-up space.
#[derive(Debug, Default)]
pub struct Mesh {
    /// Resolved material path (e.g. `materials/models/player/soldier/soldier_red.vmt`).
    pub material: String,
    /// Resolved material per skin family (`materials[0] == material`): index 0 is RED, 1 is BLU.
    pub materials: Vec<String>,
    /// Flex deltas on this mesh, already mapped to this mesh's vertex numbering.
    pub flexes: Vec<MeshFlex>,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    /// xyzw per vertex; w is the bitangent sign (binormal = cross(normal, tangent.xyz) * w).
    pub tangents: Vec<f32>,
    /// 4 bone indices per vertex (unused slots are 0 with weight 0).
    pub bone_indices: Vec<u8>,
    pub bone_weights: Vec<f32>,
    pub indices: Vec<u32>,
}

/// The vertex deltas of one flex descriptor on a mesh (see `mdl::MdlFlex`).
#[derive(Debug, Clone)]
pub struct MeshFlex {
    pub desc: u32,
    pub targets: [f32; 4],
    /// Index into this mesh's vertices.
    pub vertices: Vec<u32>,
    /// xyz per entry of `vertices`.
    pub deltas: Vec<f32>,
    pub normal_deltas: Vec<f32>,
}

impl Mesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
}

/// An eyeball in bind-pose space with the constants the `EyeRefract` shader needs.
///
/// `iris_u` / `iris_v` are plane equations: `dot(iris_u, (pos, 1))` gives the cornea UV.
/// Valve computes these in the closed-source StudioRender; this is a reconstruction from
/// the MDL eyeball data (see `eyeball_state`), not a port.
#[derive(Debug, Clone)]
pub struct Eyeball {
    /// Resolved material path of the eyeball mesh.
    pub material: String,
    /// Bone the eyeball is attached to (its constants are bind-pose values for this bone).
    pub bone: i32,
    pub origin: [f32; 3],
    pub radius: f32,
    pub iris_u: [f32; 4],
    pub iris_v: [f32; 4],
    /// Eyeball origin and up vector in the bone's space (what the gaze is computed from at runtime).
    pub bone_origin: [f32; 3],
    pub bone_up: [f32; 3],
    /// 1 / QC pupil scale: the cornea UV spans `1 / iris_scale` world units.
    pub iris_scale: f32,
    /// tan of the QC yaw offset (opposite sign for the two eyes): turns the eye outward from the gaze direction.
    pub zoffset: f32,
}

/// The "eyes" attachment: the gaze target is 32 units in front of it (hlmv `StudioModel::SetViewTarget`).
#[derive(Debug, Clone)]
pub struct EyeAttachment {
    pub bone: i32,
    /// Attachment to bone transform, 3x4 row-major.
    pub local: [f32; 12],
}

#[derive(Debug)]
pub struct SubModel {
    pub name: String,
    pub meshes: Vec<Mesh>,
    pub eyeballs: Vec<Eyeball>,
}

#[derive(Debug)]
pub struct BodyPart {
    pub name: String,
    pub models: Vec<SubModel>,
}

#[derive(Debug)]
pub struct Model {
    pub path: String,
    pub name: String,
    pub bones: Vec<Bone>,
    pub include_models: Vec<String>,
    pub body_parts: Vec<BodyPart>,
    /// Number of flex descriptors; flex rules fill this many weights.
    pub flex_desc_count: usize,
    pub flex_controllers: Vec<mdl::FlexController>,
    pub flex_rules: Vec<mdl::FlexRule>,
    /// Number of skin families (team skins): 1 for models without a BLU variant.
    pub skin_count: usize,
    pub eye_attachment: Option<EyeAttachment>,
    /// The LOD these meshes are (0 is the full model) and how many the model has; a request past the last one gets the last.
    pub lod: usize,
    pub lod_count: usize,
}

/// Loads `models/.../x.mdl` with its `.vvd` and `.dx90.vtx` from the VPKs.
pub fn load(vpk: &VpkSet, mdl_path: &str) -> Result<Model, ModelError> {
    load_lod(vpk, mdl_path, 0)
}

/// The model at one of its LODs (clamped to the last): the strip groups of that LOD over the whole vertex pool, which is how the
/// engine draws a LOD. What the QC's `$lod` blocks did to it is already in the file: `replacemodel` gave it meshes of its own,
/// `bonetreecollapse` and `replacebone` moved the weights of the collapsed bones onto their parents, and `nofacial` left
/// the flexes off its strip groups (so a mesh keeps its flexes only while the LOD still flexes it).
pub fn load_lod(vpk: &VpkSet, mdl_path: &str, lod: usize) -> Result<Model, ModelError> {
    let stem = mdl_path
        .strip_suffix(".mdl")
        .or_else(|| mdl_path.strip_suffix(".MDL"))
        .unwrap_or(mdl_path);
    let mdl_bytes = vpk.read(&format!("{stem}.mdl"))?;
    let vvd_bytes = vpk.read(&format!("{stem}.vvd"))?;
    let vtx_path = ["dx90", "dx80", "sw"]
        .iter()
        .map(|v| format!("{stem}.{v}.vtx"))
        .find(|p| vpk.contains(p))
        .ok_or_else(|| VpkError::NotFound(format!("{stem}.dx90.vtx")))?;
    let vtx_bytes = vpk.read(&vtx_path)?;

    let mdl = mdl::parse(&mdl_bytes).map_err(parse_err(mdl_path))?;
    let vvd = vvd::parse(&vvd_bytes, 0).map_err(parse_err(&format!("{stem}.vvd")))?;
    // the LODs drawn in the world: a shadow LOD (negative switch point) comes last and is left out
    let total = vtx::lod_count(&vtx_bytes).map_err(parse_err(&vtx_path))?.max(1);
    let lod_count = vtx::lod_switch_points(&vtx_bytes).map(|p| p.iter().take_while(|s| **s >= 0.0).count()).unwrap_or(total).clamp(1, total);
    let lod = lod.min(lod_count - 1);
    let vtx = vtx::parse(&vtx_bytes, lod).map_err(parse_err(&vtx_path))?;
    let resolve = |name: &str, cds: &[String]| resolve_material(vpk, name, cds);
    let mut model = build(mdl_path, &mdl, &vvd, &vtx, &resolve).map_err(parse_err(mdl_path))?;
    model.lod = lod;
    model.lod_count = lod_count;
    if lod > 0 { drop_unflexed(&mut model, &vtx); }
    Ok(model)
}

/// A mesh whose strip groups are not flagged as flexed at this LOD has no flexes (what `nofacial` does).
fn drop_unflexed(model: &mut Model, vtx: &vtx::Vtx) {
    for (bp, vbp) in model.body_parts.iter_mut().zip(&vtx.body_parts) {
        for (sub, vmodel) in bp.models.iter_mut().zip(vbp) {
            for (mesh, groups) in sub.meshes.iter_mut().zip(vmodel) {
                let flexed = groups.iter().any(|g| g.flags & (vtx::STRIPGROUP_IS_FLEXED | vtx::STRIPGROUP_IS_DELTA_FLEXED) != 0);
                if !flexed { mesh.flexes.clear(); }
            }
        }
    }
}

fn resolve_material(vpk: &VpkSet, name: &str, cd_textures: &[String]) -> String {
    for cd in cd_textures {
        // cdmaterials entries can start with a separator ("\models\..." on some team skins); the engine skips it.
        let mut dir = cd.replace('\\', "/").trim_start_matches('/').to_string();
        if !dir.is_empty() && !dir.ends_with('/') {
            dir.push('/');
        }
        let path = format!("materials/{dir}{name}.vmt").to_ascii_lowercase();
        if vpk.contains(&path) {
            return path;
        }
    }
    name.to_string()
}

/// Pure assembly step, separate from I/O so it can be tested on raw bytes.
pub fn build(
    path: &str,
    mdl: &Mdl,
    vvd: &vvd::Vvd,
    vtx: &vtx::Vtx,
    resolve: &dyn Fn(&str, &[String]) -> String,
) -> Result<Model, ParseError> {
    if vtx.body_parts.len() != mdl.body_parts.len() {
        return Err(ParseError(format!(
            "bodypart count mismatch: mdl {} vs vtx {}",
            mdl.body_parts.len(),
            vtx.body_parts.len()
        )));
    }
    let mut body_parts = Vec::new();
    for (bp, vbp) in mdl.body_parts.iter().zip(&vtx.body_parts) {
        let mut models = Vec::new();
        for (model, vmodel) in bp.models.iter().zip(vbp) {
            let model_base = model.vertex_index as usize / 48;
            let mut meshes = Vec::new();
            for (mesh, groups) in model.meshes.iter().zip(vmodel) {
                let family_material = |family: Option<&Vec<i16>>| {
                    let tex = family
                        .and_then(|s| s.get(mesh.material as usize))
                        .map(|&t| t as usize)
                        .unwrap_or(mesh.material.max(0) as usize);
                    resolve(mdl.textures.get(tex).map(String::as_str).unwrap_or(""), &mdl.cd_textures)
                };
                let materials: Vec<String> = if mdl.skin_families.is_empty() {
                    vec![family_material(None)]
                } else {
                    mdl.skin_families.iter().map(|f| family_material(Some(f))).collect()
                };
                let mut out = Mesh { material: materials[0].clone(), materials, ..Default::default() };
                let first = model_base + mesh.vertex_offset as usize;
                let mut remap: HashMap<usize, u32> = HashMap::new();
                for g in groups {
                    for tri in g.triangles().chunks_exact(3) {
                        let mut ids = [0u32; 3];
                        for (slot, &local) in ids.iter_mut().zip(tri) {
                            let global = first + g.orig_mesh_vert_ids[local as usize] as usize;
                            *slot = match remap.get(&global) {
                                Some(&i) => i,
                                None => {
                                    let v = vvd.vertices.get(global).ok_or_else(|| {
                                        ParseError(format!(
                                            "vertex {global} out of range ({})",
                                            vvd.vertices.len()
                                        ))
                                    })?;
                                    let i = out.vertex_count() as u32;
                                    push_vertex(&mut out, v, vvd.tangents[global]);
                                    remap.insert(global, i);
                                    i
                                }
                            };
                        }
                        // Source winds clockwise; flip to counter-clockwise.
                        out.indices.extend_from_slice(&[ids[0], ids[2], ids[1]]);
                    }
                }
                for flex in &mesh.flexes {
                    let mut mf = MeshFlex { desc: flex.desc.max(0) as u32, targets: flex.targets, vertices: Vec::new(), deltas: Vec::new(), normal_deltas: Vec::new() };
                    for v in &flex.verts {
                        // Flexes index the mesh's own vertices; only those used by the LOD 0 triangles exist here.
                        if let Some(&i) = remap.get(&(first + v.index as usize)) {
                            mf.vertices.push(i);
                            mf.deltas.extend_from_slice(&v.delta);
                            mf.normal_deltas.extend_from_slice(&v.ndelta);
                        }
                    }
                    if !mf.vertices.is_empty() {
                        out.flexes.push(mf);
                    }
                }
                meshes.push(out);
            }
            // Eyeball meshes carry `material_type == 1` and the eyeball index in `material_param`.
            let eyeballs = model
                .meshes
                .iter()
                .zip(&meshes)
                .filter(|(src, _)| src.material_type == 1)
                .filter_map(|(src, built)| {
                    let e = model.eyeballs.get(src.material_param as usize)?;
                    let bone = mdl.bones.get(e.bone as usize)?;
                    Some(eyeball_state(e, bone, built.material.clone()))
                })
                .collect();
            models.push(SubModel { name: model.name.clone(), meshes, eyeballs });
        }
        body_parts.push(BodyPart { name: bp.name.clone(), models });
    }
    Ok(Model {
        path: path.to_string(),
        name: mdl.name.clone(),
        bones: mdl.bones.clone(),
        include_models: mdl.include_models.clone(),
        body_parts,
        flex_desc_count: mdl.flex_desc_count,
        flex_controllers: mdl.flex_controllers.clone(),
        flex_rules: mdl.flex_rules.clone(),
        skin_count: mdl.skin_families.len().max(1),
        eye_attachment: mdl
            .attachments
            .iter()
            .find(|a| a.name.eq_ignore_ascii_case("eyes"))
            .map(|a| EyeAttachment { bone: a.bone, local: a.local }),
        lod: 0,
        lod_count: 1,
    })
}

fn push_vertex(out: &mut Mesh, v: &vvd::Vertex, tangent: [f32; 4]) {
    out.tangents.extend_from_slice(&tangent);
    out.positions.extend_from_slice(&v.pos);
    out.normals.extend_from_slice(&v.normal);
    out.uvs.extend_from_slice(&v.uv);
    let n = (v.num_bones as usize).min(3);
    for i in 0..4 {
        if i < n {
            out.bone_indices.push(v.bones[i]);
            out.bone_weights.push(v.weights[i]);
        } else {
            out.bone_indices.push(0);
            out.bone_weights.push(0.0);
        }
    }
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn norm3(a: [f32; 3]) -> [f32; 3] {
    let l = dot3(a, a).sqrt().max(1e-12);
    [a[0] / l, a[1] / l, a[2] / l]
}

/// Builds the eye shader constants for one eyeball in bind-pose space.
///
/// Known from the MDL: `radius`, `iris_scale` (= 1 / QC pupil scale) and `zoffset`
/// (= tan of the QC yaw offset, opposite sign per eye). Reconstructed assumptions:
/// - the cornea UV spans a world length of `1 / iris_scale` (independent of the eyeball radius), so the
///   iris (UV radius 0.2 of the sphere UV, i.e. 0.4 of the cornea UV) has diameter `0.8 / iris_scale`
///   = 0.48 units for the usual `iris_scale` of 1.667. Calibrated against hlmv screenshots of the Heavy
///   (radius 0.9) and Spy (radius 0.7): iris is ~0.5 of the eye-opening width on both, which a radius-
///   dependent scale cannot produce;
/// - the projection frame has axes `+left` (U) and `-up` (V): texture u runs toward the character's
///   left, v runs downward, like an image seen from the front. This keeps U aligned with the
///   shader's tangent (`cross(up, normal)`); the opposite sign mirrors the cornea normal map;
/// - a positive `zoffset` turns the eye toward `left` (toe-in for the eye on the character's right).
fn eyeball_state(e: &crate::mdl::MdlEyeball, bone: &Bone, material: String) -> Eyeball {
    // poseToBone is world -> bone; invert the rigid transform to get bone -> world.
    let m = &bone.pose_to_bone;
    let rot = |v: [f32; 3]| -> [f32; 3] {
        // R_world = transpose(M3)
        [
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
        ]
    };
    let t = rot([m[3], m[7], m[11]]);
    let r = rot(e.org);
    let origin = [r[0] - t[0], r[1] - t[1], r[2] - t[2]];

    let up = norm3(rot(e.up));
    let fwd = norm3(rot(e.forward));
    let left = cross3(up, fwd);
    let fwd2 = norm3([
        fwd[0] + left[0] * e.zoffset,
        fwd[1] + left[1] * e.zoffset,
        fwd[2] + left[2] * e.zoffset,
    ]);
    let left2 = norm3(cross3(up, fwd2));

    let s = e.iris_scale;
    let u = [left2[0] * s, left2[1] * s, left2[2] * s];
    let v = [-up[0] * s, -up[1] * s, -up[2] * s];
    Eyeball {
        material,
        bone: e.bone,
        origin,
        radius: e.radius,
        iris_u: [u[0], u[1], u[2], 0.5 - dot3(u, origin)],
        iris_v: [v[0], v[1], v[2], 0.5 - dot3(v, origin)],
        bone_origin: e.org,
        bone_up: e.up,
        iris_scale: e.iris_scale,
        zoffset: e.zoffset,
    }
}
