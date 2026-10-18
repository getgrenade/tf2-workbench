//! Choreography scenes: `scenes/scenes.image` (every `.vcd` of the game, compiled to binary VCD and mostly LZMA-compressed) and the
//! binary VCD format itself. A port of the Source SDK 2013's `CChoreoScene::RestoreFromBinaryBuffer` and the event, actor, channel and
//! curve readers it calls (game/shared/choreo*.cpp), and of `SceneImageFile.h`.
//!
//! A scene is a timeline: events on channels of actors. The ones that matter here are the flex animations (the facial keyframes drawn
//! in Faceposer, by flex controller), the speak events (a sound script entry: the voice line, with its lip sync) and the
//! sequences and gestures (the body animation the scene plays).

use std::collections::HashMap;

use crate::binary::{fail, Reader, Result};

const IMAGE_ID: u32 = u32::from_le_bytes(*b"VSIF");
const BVCD_ID: u32 = u32::from_le_bytes(*b"bvcd");
const LZMA_ID: u32 = u32::from_le_bytes(*b"LZMA");
const BVCD_VERSION: u8 = 4;

/// Event types (`CChoreoEvent::EVENTTYPE`).
pub const EVENT_NAMES: [&str; 18] = [
    "unspecified", "section", "expression", "lookat", "moveto", "speak", "gesture", "sequence", "face", "firetrigger", "flexanimation",
    "subscene", "loop", "interrupt", "stoppoint", "permitresponses", "generic", "camera",
];
pub const EXPRESSION: u8 = 2;
pub const SPEAK: u8 = 5;
pub const GESTURE: u8 = 6;
pub const SEQUENCE: u8 = 7;
pub const FLEXANIMATION: u8 = 10;
pub const LOOP: u8 = 12;

/// A sample of a curve: time (seconds from the start of its event), value (0..1) and curve type (`MAKE_CURVE_TYPE(in, out)`; 0 is the
/// event's default).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub time: f32,
    pub value: f32,
    pub curve: u16,
}

/// A flex controller animated over its event: `samples` give the value (0..1 of `min..max`), and a combo (stereo) track has a second
/// curve, `balance`, that shares it between the `left_` and `right_` controllers.
#[derive(Debug, Clone)]
pub struct FlexTrack {
    pub controller: String,
    pub active: bool,
    pub combo: bool,
    pub min: f32,
    pub max: f32,
    pub samples: Vec<Sample>,
    pub balance: Vec<Sample>,
}

#[derive(Debug, Clone)]
pub struct Event {
    pub kind: u8,
    pub name: String,
    pub start: f32,
    /// -1: the event has no end time.
    pub end: f32,
    pub params: String,
    pub params2: String,
    pub params3: String,
    /// The event's intensity over its duration (none: full).
    pub ramp: Vec<Sample>,
    pub active: bool,
    pub tracks: Vec<FlexTrack>,
    /// Speak events: the close caption token (empty: the sound's own name).
    pub caption: String,
    pub loop_count: i32,
}

#[derive(Debug, Clone)]
pub struct Channel {
    pub name: String,
    pub active: bool,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone)]
pub struct Actor {
    pub name: String,
    pub active: bool,
    pub channels: Vec<Channel>,
}

#[derive(Debug, Clone)]
pub struct Scene {
    /// The scene's own events (sections, loops), not on an actor.
    pub events: Vec<Event>,
    pub actors: Vec<Actor>,
    /// The intensity of the whole scene over time (none: full).
    pub ramp: Vec<Sample>,
    pub ignore_phonemes: bool,
}

impl Scene {
    /// Every event of the scene, the actors' and its own.
    pub fn all_events(&self) -> impl Iterator<Item = &Event> {
        self.events.iter().chain(self.actors.iter().flat_map(|a| a.channels.iter().flat_map(|c| c.events.iter())))
    }
}

/// `scenes.image`: the string pool and where each scene is, by the CRC of its path.
pub struct SceneImage {
    data: Vec<u8>,
    strings: Vec<String>,
    entries: HashMap<u32, (usize, usize)>,
}

/// The CRC a scene is filed under: of its path in lower case with backslashes (`scenes\player\heavy\low\taunt01.vcd`).
pub fn scene_crc(path: &str) -> u32 {
    let mut p = path.trim().to_ascii_lowercase().replace('/', "\\");
    if !p.starts_with("scenes\\") {
        p = format!("scenes\\{p}");
    }
    if !p.ends_with(".vcd") {
        p.push_str(".vcd");
    }
    crc32fast::hash(p.as_bytes())
}

