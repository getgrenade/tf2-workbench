//! Valve Vertex Data (`.vvd`) v4: the shared vertex pool for a model.

use crate::binary::{count, fail, Reader, Result};

const SIZEOF_VERTEX: usize = 48;
const SIZEOF_TANGENT: usize = 16;
const SIZEOF_FIXUP: usize = 12;

#[derive(Debug, Clone, Copy, Default)]
pub struct Vertex {
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub weights: [f32; 3],
    pub bones: [u8; 3],
    pub num_bones: u8,
}

#[derive(Debug)]
pub struct Vvd {
    pub checksum: i32,
    pub num_lods: i32,
    /// Vertices for the requested LOD with fixups applied. Indices computed from
    /// the MDL/VTX refer into this array.
    pub vertices: Vec<Vertex>,
    /// xyzw tangents, parallel to `vertices`.
    pub tangents: Vec<[f32; 4]>,
}

pub fn parse(data: &[u8], lod: i32) -> Result<Vvd> {
    let mut r = Reader::new(data);
    if r.bytes(4)? != b"IDSV" {
        return fail("not a VVD (missing IDSV)");
    }
    let version = r.i32()?;
    if version != 4 {
        return fail(format!("unsupported VVD version {version}"));
    }
    let checksum = r.i32()?;
    let num_lods = r.i32()?;
    let mut lod_verts = [0i32; 8];
    for v in &mut lod_verts {
        *v = r.i32()?;
    }
    let num_fixups = count(r.i32()?, "fixup", 1 << 20)?;
    let fixup_start = r.i32()? as usize;
    let vertex_start = r.i32()? as usize;
    let tangent_start = r.i32()? as usize;

    let lod = lod.clamp(0, (num_lods - 1).max(0));
    let total = lod_verts[0].max(0) as usize; // LOD 0 holds the entire pool
    let read_all = |start: usize| -> Result<(Vec<Vertex>, Vec<[f32; 4]>)> {
        let mut vr = Reader::at(data, start);
        let mut verts = Vec::with_capacity(total);
        for _ in 0..total {
            let weights = vr.f32s::<3>()?;
            let b = vr.bytes(3)?;
            let bones = [b[0], b[1], b[2]];
            let num_bones = vr.u8()?;
            let pos = vr.f32s::<3>()?;
            let normal = vr.f32s::<3>()?;
            let uv = vr.f32s::<2>()?;
            verts.push(Vertex { pos, normal, uv, weights, bones, num_bones });
        }
        debug_assert_eq!(vr.pos - start, total * SIZEOF_VERTEX);
        let mut tr = Reader::at(data, tangent_start);
        let mut tans = Vec::with_capacity(total);
        for _ in 0..total {
            tans.push(tr.f32s::<4>()?);
        }
        let _ = SIZEOF_TANGENT;
        Ok((verts, tans))
    };
    let (raw, raw_tan) = read_all(vertex_start)?;

    if num_fixups == 0 {
        let n = lod_verts[lod as usize].max(0) as usize;
        let mut vertices = raw;
        let mut tangents = raw_tan;
        vertices.truncate(n);
        tangents.truncate(n);
        return Ok(Vvd { checksum, num_lods, vertices, tangents });
    }

    let mut vertices = Vec::new();
    let mut tangents = Vec::new();
    let mut fr = Reader::at(data, fixup_start);
    for _ in 0..num_fixups {
        let fix_lod = fr.i32()?;
        let src = fr.i32()?;
        let n = fr.i32()?;
        if fix_lod < lod {
            continue;
        }
        let (src, n) = (src as usize, n as usize);
        if src + n > raw.len() {
            return fail("VVD fixup range out of bounds");
        }
        vertices.extend_from_slice(&raw[src..src + n]);
        tangents.extend_from_slice(&raw_tan[src..src + n]);
    }
    let _ = SIZEOF_FIXUP;
    Ok(Vvd { checksum, num_lods, vertices, tangents })
}
