//! A minimal read-only ZIP reader for the zips the in-game workshop importer writes: a `manifest.txt` and a `game\` folder that mirrors the
//! game's own file layout (`game\models\workshop\...`, `game\materials\...`). Only stored and deflated entries are supported, which is
//! all that tool produces; a map's pakfile ([`ZipFile::open_bsp`]) has stored and LZMA entries.

use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy)]
struct Entry {
    method: u16,
    compressed: u64,
    size: u64,
    local_offset: u64,
}

#[derive(Debug, Clone)]
pub struct ZipFile {
    pub path: PathBuf,
    /// Where the zip starts in the file: 0 for a zip, the pakfile lump's offset in a map (`.bsp`).
    base: u64,
    /// Game-relative lowercase paths (`models/workshop/player/items/heavy/a_hat/a_hat.mdl`) of the entries under `game\`, plus `manifest.txt`.
    entries: HashMap<String, Entry>,
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// The path an entry is served under: without the leading `game\`, forward slashes, lowercase. Entries outside `game\` (the importer's
/// `content\` sources) are not served; the manifest is.
fn virtual_path(name: &str) -> Option<String> {
    let n = name.replace('\\', "/").to_ascii_lowercase();
    if n == "manifest.txt" {
        return Some(n);
    }
    // Taunts ship source DMX/QCI files instead of MDLs (SDK AddTauntToAsset).
    if n.starts_with("content/") && !n.ends_with('/') { return Some(n); }
    n.strip_prefix("game/").filter(|r| !r.is_empty() && !r.ends_with('/')).map(str::to_string)
}

/// The path an entry of a custom effect zip is served under. These zips hold a game-like folder tree, usually under a folder of their own
/// (`unusual_spellbook/particles/x.pcf`, `unusual_spellbook/materials/effects/x.vtf`): whatever comes before the first `particles`,
/// `materials` or `models` folder is dropped, and only files of those folders are served.
fn effect_virtual_path(name: &str) -> Option<String> {
    let n = name.replace('\\', "/").to_ascii_lowercase();
    if n.ends_with('/') { return None; }
    let parts: Vec<&str> = n.split('/').filter(|p| !p.is_empty()).collect();
    if parts.iter().any(|p| *p == "..") { return None; }
    let at = parts.iter().position(|p| matches!(*p, "particles" | "materials" | "models"))?;
    (at + 1 < parts.len()).then(|| parts[at..].join("/"))
}

impl ZipFile {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        Self::open_with(path, virtual_path)
    }

    /// Opens a custom effect zip (see [`effect_virtual_path`]).
    pub fn open_effect(path: &Path) -> std::io::Result<Self> {
        Self::open_with(path, effect_virtual_path)
    }

    /// Opens the files a map (`.bsp`) packs in it, its pakfile lump: a zip (of stored or LZMA entries) of game paths, like the models and
    /// materials of Versus Saxton Hale's bosses.
    pub fn open_bsp(path: &Path) -> std::io::Result<Self> {
        let mut f = File::open(path)?;
        let mut head = vec![0u8; 8 + 64 * 16];
        f.read_exact(&mut head)?;
        let bad = || std::io::Error::new(std::io::ErrorKind::InvalidData, "not a map");
        if head[..4] != *b"VBSP" { return Err(bad()); }
        // LUMP_PAKFILE is the 40th: its offset and length
        let off = u32_at(&head, 8 + 40 * 16).ok_or_else(bad)? as u64;
        let len = u32_at(&head, 8 + 40 * 16 + 4).ok_or_else(bad)? as u64;
        if len < 22 { return Err(bad()); }
        Self::open_in(path, off, len, |n| {
            let n = n.replace('\\', "/").to_ascii_lowercase();
            (!n.ends_with('/')).then_some(n)
        })
    }

    fn open_with(path: &Path, serve: fn(&str) -> Option<String>) -> std::io::Result<Self> {
        let len = std::fs::metadata(path)?.len();
        Self::open_in(path, 0, len, serve)
    }