impl SceneImage {
    pub fn parse(data: Vec<u8>) -> Result<Self> {
        let mut r = Reader::new(&data);
        if r.u32()? != IMAGE_ID {
            return fail("not a scenes.image (no VSIF id)");
        }
        let version = r.u32()?;
        if version != 2 && version != 3 {
            return fail(format!("scenes.image version {version} is not supported"));
        }
        let scenes = r.u32()? as usize;
        let strings = r.u32()? as usize;
        let entry_offset = r.u32()? as usize;
        let mut pool = Vec::with_capacity(strings);
        for _ in 0..strings {
            let at = r.u32()? as usize;
            pool.push(crate::binary::cstr_at(&data, at)?);
        }
        let mut entries = HashMap::with_capacity(scenes);
        let mut e = Reader::at(&data, entry_offset);
        for _ in 0..scenes {
            let crc = e.u32()?;
            let offset = e.u32()? as usize;
            let length = e.u32()? as usize;
            let _summary = e.u32()?;
            entries.insert(crc, (offset, length));
        }
        Ok(Self { data, strings: pool, entries })
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The scene at `path` (`scenes/player/heavy/low/taunt01.vcd`), or None when the image does not have it.
    pub fn scene(&self, path: &str) -> Result<Option<Scene>> {
        let Some(&(offset, length)) = self.entries.get(&scene_crc(path)) else { return Ok(None) };
        let Some(raw) = self.data.get(offset..offset + length) else { return fail("scene entry out of range") };
        let bytes = decompress(raw)?;
        parse_bvcd(&bytes, &self.strings).map(Some)
    }
}

/// A scene's bytes as stored: binary VCD, or Valve's LZMA wrapper around it (`LZMA`, real size, packed size, the 5 property bytes).
pub fn decompress(raw: &[u8]) -> Result<Vec<u8>> {
    let mut r = Reader::new(raw);
    if r.u32()? != LZMA_ID {
        return Ok(raw.to_vec());
    }
    let actual = r.u32()? as u64;
    let packed = r.u32()? as usize;
    let props = r.bytes(5)?;
    let body = r.bytes(packed.min(raw.len().saturating_sub(17)))?;
    // the .lzma ("alone") stream lzma-rs reads: the properties, then the unpacked size, then the data
    let mut stream = Vec::with_capacity(13 + body.len());
    stream.extend_from_slice(props);
    stream.extend_from_slice(&actual.to_le_bytes());
    stream.extend_from_slice(body);
    let mut out = Vec::with_capacity(actual as usize);
    lzma_rs::lzma_decompress(&mut std::io::Cursor::new(stream), &mut out).map_err(|e| crate::binary::ParseError(format!("LZMA: {e}")))?;
    Ok(out)
}

struct Bvcd<'a, 'b> {
    r: Reader<'a>,
    strings: &'b [String],
}

impl Bvcd<'_, '_> {
    fn string(&mut self) -> Result<String> {
        let i = self.r.i16()?;
        Ok(if i < 0 { String::new() } else { self.strings.get(i as usize).cloned().unwrap_or_default() })
    }

    fn curve(&mut self) -> Result<Vec<Sample>> {
        let n = self.r.u8()?;
        (0..n).map(|_| Ok(Sample { time: self.r.f32()?, value: self.r.u8()? as f32 / 255.0, curve: 0 })).collect()
    }

    fn samples(&mut self, n: usize) -> Result<Vec<Sample>> {
        (0..n).map(|_| Ok(Sample { time: self.r.f32()?, value: self.r.u8()? as f32 / 255.0, curve: self.r.u16()? })).collect()
    }

