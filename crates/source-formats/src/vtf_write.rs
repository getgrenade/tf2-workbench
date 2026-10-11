//! Writes Valve Texture Format (`.vtf`) files the way the item importer's vtex step does for a cosmetic's textures, so that a texture
//! can go from the artist's TGA to the game's format in milliseconds without starting vtex: version 7.4, DXT1 or DXT5 with a full chain of
//! mip maps, a 16x16 DXT1 thumbnail, and the flags the importer's files carry (checked against the files of the in-game tool).

use crate::zipw::crc32;

/// Which texture of an item an image is, which decides the format and flags (the importer's texture types and icon types).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `_color`: DXT1, or DXT5 when the image uses its alpha.
    Color,
    /// `_normal`: DXT5 with the normal map flag; mip maps are renormalised.
    Normal,
    /// `_phongexponent`: DXT5.
    PhongExponent,
    /// `_illum`: DXT1, or DXT5 when the image uses its alpha.
    Illum,
    /// The backpack icons: DXT5, flagged no-mip/no-lod like the importer's.
    Icon,
}

const FLAG_NORMAL: u32 = 0x80;
const FLAG_NOMIP: u32 = 0x100;
const FLAG_NOLOD: u32 = 0x200;
const FLAG_EIGHT_BIT_ALPHA: u32 = 0x2000;
const FORMAT_DXT1: i32 = 13;
const FORMAT_DXT5: i32 = 15;

pub struct Source<'a> {
    pub width: usize,
    pub height: usize,
    pub rgba: &'a [u8],
}

/// The number of mip levels of a texture of this size: down to 1x1.
pub fn mip_count(width: usize, height: usize) -> usize {
    (usize::BITS - width.max(height).max(1).leading_zeros()) as usize
}

/// Box-filters an image to a new size (area average), the way a mip chain or a "reduce" is made.
pub fn resize_box(src: &[u8], w: usize, h: usize, nw: usize, nh: usize) -> Vec<u8> {
    let mut out = vec![0u8; nw * nh * 4];
    for y in 0..nh {
        let y0 = y * h / nh;
        let y1 = ((y + 1) * h).div_ceil(nh).max(y0 + 1).min(h);
        for x in 0..nw {
            let x0 = x * w / nw;
            let x1 = ((x + 1) * w).div_ceil(nw).max(x0 + 1).min(w);
            let mut sum = [0u32; 4];
            let mut n = 0u32;
            for sy in y0..y1 { for sx in x0..x1 { for c in 0..4 { sum[c] += src[(sy * w + sx) * 4 + c] as u32; } n += 1; } }
            for c in 0..4 { out[(y * nw + x) * 4 + c] = ((sum[c] + n / 2) / n) as u8; }
        }
    }
    out
}

