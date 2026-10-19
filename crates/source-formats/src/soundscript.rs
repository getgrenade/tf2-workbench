//! Sound scripts (`scripts/game_sounds_*.txt`, listed by `scripts/game_sounds_manifest.txt`): a sound's name (`Heavy.Taunts05`) and the
//! wave files it plays: one (`wave`), or one of a pool picked at random each time (`rndwave`).

use std::collections::BTreeMap;

use crate::kv::{self, Node};

#[derive(Debug, Clone, PartialEq)]
pub struct SoundEntry {
    /// The name as the script spells it.
    pub name: String,
    /// Paths from `sound/`, with forward slashes, in lower case, without the leading characters that set how a sound plays (`)`, `^`,
    /// `#`, `*`, `@`, ...).
    pub waves: Vec<String>,
}

/// A wave path as the engine looks it up (`)vo\Heavy_Taunts05.mp3` -> `vo/heavy_taunts05.mp3`).
pub fn clean_wave(path: &str) -> String {
    path.trim_start_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '.').replace('\\', "/").to_ascii_lowercase()
}

/// The script files the manifest lists, in its order.
pub fn manifest_files(text: &str) -> Vec<String> {
    let Ok(nodes) = kv::parse(text) else { return Vec::new() };
    let root = nodes.first().and_then(Node::block).unwrap_or(&[]);
    root.iter().filter_map(|n| n.as_str()).map(|p| p.replace('\\', "/").to_ascii_lowercase()).collect()
}

/// The entries of one script file, by name in lower case (a later definition of a name replaces an earlier one, as in the engine).
pub fn parse_script(text: &str, into: &mut BTreeMap<String, SoundEntry>) {
    let Ok(nodes) = kv::parse(text) else { return };
    for entry in &nodes {
        let Some(body) = entry.block() else { continue };
        let mut waves = Vec::new();
        for n in body {
            if n.key.eq_ignore_ascii_case("wave") {
                waves.extend(n.as_str().map(clean_wave));
            } else if n.key.eq_ignore_ascii_case("rndwave") {
                waves.extend(n.block().unwrap_or(&[]).iter().filter_map(|w| w.as_str()).map(clean_wave));
            }
        }
        if !waves.is_empty() {
            into.insert(entry.key.to_ascii_lowercase(), SoundEntry { name: entry.key.clone(), waves });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_with_one_wave_or_a_pool() {
        let mut map = BTreeMap::new();
        parse_script(
            r#""Heavy.Taunts05" { "channel" "CHAN_VOICE" "wave" ")vo\Heavy_Taunts05.mp3" }
               "Heavy.Laugh" { "rndwave" { "wave" "vo/heavy_laugh01.mp3" "wave" "^vo/heavy_laugh02.mp3" } }
               "Heavy.Nothing" { "channel" "CHAN_VOICE" }"#,
            &mut map,
        );
        assert_eq!(map["heavy.taunts05"].waves, vec!["vo/heavy_taunts05.mp3"]);
        assert_eq!(map["heavy.laugh"].waves, vec!["vo/heavy_laugh01.mp3", "vo/heavy_laugh02.mp3"]);
        assert!(!map.contains_key("heavy.nothing"));
    }
}
