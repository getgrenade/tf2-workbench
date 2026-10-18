//! Faces and voices: the choreography scenes of taunts (`scenes/scenes.image`), the expression settings their events name, the sound
//! scripts that name the waves their speak events play, the lip sync of those waves and the class's phoneme mouth shapes. Read once per
//! indexed install and kept.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use source_formats::{choreo, sentence, soundscript, vfe, VpkSet};

use crate::state::AppState;

/// What is read once: the scenes, the sound scripts and the voice lines' lip sync; the expression files as they are asked for.
pub struct VoiceData {
    image: Option<choreo::SceneImage>,
    sounds: BTreeMap<String, soundscript::SoundEntry>,
    /// The voice lines' sentences (`scripts/game_sounds_vo_phonemes.txt`), by wave path from `sound/`.
    sentences: HashMap<String, sentence::Sentence>,
    /// Expression files by path (`player/heavy/emotion/emotion`), parsed when first asked for.
    expressions: Mutex<HashMap<String, Option<Arc<vfe::ExpressionFile>>>>,
}

impl VoiceData {
    fn load(vpk: &VpkSet) -> Self {
        let image = vpk.read("scenes/scenes.image").ok().and_then(|b| choreo::SceneImage::parse(b).ok());
        let mut sounds = BTreeMap::new();
        if let Ok(manifest) = vpk.read("scripts/game_sounds_manifest.txt") {
            for file in soundscript::manifest_files(&String::from_utf8_lossy(&manifest)) {
                if let Ok(b) = vpk.read(&file) {
                    soundscript::parse_script(&String::from_utf8_lossy(&b), &mut sounds);
                }
            }
        }
        let sentences = vpk
            .read("scripts/game_sounds_vo_phonemes.txt")
            .map(|b| sentence::parse_phoneme_script(&String::from_utf8_lossy(&b)))
            .unwrap_or_default();
        Self { image, sounds, sentences, expressions: Mutex::new(HashMap::new()) }
    }

    fn expression_file(&self, vpk: &VpkSet, path: &str) -> Option<Arc<vfe::ExpressionFile>> {
        let key = path.replace('\\', "/").to_ascii_lowercase();
        let key = key.strip_suffix(".vfe").unwrap_or(&key).to_string();
        let mut cache = self.expressions.lock().unwrap();
        cache
            .entry(key.clone())
            .or_insert_with(|| vpk.read(&format!("expressions/{key}.vfe")).ok().and_then(|b| vfe::parse(&b).ok()).map(Arc::new))
            .clone()
    }
}

impl AppState {
    pub fn voice(&self) -> Result<Arc<VoiceData>, String> {
        let mut cache = self.voice.lock().unwrap();
        if let Some(v) = &*cache {
            return Ok(v.clone());
        }
        let vpk = self.vpk()?;
        let data = Arc::new(VoiceData::load(&vpk));
        *cache = Some(data.clone());
        Ok(data)
    }
}

fn samples(list: &[choreo::Sample]) -> Value {
    Value::Array(list.iter().map(|s| json!([s.time, s.value, s.curve])).collect())
}

