//! Optimized mesh data (`.dx90.vtx`) v7: per-LOD strip groups with triangle
//! indices. Structures are `#pragma pack(1)` in the SDK (`optimize.h`).

use crate::binary::{count, fail, offset, Reader, Result};

const SIZEOF_BODYPART: usize = 8;
const SIZEOF_MODEL: usize = 8;
const SIZEOF_LOD: usize = 12;
const SIZEOF_MESH: usize = 9;
const SIZEOF_VERTEX: usize = 9;
const SIZEOF_STRIP: usize = 27;
/// Strip group header: 25 bytes in the 2013 SDK; newer builds append topology
/// fields (33 bytes). Both are tried.
const STRIPGROUP_SIZES: [usize; 2] = [25, 33];

pub const STRIP_IS_TRILIST: u8 = 0x01;
pub const STRIP_IS_TRISTRIP: u8 = 0x02;
/// StripGroupFlags_t: a strip group of a mesh that has flexes is flagged when the flexes apply at this LOD.
pub const STRIPGROUP_IS_FLEXED: u8 = 0x01;
pub const STRIPGROUP_IS_DELTA_FLEXED: u8 = 0x04;

#[derive(Debug, Clone)]
pub struct Strip {
    pub index_offset: usize,
    pub num_indices: usize,
    pub flags: u8,
}

#[derive(Debug, Clone, Default)]
pub struct StripGroup {
    /// For each strip-group vertex, its index within the owning mesh (`origMeshVertID`).
    pub orig_mesh_vert_ids: Vec<u16>,
    /// Indices into `orig_mesh_vert_ids`.
    pub indices: Vec<u16>,
    pub strips: Vec<Strip>,
    /// StripGroupFlags_t.
    pub flags: u8,
}

impl StripGroup {
    /// Triangle list of strip-group-local indices, flattened (3 per triangle).
    pub fn triangles(&self) -> Vec<u16> {
        let mut out = Vec::with_capacity(self.indices.len());
        for s in &self.strips {
            let idx = &self.indices[s.index_offset..s.index_offset + s.num_indices];
            if s.flags & STRIP_IS_TRISTRIP != 0 {
                for i in 2..idx.len() {
                    let (a, b, c) = (idx[i - 2], idx[i - 1], idx[i]);
                    if a == b || b == c || a == c {
                        continue; // degenerate
                    }
                    if i % 2 == 0 {
                        out.extend_from_slice(&[a, b, c]);
                    } else {
                        out.extend_from_slice(&[b, a, c]);
                    }
                }
            } else {
                out.extend_from_slice(idx);
            }
        }
        out
    }
}

#[derive(Debug)]
pub struct Vtx {
    pub checksum: i32,
    /// `[body part][model][mesh]` -> strip groups, for the requested LOD.
    pub body_parts: Vec<Vec<Vec<Vec<StripGroup>>>>,
}

/// How many LODs the file has (the `$lod` blocks of the QC, plus the top one).
pub fn lod_count(data: &[u8]) -> Result<usize> {
    let mut r = Reader::new(data);
    let version = r.i32()?;
    if version != 7 { return fail(format!("unsupported VTX version {version}")); }
    r.skip(4 + 2 + 2 + 4 + 4);
    count(r.i32()?, "LOD", 16)
}

/// The switch point of each LOD (ModelLODHeader_t::switchPoint of the first model): the distance metric at which the LOD takes over.
/// A negative one marks the shadow LOD of a `$shadowlod`, which is never drawn in the world.
pub fn lod_switch_points(data: &[u8]) -> Result<Vec<f32>> {
    let mut r = Reader::new(data);
    let version = r.i32()?;
    if version != 7 { return fail(format!("unsupported VTX version {version}")); }
    r.skip(4 + 2 + 2 + 4 + 4);
    let lods = count(r.i32()?, "LOD", 16)?;
    r.skip(4);
    let bodyparts = count(r.i32()?, "bodypart", 256)?;
    let bodypart_offset = r.i32()? as usize;
    if bodyparts == 0 { return Ok(vec![0.0; lods]); }
    let mut b = Reader::at(data, bodypart_offset);
    let models = count(b.i32()?, "model", 256)?;
    let model_offset = b.i32()?;
    if models == 0 { return Ok(vec![0.0; lods]); }
    let mp = offset(bodypart_offset, model_offset)?;
    let mut m = Reader::at(data, mp);
    let _n = m.i32()?;
    let lod_offset = m.i32()?;
    let base = offset(mp, lod_offset)?;
    (0..lods).map(|i| {
        let mut l = Reader::at(data, base + i * SIZEOF_LOD);
        l.skip(8);
        l.f32()
    }).collect()
}