/// One step down the mip chain; a normal map's vectors are averaged and made unit length again.
fn next_mip(src: &[u8], w: usize, h: usize, normal: bool) -> (Vec<u8>, usize, usize) {
    let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
    let mut out = resize_box(src, w, h, nw, nh);
    if normal {
        for p in out.chunks_exact_mut(4) {
            let v = [p[0] as f32 / 127.5 - 1.0, p[1] as f32 / 127.5 - 1.0, p[2] as f32 / 127.5 - 1.0];
            let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            if len > 1e-4 { for c in 0..3 { p[c] = (((v[c] / len) + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8; } }
        }
    }
    (out, nw, nh)
}

fn expand565(c: u16) -> [f32; 3] {
    let r = ((c >> 11) & 31) as u8; let g = ((c >> 5) & 63) as u8; let b = (c & 31) as u8;
    [((r << 3) | (r >> 2)) as f32, ((g << 2) | (g >> 4)) as f32, ((b << 3) | (b >> 2)) as f32]
}

fn quantize565(c: [f32; 3]) -> u16 {
    let r = ((c[0] / 255.0 * 31.0).round().clamp(0.0, 31.0)) as u16;
    let g = ((c[1] / 255.0 * 63.0).round().clamp(0.0, 63.0)) as u16;
    let b = ((c[2] / 255.0 * 31.0).round().clamp(0.0, 31.0)) as u16;
    (r << 11) | (g << 5) | b
}

fn palette(c0: u16, c1: u16) -> [[f32; 3]; 4] {
    let (a, b) = (expand565(c0), expand565(c1));
    let mix = |wa: f32| [a[0] * wa + b[0] * (1.0 - wa), a[1] * wa + b[1] * (1.0 - wa), a[2] * wa + b[2] * (1.0 - wa)];
    [a, b, mix(2.0 / 3.0), mix(1.0 / 3.0)]
}

/// The best index of each pixel for a palette, and the total squared error.
fn assign(px: &[[f32; 3]; 16], pal: &[[f32; 3]; 4]) -> ([u8; 16], f32) {
    let mut idx = [0u8; 16];
    let mut error = 0.0;
    for (i, p) in px.iter().enumerate() {
        let mut best = (f32::MAX, 0u8);
        for (k, c) in pal.iter().enumerate() {
            let d = (p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2) + (p[2] - c[2]).powi(2);
            if d < best.0 { best = (d, k as u8); }
        }
        idx[i] = best.1;
        error += best.0;
    }
    (idx, error)
}

/// For every 8-bit target of a channel of `bits` bits (5 or 6), the endpoint pair whose one-third or two-thirds mix comes closest, as
/// (first endpoint, second endpoint, error): what lets a flat colour (a phong exponent map is usually one) come back exactly.
fn solid_table(bits: u32) -> &'static Vec<[(u8, u8, u8); 2]> {
    static T5: std::sync::OnceLock<Vec<[(u8, u8, u8); 2]>> = std::sync::OnceLock::new();
    static T6: std::sync::OnceLock<Vec<[(u8, u8, u8); 2]>> = std::sync::OnceLock::new();
    let build = move || {
        let n = 1usize << bits;
        let expand = |v: usize| if bits == 5 { ((v << 3) | (v >> 2)) as i32 } else { ((v << 2) | (v >> 4)) as i32 };
        let mut best = vec![[(0u8, 0u8, 255u8); 2]; 256];
        for target in 0..256i32 {
            for (slot, mix) in [(0usize, 2i32), (1, 1)] {
                let mut b = (0u8, 0u8, 255u8);
                for a in 0..n { for c in 0..n {
                    let value = (mix * expand(a) + (3 - mix) * expand(c)) / 3;
                    let err = (value - target).unsigned_abs().min(255) as u8;
                    if err < b.2 { b = (a as u8, c as u8, err); }
                } }
                best[target as usize][slot] = b;
            }
        }
        best
    };
    if bits == 5 { T5.get_or_init(build) } else { T6.get_or_init(build) }
}

/// A DXT1 block for sixteen pixels of one colour: the endpoints and the interpolated index that come closest (often exactly) to it.
fn solid_block(c: [u8; 3]) -> [u8; 8] {
    let direct = |v: u8, bits: u32| -> (u8, u32) {
        let n = 1u32 << bits;
        let mut best = (0u8, u32::MAX);
        for a in 0..n {
            let e = if bits == 5 { (a << 3) | (a >> 2) } else { (a << 2) | (a >> 4) };
            let err = (e as i32 - v as i32).unsigned_abs();
            if err < best.1 { best = (a as u8, err); }
        }
        best
    };
    let (t5, t6) = (solid_table(5), solid_table(6));
    // candidates: the colour as endpoint 0 (index 0), or a two-thirds / one-third mix of two endpoints (index 2 / 3)
    let (r0, g0, b0) = (direct(c[0], 5), direct(c[1], 6), direct(c[2], 5));
    let direct_error = (r0.1 + g0.1 + b0.1) as u32;
    let mut best: (u32, u16, u16, u8) = (direct_error * direct_error, ((r0.0 as u16) << 11) | ((g0.0 as u16) << 5) | b0.0 as u16, 0, 0);
    for (slot, index) in [(0usize, 2u8), (1, 3)] {
        let (r, g, b) = (t5[c[0] as usize][slot], t6[c[1] as usize][slot], t5[c[2] as usize][slot]);
        let error = (r.2 as u32).pow(2) + (g.2 as u32).pow(2) + (b.2 as u32).pow(2);
        let e0 = ((r.0 as u16) << 11) | ((g.0 as u16) << 5) | b.0 as u16;
        let e1 = ((r.1 as u16) << 11) | ((g.1 as u16) << 5) | b.1 as u16;
        if error < best.0 { best = (error, e0, e1, index); }
    }
    let (_, mut c0, mut c1, mut index) = best;
    if index == 0 {
        // every pixel is index 0, which is endpoint 0 in either block mode
        c1 = c0;
    } else if c0 < c1 {
        std::mem::swap(&mut c0, &mut c1);
        index = 5 - index;
    } else if c0 == c1 {
        // the same endpoint twice is the colour itself: index 0
        index = 0;
    }
    let mut out = [0u8; 8];
    out[0..2].copy_from_slice(&c0.to_le_bytes());
    out[2..4].copy_from_slice(&c1.to_le_bytes());
    let bits = (0..16).fold(0u32, |acc, i| acc | ((index as u32) << (2 * i)));
    out[4..8].copy_from_slice(&bits.to_le_bytes());
    out
}

/// A DXT1 colour block (the 8 bytes of two 565 endpoints and 16 two-bit indices) for 16 pixels: endpoints from the principal axis of the
/// colours, then refined by least squares against the indices they produce.
fn color_block(px: &[[f32; 3]; 16]) -> [u8; 8] {
    let mean = {
        let mut m = [0.0f32; 3];
        for p in px { for c in 0..3 { m[c] += p[c] / 16.0; } }
        m
    };
    if px.iter().all(|p| p == &px[0]) { return solid_block([px[0][0] as u8, px[0][1] as u8, px[0][2] as u8]); }
    // covariance and its dominant axis
    let mut cov = [[0.0f32; 3]; 3];
    for p in px { for a in 0..3 { for b in 0..3 { cov[a][b] += (p[a] - mean[a]) * (p[b] - mean[b]); } } }
    let mut axis = [0.57735, 0.57735, 0.57735];
    for _ in 0..8 {
        let next = [0, 1, 2].map(|a| cov[a][0] * axis[0] + cov[a][1] * axis[1] + cov[a][2] * axis[2]);
        let len = (next[0] * next[0] + next[1] * next[1] + next[2] * next[2]).sqrt();
        if len < 1e-6 { break; }
        axis = [next[0] / len, next[1] / len, next[2] / len];
    }
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for p in px {
        let t = (p[0] - mean[0]) * axis[0] + (p[1] - mean[1]) * axis[1] + (p[2] - mean[2]) * axis[2];
        lo = lo.min(t); hi = hi.max(t);
    }
    let at = |t: f32| [mean[0] + axis[0] * t, mean[1] + axis[1] * t, mean[2] + axis[2] * t];
    let mut c0 = quantize565(at(hi));
    let mut c1 = quantize565(at(lo));
    let order = |a: u16, b: u16| if a >= b { (a, b) } else { (b, a) };
    (c0, c1) = order(c0, c1);
    let mut best = (f32::MAX, c0, c1, [0u8; 16]);
    for _ in 0..3 {
        if c0 == c1 { if c1 > 0 { c1 -= 1; } else { c0 = 1; } }
        let (idx, error) = assign(px, &palette(c0, c1));
        if error < best.0 { best = (error, c0, c1, idx); } else { break; }
        // least squares: which endpoints would the pixels like, given the weights their indices imply
        let weights = |i: u8| match i { 0 => 1.0f32, 1 => 0.0, 2 => 2.0 / 3.0, _ => 1.0 / 3.0 };
        let (mut a1, mut a2, mut a3) = (0.0f32, 0.0f32, 0.0f32);
        let (mut b1, mut b2) = ([0.0f32; 3], [0.0f32; 3]);
        for (p, &i) in px.iter().zip(idx.iter()) {
            let a = weights(i); let b = 1.0 - a;
            a1 += a * a; a2 += a * b; a3 += b * b;
            for c in 0..3 { b1[c] += a * p[c]; b2[c] += b * p[c]; }
        }
        let det = a1 * a3 - a2 * a2;
        if det.abs() < 1e-6 { break; }
        let e0 = [0, 1, 2].map(|c| (b1[c] * a3 - b2[c] * a2) / det);
        let e1 = [0, 1, 2].map(|c| (b2[c] * a1 - b1[c] * a2) / det);
        (c0, c1) = order(quantize565(e0), quantize565(e1));
    }
    let (_, c0, c1, idx) = best;
    // the indices were chosen against (c0 >= c1); a swap would change their meaning, so they are final
    let mut out = [0u8; 8];
    out[0..2].copy_from_slice(&c0.to_le_bytes());
    out[2..4].copy_from_slice(&c1.to_le_bytes());
    let mut bits = 0u32;
    for (i, &k) in idx.iter().enumerate() { bits |= (k as u32) << (2 * i); }
    out[4..8].copy_from_slice(&bits.to_le_bytes());
    out
}

/// A DXT5 alpha block: two endpoints and 16 three-bit indices (the eight-value mode, endpoint 0 above endpoint 1).
fn alpha_block(alpha: &[u8; 16]) -> [u8; 8] {
    let (mut lo, mut hi) = (255u8, 0u8);
    for &a in alpha { lo = lo.min(a); hi = hi.max(a); }
    let mut out = [0u8; 8];
    if lo == hi {
        out[0] = hi; out[1] = lo;
        return out;
    }
    let (a0, a1) = (hi as f32, lo as f32);
    let pal = [a0, a1, (6.0 * a0 + a1) / 7.0, (5.0 * a0 + 2.0 * a1) / 7.0, (4.0 * a0 + 3.0 * a1) / 7.0, (3.0 * a0 + 4.0 * a1) / 7.0, (2.0 * a0 + 5.0 * a1) / 7.0, (a0 + 6.0 * a1) / 7.0];
    out[0] = hi; out[1] = lo;
    let mut bits = 0u64;
    for (i, &a) in alpha.iter().enumerate() {
        let mut best = (f32::MAX, 0u64);
        for (k, p) in pal.iter().enumerate() { let d = (a as f32 - p).abs(); if d < best.0 { best = (d, k as u64); } }
        bits |= best.1 << (3 * i);
    }
    out[2..8].copy_from_slice(&bits.to_le_bytes()[..6]);
    out
}

/// Compresses an image (its sides rounded up to whole 4x4 blocks by repeating the edge) to DXT1 or DXT5.
fn compress(rgba: &[u8], w: usize, h: usize, dxt5: bool) -> Vec<u8> {
    let (bw, bh) = (w.div_ceil(4), h.div_ceil(4));
    let mut out = Vec::with_capacity(bw * bh * if dxt5 { 16 } else { 8 });
    for by in 0..bh {
        for bx in 0..bw {
            let mut px = [[0.0f32; 3]; 16];
            let mut alpha = [255u8; 16];
            for i in 0..16 {
                let x = (bx * 4 + i % 4).min(w - 1);
                let y = (by * 4 + i / 4).min(h - 1);
                let p = &rgba[(y * w + x) * 4..(y * w + x) * 4 + 4];
                px[i] = [p[0] as f32, p[1] as f32, p[2] as f32];
                alpha[i] = p[3];
            }
            if dxt5 { out.extend_from_slice(&alpha_block(&alpha)); }
            out.extend_from_slice(&color_block(&px));
        }
    }
    out
}

/// The average colour of the image in linear space: the "reflectivity" the engine uses for lighting bounces.
fn reflectivity(rgba: &[u8]) -> [f32; 3] {
    let mut sum = [0.0f64; 3];
    let step = (rgba.len() / 4 / 4096).max(1);
    let mut n = 0.0f64;
    for p in rgba.chunks_exact(4).step_by(step) {
        for c in 0..3 { sum[c] += (p[c] as f64 / 255.0).powf(2.2); }
        n += 1.0;
    }
    [0, 1, 2].map(|c| (sum[c] / n.max(1.0)) as f32)
}

/// A VTF file for the image: DXT with every mip map, as the importer's vtex makes it for this kind of texture.
pub fn encode(src: &Source, kind: Kind, uses_alpha: bool) -> Vec<u8> {
    let (w, h) = (src.width, src.height);
    let dxt5 = match kind { Kind::Normal | Kind::PhongExponent | Kind::Icon => true, Kind::Color | Kind::Illum => uses_alpha };
    let mut flags = 0u32;
    if dxt5 { flags |= FLAG_EIGHT_BIT_ALPHA; }
    if kind == Kind::Normal { flags |= FLAG_NORMAL; }
    if kind == Kind::Icon { flags |= FLAG_NOMIP | FLAG_NOLOD; }
    let mips = mip_count(w, h);
    // levels, largest first
    let mut levels: Vec<(Vec<u8>, usize, usize)> = vec![(src.rgba.to_vec(), w, h)];
    for _ in 1..mips {
        let (data, lw, lh) = { let last = levels.last().unwrap(); next_mip(&last.0, last.1, last.2, kind == Kind::Normal) };
        levels.push((data, lw, lh));
    }
    // compress every level on its own thread: the big ones take most of the time
    let compressed: Vec<Vec<u8>> = std::thread::scope(|scope| {
        let handles: Vec<_> = levels.iter().map(|(data, lw, lh)| scope.spawn(move || compress(data, *lw, *lh, dxt5))).collect();
        handles.into_iter().map(|t| t.join().expect("compression thread")).collect()
    });
    let (lw, lh) = (w.min(16), h.min(16));
    let thumbnail = compress(&resize_box(src.rgba, w, h, lw, lh), lw, lh, false);

    const HEADER: usize = 104;
    let image_at = HEADER + thumbnail.len();
    let mut image = Vec::new();
    for level in compressed.iter().rev() { image.extend_from_slice(level); }
    let refl = reflectivity(src.rgba);

    let mut out = Vec::with_capacity(image_at + image.len());
    out.extend_from_slice(b"VTF\0");
    out.extend_from_slice(&7u32.to_le_bytes());
    out.extend_from_slice(&4u32.to_le_bytes());
    out.extend_from_slice(&(HEADER as u32).to_le_bytes());
    out.extend_from_slice(&(w as u16).to_le_bytes());
    out.extend_from_slice(&(h as u16).to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // frames
    out.extend_from_slice(&0u16.to_le_bytes()); // first frame
    out.extend_from_slice(&[0; 4]);
    for c in refl { out.extend_from_slice(&c.to_le_bytes()); }
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&1.0f32.to_le_bytes()); // bump scale
    out.extend_from_slice(&(if dxt5 { FORMAT_DXT5 } else { FORMAT_DXT1 }).to_le_bytes());
    out.push(mips as u8);
    out.extend_from_slice(&FORMAT_DXT1.to_le_bytes()); // thumbnail format
    out.push(lw as u8);
    out.push(lh as u8);
    out.extend_from_slice(&1u16.to_le_bytes()); // depth
    out.extend_from_slice(&[0; 3]);
    out.extend_from_slice(&3u32.to_le_bytes()); // resources
    out.extend_from_slice(&[0; 8]);
    out.extend_from_slice(&0x01u32.to_le_bytes()); // the thumbnail
    out.extend_from_slice(&(HEADER as u32).to_le_bytes());
    out.extend_from_slice(&0x30u32.to_le_bytes()); // the image
    out.extend_from_slice(&(image_at as u32).to_le_bytes());
    out.extend_from_slice(&0x0243_5243u32.to_le_bytes()); // "CRC" with the inline-data flag
    out.extend_from_slice(&crc32(&image).to_le_bytes());
    debug_assert_eq!(out.len(), HEADER);
    out.extend_from_slice(&thumbnail);
    out.extend_from_slice(&image);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vtf;

    fn gradient(w: usize, h: usize) -> Vec<u8> {
        let mut v = Vec::with_capacity(w * h * 4);
        for y in 0..h { for x in 0..w {
            let n = ((x * 7 + y * 13) % 17) as u8;
            v.extend_from_slice(&[(x * 255 / w) as u8, (y * 255 / h) as u8, ((x + y) * 255 / (w + h)) as u8 ^ n, 255 - (x * 128 / w) as u8]);
        } }
        v
    }

    fn psnr(a: &[u8], b: &[u8], channels: usize) -> f64 {
        let mut se = 0.0; let mut n = 0.0;
        for (p, q) in a.chunks_exact(4).zip(b.chunks_exact(4)) { for c in 0..channels { se += (p[c] as f64 - q[c] as f64).powi(2); n += 1.0; } }
        if se == 0.0 { 99.0 } else { 10.0 * (255.0f64 * 255.0 / (se / n)).log10() }
    }

    #[test]
    fn writes_what_the_importers_files_look_like() {
        // sizes of the files of the in-game tool: 512x512 DXT1 with mips, DXT5 with mips, and the 128x128 icon
        let rgba = gradient(512, 512);
        let dxt1 = encode(&Source { width: 512, height: 512, rgba: &rgba }, Kind::Color, false);
        assert_eq!(dxt1.len(), 175008);
        let dxt5 = encode(&Source { width: 512, height: 512, rgba: &rgba }, Kind::Normal, true);
        assert_eq!(dxt5.len(), 349784);
        let small = gradient(128, 128);
        assert_eq!(encode(&Source { width: 128, height: 128, rgba: &small }, Kind::Icon, true).len(), 22104);
        let exp = gradient(256, 256);
        assert_eq!(encode(&Source { width: 256, height: 256, rgba: &exp }, Kind::PhongExponent, true).len(), 87640);
        let info = vtf::info(&dxt5).unwrap();
        assert_eq!((info.width, info.height, info.mip_count, info.flags), (512, 512, 10, 0x2080));
        assert_eq!(vtf::info(&dxt1).unwrap().flags, 0);
        assert_eq!(vtf::info(&encode(&Source { width: 128, height: 128, rgba: &small }, Kind::Icon, true)).unwrap().flags, 0x2300);
    }

    #[test]
    fn decodes_back_to_the_image_at_every_mip() {
        let rgba = gradient(64, 32);
        for (kind, alpha) in [(Kind::Color, false), (Kind::Color, true), (Kind::Normal, true)] {
            let bytes = encode(&Source { width: 64, height: 32, rgba: &rgba }, kind, alpha);
            let image = vtf::decode(&bytes, 0).unwrap();
            assert_eq!((image.width, image.height), (64, 32));
            let q = psnr(&rgba, &image.rgba, 3);
            assert!(q > 30.0, "{kind:?} colour quality {q:.1} dB");
            if alpha { assert!(psnr(&rgba, &image.rgba, 4) > 30.0); }
            // the smallest mip is one pixel
            let last = vtf::decode(&bytes, 6).unwrap();
            assert_eq!((last.width, last.height), (1, 1));
        }
    }

    #[test]
    fn flat_and_tiny_images_survive() {
        for (w, h, px) in [(4usize, 4usize, [200u8, 10, 10, 255]), (1, 1, [0, 0, 0, 255]), (2, 8, [255, 255, 255, 255])] {
            let rgba: Vec<u8> = (0..w * h).flat_map(|_| px).collect();
            let bytes = encode(&Source { width: w, height: h, rgba: &rgba }, Kind::Color, false);
            let image = vtf::decode(&bytes, 0).unwrap();
            assert_eq!((image.width as usize, image.height as usize), (w, h));
            assert!(psnr(&rgba, &image.rgba, 3) > 30.0, "{w}x{h}");
        }
    }

    #[test]
    fn flat_colours_come_back_exactly() {
        for color in [[178u8, 255, 0], [100, 100, 100], [255, 255, 255], [0, 0, 0], [37, 201, 99]] {
            let rgba: Vec<u8> = (0..16 * 16).flat_map(|_| [color[0], color[1], color[2], 255]).collect();
            let bytes = encode(&Source { width: 16, height: 16, rgba: &rgba }, Kind::PhongExponent, false);
            let image = vtf::decode(&bytes, 0).unwrap();
            for p in image.rgba.chunks_exact(4) {
                for c in 0..3 { assert!((p[c] as i32 - color[c] as i32).abs() <= 2, "{color:?} came back as {:?}", &p[..3]); }
            }
        }
    }

    #[test]
    fn mip_chain_lengths() {
        assert_eq!((mip_count(512, 512), mip_count(128, 128), mip_count(256, 64), mip_count(1, 1), mip_count(4, 2)), (10, 8, 9, 1, 3));
    }
}