/// A scene for playback: its active events (times in seconds from the start of the scene), the expression settings they name
/// (controller weights and influences) and the waves of the sounds its speak events play. Null when the game has no such scene.
pub fn scene(state: &AppState, path: &str) -> Result<Value, String> {
    let v = state.voice()?;
    let vpk = state.vpk()?;
    let Some(image) = &v.image else { return Ok(Value::Null) };
    let Some(scene) = image.scene(path).map_err(|e| e.to_string())? else { return Ok(Value::Null) };
    let mut expressions = serde_json::Map::new();
    let mut sounds = serde_json::Map::new();
    let mut events = Vec::new();
    for e in scene.all_events().filter(|e| e.active) {
        match e.kind {
            choreo::EXPRESSION => {
                let file_key = e.params.replace('\\', "/").to_ascii_lowercase();
                if let Some(file) = v.expression_file(&vpk, &e.params) {
                    if let Some(setting) = file.settings.iter().find(|s| s.name.eq_ignore_ascii_case(&e.params2)) {
                        let entry = expressions.entry(file_key).or_insert_with(|| json!({}));
                        entry[e.params2.to_ascii_lowercase()] = Value::Array(setting.weights.iter().map(|(c, w, i)| json!([c, w, i])).collect());
                    }
                }
            }
            choreo::SPEAK => {
                // a speak event names a sound script entry, or (rarely) a wave itself
                let waves = match v.sounds.get(&e.params.to_ascii_lowercase()) {
                    Some(entry) => entry.waves.clone(),
                    None if e.params.contains('.') && e.params.contains(['/', '\\']) => vec![soundscript::clean_wave(&e.params)],
                    None => Vec::new(),
                };
                sounds.insert(e.params.to_ascii_lowercase(), json!({ "name": e.params, "waves": waves }));
            }
            _ => {}
        }
        events.push(json!({
            "kind": choreo::EVENT_NAMES.get(e.kind as usize).copied().unwrap_or("unknown"),
            "name": e.name,
            "start": e.start,
            "end": e.end,
            "params": e.params,
            "params2": e.params2,
            "ramp": samples(&e.ramp),
            "tracks": e.tracks.iter().filter(|t| t.active).map(|t| json!({
                "controller": t.controller, "combo": t.combo, "min": t.min, "max": t.max,
                "samples": samples(&t.samples), "balance": samples(&t.balance),
            })).collect::<Vec<_>>(),
        }));
    }
    Ok(json!({ "path": path, "events": events, "ramp": samples(&scene.ramp), "expressions": expressions, "sounds": sounds }))
}

/// Of `paths` (scenes, in order), the first that plays `sequence` (has a sequence event of it); None when none does or the game has
/// none of them.
pub fn scene_playing(state: &AppState, paths: &[String], sequence: &str) -> Result<Option<String>, String> {
    let v = state.voice()?;
    let Some(image) = &v.image else { return Ok(None) };
    Ok(paths
        .iter()
        .find(|p| {
            image.scene(p).ok().flatten().is_some_and(|s| s.all_events().any(|e| e.kind == choreo::SEQUENCE && e.params.eq_ignore_ascii_case(sequence)))
        })
        .cloned())
}

