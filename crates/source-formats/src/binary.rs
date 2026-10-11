//! Small bounds-checked little-endian reader shared by the format parsers.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ParseError {}

pub type Result<T> = std::result::Result<T, ParseError>;

pub fn fail<T>(msg: impl Into<String>) -> Result<T> {
    Err(ParseError(msg.into()))
}

/// `base + rel` where `rel` is a (possibly negative) offset stored in a file.
pub fn offset(base: usize, rel: i32) -> Result<usize> {
    base.checked_add_signed(rel as isize)
        .map_or_else(|| fail(format!("offset {rel} from {base} out of range")), Ok)
}

pub struct Reader<'a> {
    buf: &'a [u8],
    pub pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn at(buf: &'a [u8], pos: usize) -> Self {
        Self { buf, pos }
    }

    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.pos.checked_add(n);
        match end.and_then(|e| self.buf.get(self.pos..e)) {
            Some(s) => {
                self.pos += n;
                Ok(s)
            }
            None => fail(format!(
                "read of {n} bytes at offset {} past end of data ({} bytes)",
                self.pos,
                self.buf.len()
            )),
        }
    }

    pub fn skip(&mut self, n: usize) {
        self.pos += n;
    }

    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    pub fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }
    pub fn i16(&mut self) -> Result<i16> {
        Ok(i16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }
    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn f32s<const N: usize>(&mut self) -> Result<[f32; N]> {
        let mut out = [0.0; N];
        for v in &mut out {
            *v = self.f32()?;
        }
        Ok(out)
    }

    /// Reads a fixed-size, NUL-padded string field.
    pub fn fixed_str(&mut self, n: usize) -> Result<String> {
        let b = self.bytes(n)?;
        let end = b.iter().position(|&c| c == 0).unwrap_or(n);
        Ok(String::from_utf8_lossy(&b[..end]).into_owned())
    }
}

/// Reads a NUL-terminated string starting at `pos`.
pub fn cstr_at(buf: &[u8], pos: usize) -> Result<String> {
    let Some(rest) = buf.get(pos..) else {
        return fail(format!("string offset {pos} past end of data"));
    };
    let end = rest.iter().position(|&c| c == 0).unwrap_or(rest.len());
    Ok(String::from_utf8_lossy(&rest[..end]).into_owned())
}

pub fn i32_at(buf: &[u8], pos: usize) -> Result<i32> {
    Reader::at(buf, pos).i32()
}

/// Checks a count read from a file before allocating/looping over it.
pub fn count(n: i32, what: &str, max: usize) -> Result<usize> {
    if n < 0 || n as usize > max {
        return fail(format!("implausible {what} count {n}"));
    }
    Ok(n as usize)
}

/// Converts an IEEE 754 half precision float.
pub fn half_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = ((bits >> 10) & 0x1f) as i32;
    let man = (bits & 0x3ff) as f32;
    match exp {
        0 => sign * man * 2f32.powi(-24),
        31 if man == 0.0 => sign * f32::INFINITY,
        31 => f32::NAN,
        _ => sign * (1.0 + man / 1024.0) * 2f32.powi(exp - 15),
    }
}
