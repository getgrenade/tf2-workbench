//! Lip sync data: the phonemes (with their times) and the emphasis curve of a voice line, in the text form of a `.wav`'s `VDAT` chunk
//! (`CSentence::InitFromDataChunk`, the Source SDK 2013's public/sentence.cpp). TF2's voice lines are `.mp3`, which cannot carry a chunk:
//! their sentences are in `scripts/game_sounds_vo_phonemes.txt`, each under the wave's path (`parse_phoneme_script`).

use std::collections::HashMap;

use crate::binary::{fail, Result};

/// A phoneme: its code (the IPA character as a Unicode code point, `ə` = 0x259) and when it is said, in seconds from the start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Phoneme {
    pub code: u32,
    pub start: f32,
    pub end: f32,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sentence {
    pub phonemes: Vec<Phoneme>,
    /// (time, 0..1): how strongly the line is said; 0.5 is neutral.
    pub emphasis: Vec<(f32, f32)>,
}

/// The `VDAT` chunk of a RIFF wave, if it has one.
pub fn wav_vdat(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?) as usize;
        let body = bytes.get(at + 8..(at + 8 + size).min(bytes.len()))?;
        if id == b"VDAT" {
            return Some(body);
        }
        at += 8 + size + (size & 1);
    }
    None
}

/// Whitespace-separated tokens (as `CUtlBuffer::GetString` reads a text buffer); a quoted string is one.
fn tokens(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_whitespace() || b[i] == 0 {
            i += 1;
        } else if b[i] == b'"' {
            let start = i + 1;
            i = start;
            while i < b.len() && b[i] != b'"' {
                i += 1;
            }
            out.push(&text[start..i]);
            i += 1;
        } else {
            let start = i;
            while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != 0 {
                i += 1;
            }
            out.push(&text[start..i]);
        }
    }
    out
}

/// Reads a sentence from its tokens, starting at `VERSION`; returns it and the index past the brace that closes the block it is in (or
/// the end).
fn sentence_from(t: &[&str], mut i: usize) -> Result<(Sentence, usize)> {
    let mut next = || {
        let s = t.get(i).copied().unwrap_or("");
        i += 1;
        s
    };
    if !next().eq_ignore_ascii_case("VERSION") {
        return fail("sentence: no VERSION");
    }
    next();
    let num = |s: &str| s.parse::<f32>().unwrap_or(0.0);
    let mut s = Sentence::default();
    loop {
        let section = next().to_ascii_uppercase();
        if section.is_empty() || section == "}" || next() != "{" {
            break;
        }
        match section.as_str() {
            "WORDS" => loop {
                if next() != "WORD" {
                    break;
                }
                next(); // the word
                next();
                next(); // its start and end
                if next() != "{" {
                    break;
                }
                loop {
                    let code = next();
                    if code == "}" || code.is_empty() {
                        break;
                    }
                    let code = code.parse::<u32>().unwrap_or(0);
                    next(); // its name
                    let (start, end) = (num(next()), num(next()));
                    next(); // volume
                    s.phonemes.push(Phoneme { code, start, end });
                }
            },
            "EMPHASIS" => loop {
                let a = next();
                if a == "}" || a.is_empty() {
                    break;
                }
                s.emphasis.push((num(a), num(next())));
            },
            _ => {
                // PLAINTEXT, OPTIONS and the obsolete CLOSECAPTION: skipped to their closing brace
                let mut depth = 1;
                while depth > 0 {
                    match next() {
                        "{" => depth += 1,
                        "}" => depth -= 1,
                        "" => break,
                        _ => {}
                    }
                }
            }
        }
    }
    drop(next);
    Ok((s, i))
}

/// A VDAT chunk (text: `VERSION 1.0`, then `PLAINTEXT`, `WORDS`, `EMPHASIS`, `OPTIONS` blocks).
pub fn parse_vdat(data: &[u8]) -> Result<Sentence> {
    let text = String::from_utf8_lossy(data);
    let t = tokens(&text);
    sentence_from(&t, 0).map(|(s, _)| s)
}

/// `scripts/game_sounds_vo_phonemes.txt`: wave path (from `sound/`, lower case, forward slashes) -> its sentence. Each entry is the path,
/// then the sentence in braces.
pub fn parse_phoneme_script(text: &str) -> HashMap<String, Sentence> {
    let t = tokens(text);
    let mut out = HashMap::new();
    let mut i = 0;
    while i + 2 < t.len() {
        if t[i + 1] == "{" && t[i + 2].eq_ignore_ascii_case("VERSION") {
            let path = t[i].replace('\\', "/").to_ascii_lowercase();
            match sentence_from(&t, i + 2) {
                Ok((s, past)) => {
                    if !s.phonemes.is_empty() {
                        out.insert(path, s);
                    }
                    i = past;
                }
                Err(_) => i += 1,
            }
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_vdat_chunk_reads() {
        let text = "VERSION 1.0\nPLAINTEXT\n{\nHello there\n}\nWORDS\n{\nWORD hello 0.1 0.4\n{\n104 h 0.1 0.2 1.0\n603 ɛ 0.2 0.4 1.0\n}\n}\nEMPHASIS\n{\n0.0 0.5\n0.3 0.9\n}\nOPTIONS\n{\nvoice_duck 1\n}\n";
        let s = parse_vdat(text.as_bytes()).unwrap();
        assert_eq!(s.phonemes, vec![Phoneme { code: 104, start: 0.1, end: 0.2 }, Phoneme { code: 603, start: 0.2, end: 0.4 }]);
        assert_eq!(s.emphasis, vec![(0.0, 0.5), (0.3, 0.9)]);
    }

    #[test]
    fn the_phoneme_script_files_a_sentence_under_each_wave() {
        let text = "vo\\burp02.mp3\n{\nVERSION 1.0\nPLAINTEXT\n{\n[Textless] \n}\nWORDS\n{\nWORD [Textless] 0.000 0.288\n{\n104 hh 0.000 0.032 1\n601 ax 0.032 0.064 1\n}\n}\nEMPHASIS\n{\n}\nOPTIONS\n{\nvoice_duck 0\n}\n}\n\nvo\\Burp03.mp3\n{\nVERSION 1.0\nWORDS\n{\nWORD x 0 0.1\n{\n95 <sil> 0.000 0.032 1\n}\n}\n}\n";
        let map = parse_phoneme_script(text);
        assert_eq!(map.len(), 2);
        assert_eq!(map["vo/burp02.mp3"].phonemes[1], Phoneme { code: 601, start: 0.032, end: 0.064 });
        assert_eq!(map["vo/burp03.mp3"].phonemes.len(), 1);
    }

    #[test]
    fn a_wave_chunk_is_found() {
        let mut wav = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        wav.extend_from_slice(&3u32.to_le_bytes());
        wav.extend_from_slice(&[1, 2, 3, 0]); // odd size: padded
        wav.extend_from_slice(b"VDAT");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(b"ok");
        assert_eq!(wav_vdat(&wav), Some(&b"ok"[..]));
    }
}