/// "PlayerCloakedSpyDemomanHeavy" -> "Cloaked spy demoman" (the words split, "Player" and the speaker's own class left out).
fn response_label(name: &str, class: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    for c in name.chars() {
        if c == '_' || c == ' ' {
            words.push(String::new());
        } else if c.is_ascii_uppercase() || words.is_empty() {
            words.push(c.to_ascii_lowercase().to_string());
        } else if let Some(w) = words.last_mut() {
            w.push(c.to_ascii_lowercase());
        }
    }
    let words: Vec<String> = words.into_iter().filter(|w| !w.is_empty()).collect();
    let kept: Vec<&str> = words.iter().enumerate().filter(|&(i, w)| !(w == class || (i == 0 && w == "player"))).map(|(_, w)| w.as_str()).collect();
    let out = if kept.is_empty() { words.join(" ") } else { kept.join(" ") };
    let mut chars = out.chars();
    chars.next().map(|f| f.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
}

/// The voice lines of a class, from its response rules (`scripts/talker/<class>.txt` and `<class>_auto.txt`): each response's scenes,
/// with the sound the scene speaks and its waves, grouped by the response (what the line is for), in the rules' order.
pub fn voice_lines(state: &AppState, class: &str) -> Result<Value, String> {
    let v = state.voice()?;
    let vpk = state.vpk()?;
    let class = if class == "demo" { "demoman" } else { class }.to_ascii_lowercase();
    let Some(image) = &v.image else { return Ok(json!([])) };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for file in [format!("scripts/talker/{class}.txt"), format!("scripts/talker/{class}_auto.txt")] {
        let Ok(bytes) = vpk.read(&file) else { continue };
        let text = String::from_utf8_lossy(&bytes).to_string();
        let mut group = String::new();
        for line in text.lines() {
            let t = line.trim();
            let lower = t.to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("response ") {
                let name = t[t.len() - rest.len()..].split_whitespace().next().unwrap_or("");
                group = response_label(name.trim_matches('"'), &class);
                continue;
            }
            if !lower.starts_with("scene") {
                continue;
            }
            let Some(path) = t.split('"').nth(1) else { continue };
            if !seen.insert(path.to_ascii_lowercase()) {
                continue;
            }
            let Ok(Some(scene)) = image.scene(path) else { continue };
            let Some(speak) = scene.all_events().find(|e| e.kind == choreo::SPEAK) else { continue };
            let Some(entry) = v.sounds.get(&speak.params.to_ascii_lowercase()) else { continue };
            let end = scene.all_events().map(|e| e.end).fold(0.0f32, f32::max);
            out.push(json!({ "group": group, "scene": path, "sound": { "name": entry.name, "waves": entry.waves }, "duration": end }));
        }
    }
    Ok(Value::Array(out))
}

/// The lip sync of a wave (from `sound/`): the voice lines' phoneme script, else the wave's own `VDAT` chunk. Null when it has none.
pub fn lip_sync(state: &AppState, wave: &str) -> Result<Value, String> {
    let v = state.voice()?;
    let key = soundscript::clean_wave(wave);
    let from_file = || {
        let bytes = state.vpk().ok()?.read(&format!("sound/{key}")).ok()?;
        sentence::parse_vdat(sentence::wav_vdat(&bytes)?).ok()
    };
    Ok(match v.sentences.get(&key).cloned().or_else(from_file) {
        Some(s) if !s.phonemes.is_empty() => json!({
            "phonemes": s.phonemes.iter().map(|p| json!([p.code, p.start, p.end])).collect::<Vec<_>>(),
            "emphasis": s.emphasis.iter().map(|(t, e)| json!([t, e])).collect::<Vec<_>>(),
        }),
        _ => Value::Null,
    })
}

/// A sound file's bytes (`vo/heavy_taunts05.mp3`, from `sound/`).
pub fn read_sound(state: &AppState, wave: &str) -> Result<Vec<u8>, String> {
    state.vpk()?.read(&format!("sound/{}", soundscript::clean_wave(wave))).map_err(|e| e.to_string())
}

/// The class's phoneme mouth shapes, as two sets: `plain` (`expressions/player/<class>/phonemes/phonemes*.vfe`, which drive the class
/// model's viseme controllers: AH, EEE, OH, ...) and `hwm` (`expressions/player/hwm/<class>/...`, the facial muscles of the high quality
/// heads: JawV, Smile, ...). The caller takes the one whose controllers its model has. Each: the normal, weak and strong classes,
/// phoneme code -> [controller, weight] pairs.
pub fn phoneme_classes(state: &AppState, class: &str) -> Result<Value, String> {
    let v = state.voice()?;
    let vpk = state.vpk()?;
    let class = if class == "demo" { "demoman" } else { class };
    let mut sets = serde_json::Map::new();
    for (set, folder) in [("plain", format!("player/{class}")), ("hwm", format!("player/hwm/{class}"))] {
        let mut out = serde_json::Map::new();
        for (key, suffix) in [("normal", ""), ("weak", "_weak"), ("strong", "_strong")] {
            let Some(file) = v.expression_file(&vpk, &format!("{folder}/phonemes/phonemes{suffix}")) else { continue };
            let mut map = serde_json::Map::new();
            for (code, &i) in file.index.iter().enumerate() {
                if let Some(s) = (i >= 0).then(|| file.settings.get(i as usize)).flatten() {
                    map.insert(code.to_string(), Value::Array(s.weights.iter().map(|(c, w, _)| json!([c, w])).collect()));
                }
            }
            out.insert(key.to_string(), Value::Object(map));
        }
        if !out.is_empty() {
            sets.insert(set.to_string(), Value::Object(out));
        }
    }
    Ok(Value::Object(sets))
}