    fn event(&mut self) -> Result<Event> {
        let kind = self.r.u8()?;
        let name = self.string()?;
        let start = self.r.f32()?;
        let end = self.r.f32()?;
        let params = self.string()?;
        let params2 = self.string()?;
        let params3 = self.string()?;
        let ramp = self.curve()?;
        let flags = self.r.u8()?;
        let _distance = self.r.f32()?;
        // relative tags and timing tags (name, u0.8), then the two kinds of absolute tags (name, u4.12): not needed for playback
        for _ in 0..self.r.u8()? {
            self.r.skip(3);
        }
        for _ in 0..self.r.u8()? {
            self.r.skip(3);
        }
        for _ in 0..2 {
            for _ in 0..self.r.u8()? {
                self.r.skip(4);
            }
        }
        if kind == GESTURE {
            let _duration = self.r.f32()?;
        }
        if self.r.u8()? == 1 {
            self.r.skip(4); // relative tag: its name and its wave's
        }
        let mut tracks = Vec::new();
        for _ in 0..self.r.u8()? {
            let controller = self.string()?;
            let tf = self.r.u8()?;
            let min = self.r.f32()?;
            let max = self.r.f32()?;
            let n = self.r.u16()? as usize;
            let samples = self.samples(n)?;
            let combo = tf & 2 != 0;
            let balance = if combo {
                let n = self.r.u16()? as usize;
                self.samples(n)?
            } else {
                Vec::new()
            };
            tracks.push(FlexTrack { controller, active: tf & 1 != 0, combo, min, max, samples, balance });
        }
        let loop_count = if kind == LOOP { self.r.u8()? as i8 as i32 } else { 0 };
        let mut caption = String::new();
        if kind == SPEAK {
            let _cc_type = self.r.u8()?;
            caption = self.string()?;
            let _cc_flags = self.r.u8()?;
        }
        Ok(Event { kind, name, start, end, params, params2, params3, ramp, active: flags & 8 != 0, tracks, caption, loop_count })
    }
}

/// Reads a binary VCD; `strings` is the pool of the scenes.image it came from.
pub fn parse_bvcd(bytes: &[u8], strings: &[String]) -> Result<Scene> {
    let mut b = Bvcd { r: Reader::new(bytes), strings };
    if b.r.u32()? != BVCD_ID {
        return fail("not a binary VCD");
    }
    let version = b.r.u8()?;
    if version != BVCD_VERSION {
        return fail(format!("binary VCD version {version} is not supported"));
    }
    b.r.skip(4); // the CRC of the text version
    let events = (0..b.r.u8()?).map(|_| b.event()).collect::<Result<Vec<_>>>()?;
    let mut actors = Vec::new();
    for _ in 0..b.r.u8()? {
        let name = b.string()?;
        let mut channels = Vec::new();
        for _ in 0..b.r.u8()? {
            let cname = b.string()?;
            let events = (0..b.r.u8()?).map(|_| b.event()).collect::<Result<Vec<_>>>()?;
            channels.push(Channel { name: cname, events, active: b.r.u8()? == 1 });
        }
        actors.push(Actor { name, channels, active: b.r.u8()? == 1 });
    }
    let ramp = b.curve()?;
    let ignore_phonemes = b.r.u8().map(|v| v != 0).unwrap_or(false);
    Ok(Scene { events, actors, ramp, ignore_phonemes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_crc_is_of_the_backslashed_lower_case_path() {
        assert_eq!(scene_crc("scenes/Player/Heavy/low/taunt01.vcd"), crc32fast::hash(b"scenes\\player\\heavy\\low\\taunt01.vcd"));
        assert_eq!(scene_crc("player/heavy/low/taunt01"), scene_crc("scenes\\player\\heavy\\low\\taunt01.vcd"));
    }

    /// A hand-built scene: one actor, one channel, a flex animation with a stereo track and a speak event.
    #[test]
    fn a_binary_scene_reads_back() {
        let strings: Vec<String> = ["heavy", "face", "anim", "smile", "speak", "Heavy.Taunts05", ""].iter().map(|s| s.to_string()).collect();
        let mut b: Vec<u8> = Vec::new();
        let s16 = |b: &mut Vec<u8>, i: i16| b.extend_from_slice(&i.to_le_bytes());
        let f = |b: &mut Vec<u8>, v: f32| b.extend_from_slice(&v.to_le_bytes());
        b.extend_from_slice(b"bvcd");
        b.push(4);
        b.extend_from_slice(&[0; 4]);
        b.push(0); // no scene events
        b.push(1); // one actor
        s16(&mut b, 0);
        b.push(1); // one channel
        s16(&mut b, 1);
        b.push(2); // two events
        let head = |b: &mut Vec<u8>, kind: u8, name: i16, start: f32, end: f32, p1: i16| {
            b.push(kind);
            s16(b, name);
            f(b, start);
            f(b, end);
            s16(b, p1);
            s16(b, 6);
            s16(b, 6);
            b.push(0); // ramp
            b.push(8); // active
            f(b, 0.0);
            b.extend_from_slice(&[0, 0, 0, 0]); // no tags
            b.push(0); // no relative tag
        };
        head(&mut b, FLEXANIMATION, 2, 0.5, 2.0, 6);
        b.push(1); // one track
        s16(&mut b, 3);
        b.push(3); // active, combo
        f(&mut b, 0.0);
        f(&mut b, 1.0);
        b.extend_from_slice(&2u16.to_le_bytes());
        for (t, v) in [(0.1f32, 0u8), (1.0, 255)] {
            f(&mut b, t);
            b.push(v);
            b.extend_from_slice(&0u16.to_le_bytes());
        }
        b.extend_from_slice(&1u16.to_le_bytes());
        f(&mut b, 0.5);
        b.push(128);
        b.extend_from_slice(&0u16.to_le_bytes());
        head(&mut b, SPEAK, 4, 0.0, 3.0, 5);
        b.push(0); // no tracks
        b.push(1); // cc type
        s16(&mut b, 6);
        b.push(0);
        b.push(1); // channel active
        b.push(1); // actor active
        b.push(0); // scene ramp
        b.push(0);
        let scene = parse_bvcd(&b, &strings).unwrap();
        let events: Vec<_> = scene.all_events().collect();
        assert_eq!(events.len(), 2);
        let anim = events[0];
        assert_eq!((anim.kind, anim.start, anim.end), (FLEXANIMATION, 0.5, 2.0));
        let track = &anim.tracks[0];
        assert_eq!(track.controller, "smile");
        assert!(track.combo && track.active);
        assert_eq!(track.samples[1], Sample { time: 1.0, value: 1.0, curve: 0 });
        assert_eq!(track.balance.len(), 1);
        assert_eq!(events[1].params, "Heavy.Taunts05");
        assert_eq!(events[1].kind, SPEAK);
    }
}
