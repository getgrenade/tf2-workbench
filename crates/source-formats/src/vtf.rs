//! Valve Texture Format (`.vtf`) decoder, versions 7.0-7.5. Decodes frame 0 of
//! a chosen mip level to RGBA8.

use crate::binary::{fail, half_to_f32, Reader, Result};

const FLAG_ENVMAP: u32 = 0x4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Rgba8888,
    Abgr8888,
    Rgb888,
    Bgr888,
    Rgb565,
    I8,
    Ia88,
    A8,
    Argb8888,
    Bgra8888,
    Dxt1,
    Dxt3,
    Dxt5,
    Bgrx8888,
    Bgr565,
    Dxt1OneBitAlpha,
    Uv88,
    Ati2n,
    Ati1n,
    /// Half float RGBA (HDR cubemaps). Decoded to 8 bit for the LDR renderer.
    Rgba16161616F,
}

impl Format {
    fn from_id(id: i32) -> Option<Format> {
        use Format::*;
        Some(match id {
            0 => Rgba8888,
            1 => Abgr8888,
            2 => Rgb888,
            3 => Bgr888,
            4 => Rgb565,
            5 => I8,
            6 => Ia88,
            8 => A8,
            11 => Argb8888,
            12 => Bgra8888,
            13 => Dxt1,
            14 => Dxt3,
            15 => Dxt5,
            16 => Bgrx8888,
            17 => Bgr565,
            20 => Dxt1OneBitAlpha,
            22 => Uv88,
            24 => Rgba16161616F,
            37 => Ati2n,
            38 => Ati1n,
            _ => return None,
        })
    }