    fn open_in(path: &Path, base: u64, len: u64, serve: impl Fn(&str) -> Option<String>) -> std::io::Result<Self> {
        let mut f = File::open(path)?;
        // the end-of-central-directory record is in the last 64 KB + 22 bytes
        let tail_len = len.min(65_557) as usize;
        f.seek(SeekFrom::Start(base + len - tail_len as u64))?;
        let mut tail = vec![0u8; tail_len];
        f.read_exact(&mut tail)?;
        let bad = || std::io::Error::new(std::io::ErrorKind::InvalidData, "not a readable zip file");
        let eocd = (0..tail_len.saturating_sub(21)).rev().find(|&i| tail[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]).ok_or_else(bad)?;
        let count = u16_at(&tail, eocd + 10).ok_or_else(bad)? as usize;
        let cd_size = u32_at(&tail, eocd + 12).ok_or_else(bad)? as u64;
        let cd_offset = u32_at(&tail, eocd + 16).ok_or_else(bad)? as u64;
        f.seek(SeekFrom::Start(base + cd_offset))?;
        let mut cd = vec![0u8; cd_size as usize];
        f.read_exact(&mut cd)?;
        let mut entries = HashMap::new();
        let mut at = 0usize;
        for _ in 0..count {
            if cd.get(at..at + 4) != Some(&[0x50, 0x4b, 0x01, 0x02]) {
                return Err(bad());
            }
            let method = u16_at(&cd, at + 10).ok_or_else(bad)?;
            let compressed = u32_at(&cd, at + 20).ok_or_else(bad)? as u64;
            let size = u32_at(&cd, at + 24).ok_or_else(bad)? as u64;
            let name_len = u16_at(&cd, at + 28).ok_or_else(bad)? as usize;
            let extra_len = u16_at(&cd, at + 30).ok_or_else(bad)? as usize;
            let comment_len = u16_at(&cd, at + 32).ok_or_else(bad)? as usize;
            let local_offset = u32_at(&cd, at + 42).ok_or_else(bad)? as u64;
            let name = String::from_utf8_lossy(cd.get(at + 46..at + 46 + name_len).ok_or_else(bad)?).into_owned();
            if let Some(v) = serve(&name) {
                entries.entry(v).or_insert(Entry { method, compressed, size, local_offset });
            }
            at += 46 + name_len + extra_len + comment_len;
        }
        Ok(ZipFile { path: path.to_path_buf(), base, entries })
    }

    /// The served paths (game-relative, lowercase).
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    pub fn contains(&self, path: &str) -> bool {
        self.entries.contains_key(path)
    }

    pub fn size_of(&self, path: &str) -> Option<u64> {
        self.entries.get(path).map(|e| e.size)
    }

    /// The contents of an entry by its served path, or `None` when it is not there or cannot be read.
    pub fn read(&self, path: &str) -> Option<Vec<u8>> {
        let e = *self.entries.get(path)?;
        let mut f = File::open(&self.path).ok()?;
        f.seek(SeekFrom::Start(self.base + e.local_offset)).ok()?;
        let mut head = [0u8; 30];
        f.read_exact(&mut head).ok()?;
        if head[..4] != [0x50, 0x4b, 0x03, 0x04] {
            return None;
        }
        let skip = u16_at(&head, 26)? as u64 + u16_at(&head, 28)? as u64;
        f.seek(SeekFrom::Current(skip as i64)).ok()?;
        let mut raw = vec![0u8; e.compressed as usize];
        f.read_exact(&mut raw).ok()?;
        match e.method {
            0 => Some(raw),
            8 => miniz_oxide::inflate::decompress_to_vec(&raw).ok().filter(|d| d.len() as u64 == e.size),
            // LZMA, as a map's pakfile has it: a version (2 bytes), the size of the properties (2), the properties, then the stream
            14 => {
                let props_len = u16_at(&raw, 2)? as usize;
                let props = raw.get(4..4 + props_len)?;
                let mut stream = Vec::with_capacity(13 + raw.len());
                stream.extend_from_slice(props);
                stream.extend_from_slice(&e.size.to_le_bytes());
                stream.extend_from_slice(raw.get(4 + props_len..)?);
                let mut out = Vec::with_capacity(e.size as usize);
                lzma_rs::lzma_decompress(&mut std::io::Cursor::new(stream), &mut out).ok()?;
                (out.len() as u64 == e.size).then_some(out)
            }
            _ => None,
        }
    }

