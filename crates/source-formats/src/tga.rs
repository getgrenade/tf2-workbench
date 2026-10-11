//! A TGA reader for the textures the item compiler takes: uncompressed and run-length true colour, grayscale and colour-mapped images of
//! 8, 15/16, 24 and 32 bits, in either row order. Pixels come out as RGBA8, top row first. (The viewer has the same reader in TypeScript:
//! `src/compiler/tga.ts`; the two must agree.)

use crate::binary::{fail, Result};

#[derive(Debug, Clone)]
pub struct Tga {
    pub width: u32,
    pub height: u32,
    /// Bits per pixel in the file (the importer's manifest records 3 or 4 channels).
    pub depth: u8,
    /// The file declares an alpha channel.
    pub has_alpha: bool,
    /// Some pixel is not fully opaque.
    pub uses_alpha: bool,
    pub rgba: Vec<u8>,
}

fn pixel(b: &[u8], depth: u8) -> [u8; 4] {
    match depth {
        24 => [b[2], b[1], b[0], 255],
        32 => [b[2], b[1], b[0], b[3]],
        8 => [b[0], b[0], b[0], 255],
        _ => {
            let v = b[0] as u16 | ((b[1] as u16) << 8);
            let c = |shift: u16| { let x = ((v >> shift) & 31) as u8; (x << 3) | (x >> 2) };
            [c(10), c(5), c(0), 255]
        }
    }
}