    /// Byte size of one `w` x `h` image in this format.
    fn image_size(self, w: usize, h: usize) -> usize {
        use Format::*;
        let blocks = |bytes: usize| w.div_ceil(4).max(1) * h.div_ceil(4).max(1) * bytes;
        match self {
            Dxt1 | Dxt1OneBitAlpha => blocks(8),
            Dxt3 | Dxt5 | Ati2n => blocks(16),
            Ati1n => blocks(8),
            Rgba8888 | Abgr8888 | Argb8888 | Bgra8888 | Bgrx8888 => w * h * 4,
            Rgba16161616F => w * h * 8,
            Rgb888 | Bgr888 => w * h * 3,
            Rgb565 | Bgr565 | Ia88 | Uv88 => w * h * 2,
            I8 | A8 => w * h,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    /// Raw VTF texture flags (CLAMPS = 0x4, CLAMPT = 0x8, ...).
    pub flags: u32,
    /// Tightly packed RGBA8, top row first.
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
pub struct VtfInfo {
    pub width: u32,
    pub height: u32,
    pub flags: u32,
    pub frames: u32,
    pub mip_count: u32,
    pub format: Format,
}

struct Layout {
    info: VtfInfo,
    faces: usize,
    /// File offset of the start of frame 0 of the largest mip.
    data_start: usize,
    /// Per-mip file offsets of frame 0 (index 0 = largest).
    mip_offsets: Vec<usize>,
}

fn layout(data: &[u8]) -> Result<Layout> {
    let mut r = Reader::new(data);
    if r.bytes(4)? != b"VTF\0" {
        return fail("not a VTF (bad signature)");
    }
    let major = r.u32()?;
    let minor = r.u32()?;
    if major != 7 || minor > 5 {
        return fail(format!("unsupported VTF version {major}.{minor}"));
    }
    let header_size = r.u32()? as usize;
    let width = r.u16()? as usize;
    let height = r.u16()? as usize;
    let flags = r.u32()?;
    let frames = r.u16()? as usize;
    r.skip(2 + 4 + 12 + 4 + 4); // firstFrame, pad, reflectivity, pad, bumpScale
    let hi_id = r.i32()?;
    let mip_count = r.u8()? as usize;
    let low_id = r.i32()?;
    let low_w = r.u8()? as usize;
    let low_h = r.u8()? as usize;

    let Some(format) = Format::from_id(hi_id) else {
        return fail(format!("unsupported VTF image format {hi_id}"));
    };
    if width == 0 || height == 0 || mip_count == 0 || frames == 0 {
        return fail("VTF has an empty image");
    }
    let faces = if flags & FLAG_ENVMAP != 0 { if minor < 5 { 7 } else { 6 } } else { 1 };

    let low_size = match Format::from_id(low_id) {
        Some(f) if low_w > 0 && low_h > 0 => f.image_size(low_w, low_h),
        _ => 0,
    };

    // Mips are stored smallest first; within a mip: frame, face.
    let dims = |m: usize| ((width >> m).max(1), (height >> m).max(1));
    let mut offset = header_size + low_size;
    // VTF 7.3+ stores image offsets in a resource dictionary. Particle sheets can
    // sit between the thumbnail and image, so header_size + thumbnail is insufficient.
    if minor >= 3 {
        let mut resources = Reader::at(data, 68);
        let count = resources.u32()? as usize;
        if count > 32 || 80 + count * 8 > header_size { return fail("invalid VTF resource dictionary"); }
        let mut found_image = false;
        for i in 0..count {
            let mut entry = Reader::at(data, 80 + i * 8);
            let tag = entry.u32()?;
            let start = entry.u32()? as usize;
            if tag & 0x00ffffff == 0x30 {
                if tag & 0x02000000 != 0 || start < header_size { return fail("invalid VTF image resource"); }
                offset = start;
                found_image = true;
            }
        }
        if count > 0 && !found_image { return fail("VTF resource dictionary has no image"); }
    }
    let mut mip_offsets = vec![0; mip_count];
    for m in (0..mip_count).rev() {
        mip_offsets[m] = offset;
        let (w, h) = dims(m);
        offset += format.image_size(w, h) * frames * faces;
    }
    if offset > data.len() {
        return fail(format!("VTF truncated: need {offset} bytes, have {}", data.len()));
    }
    let info = VtfInfo {
        width: width as u32,
        height: height as u32,
        flags,
        frames: frames as u32,
        mip_count: mip_count as u32,
        format,
    };
    Ok(Layout { info, faces, data_start: mip_offsets[0], mip_offsets })
}

/// Decodes the six cubemap faces of frame 0 at `mip`, in file order (+X, -X, +Y, -Y, +Z, -Z in
/// Source world axes). Fails if the texture is not a cubemap.
pub fn decode_faces(data: &[u8], mip: u32) -> Result<Vec<Image>> {
    let lay = layout(data)?;
    if lay.info.flags & FLAG_ENVMAP == 0 || lay.faces < 6 {
        return fail("VTF is not a cubemap");
    }
    let mip = (mip as usize).min(lay.info.mip_count as usize - 1);
    let w = (lay.info.width as usize >> mip).max(1);
    let h = (lay.info.height as usize >> mip).max(1);
    let size = lay.info.format.image_size(w, h);
    (0..6)
        .map(|f| {
            let start = lay.mip_offsets[mip] + f * size;
            let mut rgba = vec![0u8; w * h * 4];
            convert(lay.info.format, &data[start..start + size], w, h, &mut rgba);
            Ok(Image { width: w as u32, height: h as u32, flags: lay.info.flags, rgba })
        })
        .collect()
}

/// Decodes every animation frame (up to `max_frames`) of a non-cubemap texture at `mip`. Within a mip the file stores
/// frame after frame, each with its faces, so frame `f` of a plain texture is the `f`-th image of that mip.
pub fn decode_frames(data: &[u8], mip: u32, max_frames: usize) -> Result<Vec<Image>> {
    let lay = layout(data)?;
    let mip = (mip as usize).min(lay.info.mip_count as usize - 1);
    let w = (lay.info.width as usize >> mip).max(1);
    let h = (lay.info.height as usize >> mip).max(1);
    let size = lay.info.format.image_size(w, h);
    (0..(lay.info.frames as usize).min(max_frames))
        .map(|f| {
            let start = lay.mip_offsets[mip] + f * lay.faces * size;
            let mut rgba = vec![0u8; w * h * 4];
            convert(lay.info.format, &data[start..start + size], w, h, &mut rgba);
            Ok(Image { width: w as u32, height: h as u32, flags: lay.info.flags, rgba })
        })
        .collect()
}

/// The six faces of a half-float (`Rgba16161616F`) cubemap as linear RGBA f32, untouched by any clamping. Used to inspect
/// the real HDR radiance values; fails for other formats.
pub fn decode_faces_f32(data: &[u8], mip: u32) -> Result<Vec<(u32, u32, Vec<f32>)>> {
    let lay = layout(data)?;
    if lay.info.flags & FLAG_ENVMAP == 0 || lay.faces < 6 || lay.info.format != Format::Rgba16161616F {
        return fail("VTF is not a half-float cubemap");
    }
    let mip = (mip as usize).min(lay.info.mip_count as usize - 1);
    let w = (lay.info.width as usize >> mip).max(1);
    let h = (lay.info.height as usize >> mip).max(1);
    let size = lay.info.format.image_size(w, h);
    Ok((0..6)
        .map(|f| {
            let start = lay.mip_offsets[mip] + f * size;
            let src = &data[start..start + size];
            let px: Vec<f32> = src.chunks_exact(2).map(|c| half_to_f32(u16::from_le_bytes([c[0], c[1]]))).collect();
            (w as u32, h as u32, px)
        })
        .collect())
}

pub fn info(data: &[u8]) -> Result<VtfInfo> {
    Ok(layout(data)?.info)
}

/// Decodes frame 0 at `mip` (0 = full size; clamped to the smallest available).
pub fn decode(data: &[u8], mip: u32) -> Result<Image> {
    let lay = layout(data)?;
    let mip = (mip as usize).min(lay.info.mip_count as usize - 1);
    let w = (lay.info.width as usize >> mip).max(1);
    let h = (lay.info.height as usize >> mip).max(1);
    let _ = lay.data_start;
    let src = &data[lay.mip_offsets[mip]..lay.mip_offsets[mip] + lay.info.format.image_size(w, h)];
    let mut rgba = vec![0u8; w * h * 4];
    convert(lay.info.format, src, w, h, &mut rgba);
    Ok(Image { width: w as u32, height: h as u32, flags: lay.info.flags, rgba })
}

fn convert(fmt: Format, src: &[u8], w: usize, h: usize, out: &mut [u8]) {
    use Format::*;
    let px = w * h;
    let mut put = |i: usize, r: u8, g: u8, b: u8, a: u8| out[i * 4..i * 4 + 4].copy_from_slice(&[r, g, b, a]);
    match fmt {
        Rgba8888 => (0..px).for_each(|i| put(i, src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3])),
        Abgr8888 => (0..px).for_each(|i| put(i, src[i * 4 + 3], src[i * 4 + 2], src[i * 4 + 1], src[i * 4])),
        Argb8888 => (0..px).for_each(|i| put(i, src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3], src[i * 4])),
        Bgra8888 => (0..px).for_each(|i| put(i, src[i * 4 + 2], src[i * 4 + 1], src[i * 4], src[i * 4 + 3])),
        Bgrx8888 => (0..px).for_each(|i| put(i, src[i * 4 + 2], src[i * 4 + 1], src[i * 4], 255)),
        Rgb888 => (0..px).for_each(|i| put(i, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], 255)),
        Bgr888 => (0..px).for_each(|i| put(i, src[i * 3 + 2], src[i * 3 + 1], src[i * 3], 255)),
        Rgb565 | Bgr565 => (0..px).for_each(|i| {
            let v = u16::from_le_bytes([src[i * 2], src[i * 2 + 1]]);
            let [r, g, b] = expand565(v);
            if fmt == Rgb565 { put(i, r, g, b, 255) } else { put(i, b, g, r, 255) }
        }),
        I8 => (0..px).for_each(|i| put(i, src[i], src[i], src[i], 255)),
        A8 => (0..px).for_each(|i| put(i, 255, 255, 255, src[i])),
        Ia88 => (0..px).for_each(|i| put(i, src[i * 2], src[i * 2], src[i * 2], src[i * 2 + 1])),
        Uv88 => (0..px).for_each(|i| put(i, src[i * 2], src[i * 2 + 1], 255, 255)),
        Rgba16161616F => (0..px).for_each(|i| {
            // The LDR renderer stores the clamped float value as an 8 bit texel and then reads it as sRGB, like
            // the 8 bit cubemaps it ships.
            let c = |k: usize| u16::from_le_bytes([src[i * 8 + k * 2], src[i * 8 + k * 2 + 1]]);
            let enc = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            put(i, enc(half_to_f32(c(0))), enc(half_to_f32(c(1))), enc(half_to_f32(c(2))), (half_to_f32(c(3)).clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
        }),
        Ati1n | Ati2n => decode_bc45(fmt, src, w, h, out),
        Dxt1 | Dxt1OneBitAlpha | Dxt3 | Dxt5 => decode_dxt(fmt, src, w, h, out),
    }
}


fn expand565(v: u16) -> [u8; 3] {
    let r = (v >> 11) & 31;
    let g = (v >> 5) & 63;
    let b = v & 31;
    [((r * 255 + 15) / 31) as u8, ((g * 255 + 31) / 63) as u8, ((b * 255 + 15) / 31) as u8]
}

fn decode_dxt(fmt: Format, src: &[u8], w: usize, h: usize, out: &mut [u8]) {
    let bw = w.div_ceil(4).max(1);
    let bh = h.div_ceil(4).max(1);
    let block_size = if matches!(fmt, Format::Dxt1 | Format::Dxt1OneBitAlpha) { 8 } else { 16 };
    for by in 0..bh {
        for bx in 0..bw {
            let b = &src[(by * bw + bx) * block_size..][..block_size];
            let (alpha_part, color) = if block_size == 16 { (&b[..8], &b[8..]) } else { (&b[..0], b) };
            let c0 = u16::from_le_bytes([color[0], color[1]]);
            let c1 = u16::from_le_bytes([color[2], color[3]]);
            let (p0, p1) = (expand565(c0), expand565(c1));
            let mut pal = [[0u8; 4]; 4];
            pal[0] = [p0[0], p0[1], p0[2], 255];
            pal[1] = [p1[0], p1[1], p1[2], 255];
            let mix = |a: u8, b: u8, wa: u32, wb: u32, d: u32| ((a as u32 * wa + b as u32 * wb) / d) as u8;
            if c0 > c1 || block_size == 16 {
                for k in 0..3 {
                    pal[2][k] = mix(p0[k], p1[k], 2, 1, 3);
                    pal[3][k] = mix(p0[k], p1[k], 1, 2, 3);
                }
                pal[2][3] = 255;
                pal[3][3] = 255;
            } else {
                for k in 0..3 {
                    pal[2][k] = mix(p0[k], p1[k], 1, 1, 2);
                }
                pal[2][3] = 255;
                pal[3] = [0, 0, 0, if fmt == Format::Dxt1OneBitAlpha || fmt == Format::Dxt1 { 0 } else { 255 }];
            }
            let bits = u32::from_le_bytes([color[4], color[5], color[6], color[7]]);

            // Alpha for DXT3 (explicit 4-bit) and DXT5 (interpolated 3-bit indices).
            let mut alpha = [255u8; 16];
            match fmt {
                Format::Dxt3 => {
                    for (i, a) in alpha.iter_mut().enumerate() {
                        let n = (alpha_part[i / 2] >> ((i % 2) * 4)) & 0xf;
                        *a = n * 17;
                    }
                }
                Format::Dxt5 => {
                    let (a0, a1) = (alpha_part[0] as u32, alpha_part[1] as u32);
                    let mut table = [0u8; 8];
                    table[0] = a0 as u8;
                    table[1] = a1 as u8;
                    if a0 > a1 {
                        for i in 1..7u32 {
                            table[i as usize + 1] = (((7 - i) * a0 + i * a1) / 7) as u8;
                        }
                    } else {
                        for i in 1..5u32 {
                            table[i as usize + 1] = (((5 - i) * a0 + i * a1) / 5) as u8;
                        }
                        table[6] = 0;
                        table[7] = 255;
                    }
                    let mut v = 0u64;
                    for (i, byte) in alpha_part[2..8].iter().enumerate() {
                        v |= (*byte as u64) << (8 * i);
                    }
                    for (i, a) in alpha.iter_mut().enumerate() {
                        *a = table[((v >> (3 * i)) & 7) as usize];
                    }
                }
                _ => {}
            }

            for py in 0..4 {
                for px in 0..4 {
                    let (x, y) = (bx * 4 + px, by * 4 + py);
                    if x >= w || y >= h {
                        continue;
                    }
                    let i = py * 4 + px;
                    let mut c = pal[((bits >> (2 * i)) & 3) as usize];
                    if block_size == 16 {
                        c[3] = alpha[i];
                    }
                    out[(y * w + x) * 4..][..4].copy_from_slice(&c);
                }
            }
        }
    }
}

/// Decodes one BC4 channel block (8 bytes) into 16 values.
fn bc4_block(b: &[u8]) -> [u8; 16] {
    let (a0, a1) = (b[0] as u32, b[1] as u32);
    let mut table = [0u8; 8];
    table[0] = a0 as u8;
    table[1] = a1 as u8;
    if a0 > a1 {
        for i in 1..7u32 {
            table[i as usize + 1] = (((7 - i) * a0 + i * a1) / 7) as u8;
        }
    } else {
        for i in 1..5u32 {
            table[i as usize + 1] = (((5 - i) * a0 + i * a1) / 5) as u8;
        }
        table[6] = 0;
        table[7] = 255;
    }
    let mut v = 0u64;
    for (i, byte) in b[2..8].iter().enumerate() {
        v |= (*byte as u64) << (8 * i);
    }
    let mut out = [0u8; 16];
    for (i, o) in out.iter_mut().enumerate() {
        *o = table[((v >> (3 * i)) & 7) as usize];
    }
    out
}

/// ATI1N (one channel -> gray) and ATI2N (two channels -> normal map XY, Z reconstructed).
fn decode_bc45(fmt: Format, src: &[u8], w: usize, h: usize, out: &mut [u8]) {
    let bw = w.div_ceil(4).max(1);
    let bh = h.div_ceil(4).max(1);
    let two = fmt == Format::Ati2n;
    let block_size = if two { 16 } else { 8 };
    for by in 0..bh {
        for bx in 0..bw {
            let b = &src[(by * bw + bx) * block_size..][..block_size];
            let r = bc4_block(&b[..8]);
            let g = if two { bc4_block(&b[8..16]) } else { r };
            for py in 0..4 {
                for px in 0..4 {
                    let (x, y) = (bx * 4 + px, by * 4 + py);
                    if x >= w || y >= h {
                        continue;
                    }
                    let i = py * 4 + px;
                    let px_out = if two {
                        let nx = r[i] as f32 / 255.0 * 2.0 - 1.0;
                        let ny = g[i] as f32 / 255.0 * 2.0 - 1.0;
                        let nz = (1.0 - nx * nx - ny * ny).max(0.0).sqrt();
                        [r[i], g[i], ((nz * 0.5 + 0.5) * 255.0).round() as u8, 255]
                    } else {
                        [r[i], r[i], r[i], 255]
                    };
                    out[(y * w + x) * 4..][..4].copy_from_slice(&px_out);
                }
            }
        }
    }
}
