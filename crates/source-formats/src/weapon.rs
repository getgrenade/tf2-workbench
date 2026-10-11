//! TF2 weapon scripts: ReadEncryptedKVFile / UTIL_DecodeICE (Thin-ICE, E2NcUkG2).
use crate::{kv, items, VpkSet, binary::Result};
use std::sync::OnceLock;

// Thin-ICE adapted from Matthew Kwan's public-domain implementation in SDK mathlib/IceKey.cpp.
fn decrypt(bytes: &mut [u8]) {
    static SBOX: OnceLock<[[u32; 1024]; 4]> = OnceLock::new();
    let sbox = SBOX.get_or_init(|| {
        let mods = [[333,313,505,369],[379,375,319,391],[361,445,451,397],[397,425,395,505]];
        let xor = [[0x83,0x85,0x9b,0xcd],[0xcc,0xa7,0xad,0x41],[0x4b,0x2e,0xd4,0x33],[0xea,0xcb,0x2e,0x04]];
        let perm = [1,0x80,0x400,0x2000,0x80000,0x200000,0x1000000,0x40000000,
            8,0x20,0x100,0x4000,0x10000,0x800000,0x4000000,0x20000000,
            4,0x10,0x200,0x8000,0x20000,0x400000,0x8000000,0x10000000,
            2,0x40,0x800,0x1000,0x40000,0x100000,0x2000000,0x80000000];
        fn mul(mut a: u32, mut b: u32, m: u32) -> u32 {
            let mut out = 0;
            while b != 0 { if b & 1 != 0 { out ^= a; } a <<= 1; b >>= 1; if a >= 256 { a ^= m; } }
            out
        }
        let mut s = [[0;1024];4];
        for i in 0..1024 { let row = (i & 1) | ((i & 0x200) >> 8); let col = (i >> 1) & 255;
            for j in 0..4 { let b = col as u32 ^ xor[j][row]; let m = mods[j][row];
                let x = mul(b,b,m); let x = mul(b,x,m); let x = mul(x,x,m); let x = mul(b,x,m) << (24-j*8);
                for (bit, p) in perm.iter().enumerate() { if x & (1 << bit) != 0 { s[j][i] |= p; } }
            }
        } s
    });
    let key = b"E2NcUkG2"; let mut kb = [0u16;4];
    for i in 0..4 { kb[3-i] = u16::from_be_bytes([key[i*2],key[i*2+1]]); }
    let mut schedule = [[0u32;3];8];
    for (i, kr) in [0,1,2,3,2,1,3,0].iter().enumerate() {
        for j in 0..15 { for k in 0..4 { let v = &mut kb[(kr+k)&3]; let bit = *v & 1;
            schedule[i][j%3] = (schedule[i][j%3] << 1) | bit as u32;
            *v = (*v >> 1) | ((bit ^ 1) << 15);
        } }
    }
    let f = |p: u32, sk: [u32;3]| { let tl = ((p>>16)&0x3ff) | (((p>>14)|(p<<18))&0xffc00);
        let tr = (p&0x3ff) | ((p<<2)&0xffc00); let salt = sk[2] & (tl^tr);
        let al = (salt^tl)^sk[0]; let ar = (salt^tr)^sk[1];
        sbox[0][(al>>10) as usize] | sbox[1][(al&1023) as usize] | sbox[2][(ar>>10) as usize] | sbox[3][(ar&1023) as usize]
    };
    for chunk in bytes.chunks_exact_mut(8) {
        let mut l = u32::from_be_bytes(chunk[0..4].try_into().unwrap());
        let mut r = u32::from_be_bytes(chunk[4..8].try_into().unwrap());
        for i in [7,5,3,1] { l ^= f(r,schedule[i]); r ^= f(l,schedule[i-1]); }
        chunk[..4].copy_from_slice(&r.to_be_bytes()); chunk[4..].copy_from_slice(&l.to_be_bytes());
    }
}

pub fn script(vpk: &VpkSet, class: &str) -> Result<Vec<kv::Node>> {
    let path = format!("scripts/{class}");
    let bytes = match vpk.read(&format!("{path}.txt")) { Ok(b) => b, Err(_) => {
        let mut b = vpk.read(&format!("{path}.ctx")).map_err(|e| crate::binary::ParseError(e.to_string()))?;
        decrypt(&mut b); b
    }};
    let nodes = kv::parse(items::decode_text(&bytes).trim_end_matches('\0'))?;
    Ok(nodes.first().and_then(kv::Node::block).unwrap_or(&nodes).to_vec())
}

pub fn translated_class<'a>(weapon: &'a str, class: &str) -> &'a str {
    match (weapon,class) {
        ("tf_weapon_shotgun","soldier") => "tf_weapon_shotgun_soldier",
        ("tf_weapon_shotgun","heavy") => "tf_weapon_shotgun_hwg",
        ("tf_weapon_shotgun","pyro") => "tf_weapon_shotgun_pyro",
        ("tf_weapon_shotgun","engineer") => "tf_weapon_shotgun_primary",
        ("tf_weapon_pistol","scout") => "tf_weapon_pistol_scout",
        _ => weapon,
    }
}