    pub fn manifest(&self) -> Option<String> {
        self.read("manifest.txt").map(|b| String::from_utf8_lossy(&b).into_owned())
    }
}

#[cfg(test)]
mod effect_tests {
    use super::effect_virtual_path as served;

    #[test]
    fn a_custom_effect_zip_is_served_from_its_game_like_folders() {
        assert_eq!(served("unusual_spellbook/particles/unusual_spellbook.pcf").as_deref(), Some("particles/unusual_spellbook.pcf"));
        assert_eq!(served(r"Unusual_Spellbook\Materials\Effects\Potion\Book1.VTF").as_deref(), Some("materials/effects/potion/book1.vtf"));
        assert_eq!(served("particles/x.pcf").as_deref(), Some("particles/x.pcf"));
        assert_eq!(served("a/b/c/models/x/y.mdl").as_deref(), Some("models/x/y.mdl"));
        // folders, files outside those trees and ways out of them are not served
        assert_eq!(served("unusual_spellbook/materials/"), None);
        assert_eq!(served("unusual_spellbook/readme.txt"), None);
        assert_eq!(served("particles"), None);
        assert_eq!(served("x/../particles/y.pcf"), None);
    }
}

#[cfg(test)]
mod bsp_tests {
    use super::*;

    /// A map whose pakfile lump holds one LZMA entry, as Valve's tools write it.
    fn map_with(name: &str, data: &[u8]) -> Vec<u8> {
        let mut alone = Vec::new();
        lzma_rs::lzma_compress(&mut std::io::Cursor::new(data), &mut alone).unwrap();
        // the .lzma header is the properties (5 bytes) and the unpacked size (8): a zip entry has a version and the properties' size instead
        let mut raw = vec![9, 0x26, 5, 0];
        raw.extend_from_slice(&alone[..5]);
        raw.extend_from_slice(&alone[13..]);
        let mut zip = Vec::new();
        let local = |z: &mut Vec<u8>| {
            z.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 14, 0]);
            z.extend_from_slice(&[0; 8]);
            z.extend_from_slice(&(raw.len() as u32).to_le_bytes());
            z.extend_from_slice(&(data.len() as u32).to_le_bytes());
            z.extend_from_slice(&(name.len() as u16).to_le_bytes());
            z.extend_from_slice(&[0, 0]);
            z.extend_from_slice(name.as_bytes());
            z.extend_from_slice(&raw);
        };
        local(&mut zip);
        let cd = zip.len();
        zip.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 0, 0, 0, 0, 0, 0, 14, 0]);
        zip.extend_from_slice(&[0; 8]);
        zip.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
        zip.extend_from_slice(&[0; 12]);
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(name.as_bytes());
        let cd_size = zip.len() - cd;
        zip.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0]);
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd as u32).to_le_bytes());
        zip.extend_from_slice(&[0, 0]);
        let mut bsp = b"VBSP".to_vec();
        bsp.extend_from_slice(&20u32.to_le_bytes());
        bsp.resize(8 + 64 * 16 + 4, 0);
        let off = bsp.len() as u32;
        bsp[8 + 40 * 16..8 + 40 * 16 + 4].copy_from_slice(&off.to_le_bytes());
        bsp[8 + 40 * 16 + 4..8 + 40 * 16 + 8].copy_from_slice(&(zip.len() as u32).to_le_bytes());
        bsp.extend_from_slice(&zip);
        bsp.extend_from_slice(&[0; 32]); // (the lumps after it)
        bsp
    }

    #[test]
    fn reads_an_lzma_entry_of_a_maps_pakfile() {
        let data = b"IDST saxton hale, saxton hale, saxton hale".repeat(20);
        let dir = std::env::temp_dir().join(format!("wb-bsp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("vsh_test.bsp");
        std::fs::write(&path, map_with("Models/VSH/Player/Saxton_Hale.mdl", &data)).unwrap();
        let zip = ZipFile::open_bsp(&path).unwrap();
        assert_eq!(zip.read("models/vsh/player/saxton_hale.mdl").as_deref(), Some(&data[..]));
        assert!(ZipFile::open_bsp(&dir.join("missing.bsp")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