pub fn parse(data: &[u8], lod: usize) -> Result<Vtx> {
    let mut last_err = None;
    for size in STRIPGROUP_SIZES {
        match parse_with(data, lod, size) {
            Ok(v) => return Ok(v),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap())
}

fn parse_with(data: &[u8], lod: usize, sg_size: usize) -> Result<Vtx> {
    let mut r = Reader::new(data);
    let version = r.i32()?;
    if version != 7 {
        return fail(format!("unsupported VTX version {version}"));
    }
    r.skip(4); // vertCacheSize
    r.skip(2 + 2 + 4); // maxBonesPerStrip, maxBonesPerTri, maxBonesPerVert
    let checksum = r.i32()?;
    let num_lods = count(r.i32()?, "LOD", 16)?;
    r.skip(4); // materialReplacementListOffset
    let num_bodyparts = count(r.i32()?, "bodypart", 256)?;
    let bodypart_offset = r.i32()? as usize;
    if lod >= num_lods {
        return fail(format!("LOD {lod} not present ({num_lods} LODs)"));
    }

    let mut body_parts = Vec::with_capacity(num_bodyparts);
    for i in 0..num_bodyparts {
        let bp = bodypart_offset + i * SIZEOF_BODYPART;
        let mut b = Reader::at(data, bp);
        let num_models = count(b.i32()?, "model", 256)?;
        let model_offset = b.i32()?;
        let mut models = Vec::with_capacity(num_models);
        for j in 0..num_models {
            let mp = offset(bp, model_offset)? + j * SIZEOF_MODEL;
            let mut m = Reader::at(data, mp);
            let _num_lods = m.i32()?;
            let lod_offset = m.i32()?;
            let lp = offset(mp, lod_offset)? + lod * SIZEOF_LOD;
            let mut l = Reader::at(data, lp);
            let num_meshes = count(l.i32()?, "mesh", 1024)?;
            let mesh_offset = l.i32()?;
            let mut meshes = Vec::with_capacity(num_meshes);
            for k in 0..num_meshes {
                let mhp = offset(lp, mesh_offset)? + k * SIZEOF_MESH;
                meshes.push(parse_mesh(data, mhp, sg_size)?);
            }
            models.push(meshes);
        }
        body_parts.push(models);
    }
    Ok(Vtx { checksum, body_parts })
}

fn parse_mesh(data: &[u8], mhp: usize, sg_size: usize) -> Result<Vec<StripGroup>> {
    let mut mh = Reader::at(data, mhp);
    let num_groups = count(mh.i32()?, "strip group", 4096)?;
    let group_offset = mh.i32()?;
    let mut groups = Vec::with_capacity(num_groups);
    for g in 0..num_groups {
        let gp = offset(mhp, group_offset)? + g * sg_size;
        let mut gr = Reader::at(data, gp);
        let num_verts = count(gr.i32()?, "strip group vertex", 1 << 20)?;
        let vert_offset = gr.i32()?;
        let num_indices = count(gr.i32()?, "strip group index", 1 << 22)?;
        let index_offset = gr.i32()?;
        let num_strips = count(gr.i32()?, "strip", 1 << 16)?;
        let strip_offset = gr.i32()?;
        let group_flags = gr.u8()?;

        let mut vr = Reader::at(data, offset(gp, vert_offset)?);
        let mut ids = Vec::with_capacity(num_verts);
        for _ in 0..num_verts {
            vr.skip(4); // boneWeightIndex[3], numBones
            ids.push(vr.u16()?);
            vr.skip(3); // boneID[3]
            debug_assert!(SIZEOF_VERTEX == 9);
        }

        let mut ir = Reader::at(data, offset(gp, index_offset)?);
        let mut indices = Vec::with_capacity(num_indices);
        for _ in 0..num_indices {
            let ix = ir.u16()?;
            if ix as usize >= num_verts {
                return fail("strip group index out of range (wrong header stride?)");
            }
            indices.push(ix);
        }

        let mut strips = Vec::with_capacity(num_strips);
        for s in 0..num_strips {
            let mut sr = Reader::at(data, offset(gp, strip_offset)? + s * SIZEOF_STRIP);
            let n_idx = count(sr.i32()?, "strip index", 1 << 22)?;
            let i_off = count(sr.i32()?, "strip index offset", 1 << 22)?;
            sr.skip(8); // numVerts, vertOffset
            sr.skip(2); // numBones
            let flags = sr.u8()?;
            if i_off + n_idx > indices.len() {
                return fail("strip index range out of bounds");
            }
            strips.push(Strip { index_offset: i_off, num_indices: n_idx, flags });
        }
        groups.push(StripGroup { orig_mesh_vert_ids: ids, indices, strips, flags: group_flags });
    }
    Ok(groups)
}