pub fn decode(bytes: &[u8]) -> Result<Tga> {
    if bytes.len() < 18 { return fail("the file is too small to be a TGA image"); }
    let id_len = bytes[0] as usize;
    let map_type = bytes[1];
    let kind = bytes[2];
    let map_first = u16::from_le_bytes([bytes[3], bytes[4]]) as usize;
    let map_len = u16::from_le_bytes([bytes[5], bytes[6]]) as usize;
    let map_depth = bytes[7];
    let width = u16::from_le_bytes([bytes[12], bytes[13]]) as usize;
    let height = u16::from_le_bytes([bytes[14], bytes[15]]) as usize;
    let depth = bytes[16];
    let descriptor = bytes[17];
    let rle = kind >= 9;
    let base = if rle { kind - 8 } else { kind };
    if ![1, 2, 3].contains(&base) { return fail(format!("unsupported TGA image type {kind}")); }
    if width == 0 || height == 0 { return fail("the image has no pixels"); }
    if ![8, 15, 16, 24, 32].contains(&depth) { return fail(format!("unsupported TGA pixel depth {depth}")); }
    if base == 1 && (map_type != 1 || ![15, 16, 24, 32].contains(&map_depth)) { return fail("unsupported TGA colour map"); }

    let mut at = 18 + id_len;
    let map_bytes = if map_type == 1 { (map_depth as usize).div_ceil(8) } else { 0 };
    let mut palette: Vec<[u8; 4]> = Vec::new();
    if map_type == 1 {
        palette.resize(map_first + map_len, [0, 0, 0, 255]);
        for i in 0..map_len {
            if at + map_bytes > bytes.len() { return fail("the colour map is cut short"); }
            palette[map_first + i] = pixel(&bytes[at..at + map_bytes], map_depth);
            at += map_bytes;
        }
    }

    let bpp = (depth as usize).div_ceil(8);
    let count = width * height;
    let mut raw = vec![0u8; count * bpp];
    if !rle {
        if at + raw.len() > bytes.len() { return fail("the pixel data is cut short"); }
        let end = at + raw.len();
        raw.copy_from_slice(&bytes[at..end]);
    } else {
        let mut out = 0;
        while out < raw.len() {
            if at >= bytes.len() { return fail("the pixel data is cut short"); }
            let head = bytes[at];
            at += 1;
            let n = (head & 127) as usize + 1;
            if out + n * bpp > raw.len() { return fail("a run goes past the end of the image"); }
            if head & 128 != 0 {
                if at + bpp > bytes.len() { return fail("the pixel data is cut short"); }
                for i in 0..n { raw[out + i * bpp..out + (i + 1) * bpp].copy_from_slice(&bytes[at..at + bpp]); }
                at += bpp;
            } else {
                if at + n * bpp > bytes.len() { return fail("the pixel data is cut short"); }
                raw[out..out + n * bpp].copy_from_slice(&bytes[at..at + n * bpp]);
                at += n * bpp;
            }
            out += n * bpp;
        }
    }

    let top_first = descriptor & 0x20 != 0;
    let right_first = descriptor & 0x10 != 0;
    let alpha_bits = descriptor & 0x0f;
    // a 32 bit file has an alpha channel whatever its descriptor says (the importer's own writer leaves the alpha bits at 0)
    let has_alpha = if depth == 32 { true } else if depth == 16 { alpha_bits > 0 } else { base == 1 && map_depth == 32 };
    let mut rgba = vec![0u8; count * 4];
    let mut uses_alpha = false;
    for y in 0..height {
        let row = if top_first { y } else { height - 1 - y };
        for x in 0..width {
            let column = if right_first { width - 1 - x } else { x };
            let src = (y * width + x) * bpp;
            let px = match base {
                1 => palette.get(raw[src] as usize).copied().unwrap_or([0, 0, 0, 255]),
                3 => if depth == 8 { [raw[src], raw[src], raw[src], 255] } else { [raw[src], raw[src], raw[src], raw[src + 1]] },
                _ => pixel(&raw[src..src + bpp], depth),
            };
            let dst = (row * width + column) * 4;
            rgba[dst..dst + 4].copy_from_slice(&px);
            if px[3] != 255 { uses_alpha = true; }
        }
    }
    Ok(Tga { width: width as u32, height: height as u32, depth, has_alpha, uses_alpha, rgba })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tga(kind: u8, w: u16, h: u16, depth: u8, body: &[u8], descriptor: u8) -> Vec<u8> {
        let mut v = vec![0u8; 18];
        v[2] = kind; v[12..14].copy_from_slice(&w.to_le_bytes()); v[14..16].copy_from_slice(&h.to_le_bytes()); v[16] = depth; v[17] = descriptor;
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn decodes_both_row_orders_and_run_length() {
        let top = decode(&tga(2, 2, 1, 32, &[3, 2, 1, 255, 30, 20, 10, 128], 0x28)).unwrap();
        assert_eq!(top.rgba, [1, 2, 3, 255, 10, 20, 30, 128]);
        assert!(top.has_alpha && top.uses_alpha);
        let bottom = decode(&tga(2, 1, 2, 24, &[0, 0, 255, 255, 0, 0], 0)).unwrap();
        assert_eq!(bottom.rgba, [0, 0, 255, 255, 255, 0, 0, 255]);
        assert!(!bottom.has_alpha);
        let rle = decode(&tga(10, 4, 1, 24, &[0x83, 9, 8, 7], 0x20)).unwrap();
        assert_eq!(&rle.rgba[..8], &[7, 8, 9, 255, 7, 8, 9, 255]);
    }

    #[test]
    fn a_32_bit_file_keeps_its_alpha_whatever_the_descriptor_says() {
        let t = decode(&tga(2, 1, 1, 32, &[1, 2, 3, 77], 0x20)).unwrap();
        assert_eq!(t.rgba, [3, 2, 1, 77]);
        assert!(t.has_alpha && t.uses_alpha);
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        assert!(decode(&[0; 5]).is_err());
        assert!(decode(&tga(2, 2, 2, 24, &[1, 2, 3], 0)).is_err());
        assert!(decode(&tga(0, 1, 1, 24, &[], 0)).is_err());
        assert!(decode(&tga(10, 2, 1, 24, &[0xff, 1, 2, 3], 0)).is_err());
    }
}
