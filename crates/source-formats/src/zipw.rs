//! A minimal ZIP writer for the archives the item importer produces: stored (uncompressed) entries with zeroed dates, the archive comment
//! `XZP1 0`, and the importer's backslash path separators. `zipfs.rs` reads them back, and so does the game's own importer.

use std::{fs, io, path::Path};

/// The CRC-32 (IEEE) of a byte string, as zip and the VTF resource directory use it.
pub fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, entry) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 { c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 }; }
            *entry = c;
        }
        t
    });
    !data.iter().fold(!0u32, |c, &b| table[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8))
}

#[derive(Default)]
pub struct ZipBuilder {
    entries: Vec<(String, Vec<u8>)>,
}

impl ZipBuilder {
    pub fn new() -> Self { Self::default() }

    /// Adds a file under a path of the archive (forward or backward slashes; stored with backslashes).
    pub fn add(&mut self, name: &str, data: Vec<u8>) {
        self.entries.push((name.replace('/', "\\"), data));
    }

    pub fn len(&self) -> usize { self.entries.len() }
    pub fn is_empty(&self) -> bool { self.entries.is_empty() }

    pub fn to_bytes(&self) -> Vec<u8> {
        let comment = b"XZP1 0";
        let mut out: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        for (name, data) in &self.entries {
            let offset = out.len() as u32;
            let crc = crc32(data);
            let (n, size) = (name.as_bytes(), data.len() as u32);
            // local file header: version 1.0, no flags, stored, time and date zero
            out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&(n.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(n);
            out.extend_from_slice(data);
            central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 10, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&(n.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]); // extra, comment, disk, internal attributes, external attributes
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(n);
        }
        let central_offset = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
        out.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&central_offset.to_le_bytes());
        out.extend_from_slice(&(comment.len() as u16).to_le_bytes());
        out.extend_from_slice(comment);
        out
    }

    /// Writes the archive next to its final name first, so an interrupted build never leaves half a zip under the real one.
    pub fn write(&self, path: &Path) -> io::Result<()> {
        let temp = path.with_extension("zip.part");
        fs::write(&temp, self.to_bytes())?;
        fs::rename(&temp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zipfs::ZipFile;

    #[test]
    fn crc_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn the_zip_reader_reads_back_what_was_written() {
        let mut zip = ZipBuilder::new();
        zip.add("manifest.txt", b"\"asset\" {}".to_vec());
        zip.add("game/models/workshop/x/a.mdl", vec![1, 2, 3, 4]);
        zip.add("content\\models\\a.smd", b"version 1\n".to_vec());
        let dir = std::env::temp_dir().join(format!("workbench-zipw-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.zip");
        zip.write(&path).unwrap();
        let read = ZipFile::open(&path).unwrap();
        assert_eq!(read.read("manifest.txt").unwrap(), b"\"asset\" {}");
        assert_eq!(read.read("models/workshop/x/a.mdl").unwrap(), [1, 2, 3, 4]);
        assert!(read.contains("content/models/a.smd"));
        assert!(!path.with_extension("zip.part").exists());
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.ends_with(b"XZP1 0"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
