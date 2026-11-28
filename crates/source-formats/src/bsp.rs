//! A compiled map (`.bsp`, version 19 to 21) as something to look at: its brush faces and displacements as triangles grouped by material,
//! with texture and lightmap coordinates; its lightmaps packed into one atlas; its static props and the models of its prop entities; the
//! sky it names and where its spawn points are. Faces nobody sees in the game (tool textures, nodraw, sky, triggers) are left out.

use std::collections::HashMap;

fn bytes<const N: usize>(b: &[u8], i: usize) -> Option<[u8; N]> {
    b.get(i..i.checked_add(N)?)?.try_into().ok()
}
fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    bytes(b, i).map(u16::from_le_bytes)
}
fn i16_at(b: &[u8], i: usize) -> Option<i16> {
    bytes(b, i).map(i16::from_le_bytes)
}
fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    bytes(b, i).map(u32::from_le_bytes)
}
fn i32_at(b: &[u8], i: usize) -> Option<i32> {
    bytes(b, i).map(i32::from_le_bytes)
}
fn f32_at(b: &[u8], i: usize) -> Option<f32> {
    bytes(b, i).map(f32::from_le_bytes)
}

/// Why a map could not be read.
#[derive(Debug)]
pub struct BspError(pub String);

impl std::fmt::Display for BspError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BspError {}

type Result<T> = std::result::Result<T, BspError>;

fn bad(what: &str) -> BspError {
    BspError(format!("not a map this can read: {what}"))
}

const LUMP_ENTITIES: usize = 0;
const LUMP_PLANES: usize = 1;
const LUMP_NODES: usize = 5;
const LUMP_LEAFS: usize = 10;
const LUMP_LEAF_BRUSHES: usize = 17;
const LUMP_BRUSHES: usize = 18;
const LUMP_BRUSH_SIDES: usize = 19;
const LUMP_WORLDLIGHTS: usize = 15;
const LUMP_WORLDLIGHTS_HDR: usize = 54;
const LUMP_LEAF_AMBIENT_INDEX_HDR: usize = 51;
const LUMP_LEAF_AMBIENT_INDEX: usize = 52;
const LUMP_LEAF_AMBIENT_LIGHTING_HDR: usize = 55;
const LUMP_LEAF_AMBIENT_LIGHTING: usize = 56;
const LUMP_TEXDATA: usize = 2;
const LUMP_VERTEXES: usize = 3;
const LUMP_TEXINFO: usize = 6;
const LUMP_FACES: usize = 7;
const LUMP_LIGHTING: usize = 8;
const LUMP_EDGES: usize = 12;
const LUMP_SURFEDGES: usize = 13;
const LUMP_MODELS: usize = 14;
const LUMP_DISPINFO: usize = 26;
const LUMP_DISP_VERTS: usize = 33;
const LUMP_GAME_LUMP: usize = 35;
const LUMP_TEXDATA_STRING_DATA: usize = 43;
const LUMP_TEXDATA_STRING_TABLE: usize = 44;
const LUMP_OVERLAYS: usize = 45;
const LUMP_CUBEMAPS: usize = 42;
const LUMP_LIGHTING_HDR: usize = 53;
const LUMP_FACES_HDR: usize = 58;

// texinfo flags of surfaces the game does not draw
const SURF_SKY2D: i32 = 0x2;
const SURF_SKY: i32 = 0x4;
const SURF_WARP: i32 = 0x8;
const SURF_TRIGGER: i32 = 0x40;
const SURF_NODRAW: i32 = 0x80;
const SURF_HINT: i32 = 0x100;
const SURF_SKIP: i32 = 0x200;
const SURF_NOLIGHT: i32 = 0x400;
/// A face lit with three more lightmaps, one per direction of the bump basis (for its normal map).
const SURF_BUMPLIGHT: i32 = 0x800;
const CONTENTS_SOLID: i32 = 0x1;
const CONTENTS_WINDOW: i32 = 0x2;
const CONTENTS_GRATE: i32 = 0x8;

/// The triangles of one material.
#[derive(Default)]
pub struct MapMesh {
    /// The material, as the map names it (`concrete/concretefloor001a`, no `materials/` or `.vmt`).
    pub material: String,
    /// xyz per vertex, in the map's units and axes (Z up).
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// The texture coordinates, in texels divided by the texture's size (the size the map gives it).
    pub uvs: Vec<f32>,
    /// Where in the lightmap atlas the vertex is (0..1); (-1, -1) for a face without a lightmap (fullbright).
    pub lightmap_uvs: Vec<f32>,
    /// How much of a blend material's second texture shows (a displacement's painted alpha, 0..1); 0 elsewhere.
    pub blend: Vec<f32>,
    /// The tangent frame the face's normal map and bump lightmaps are in (the game's: from its texture axes), xyz per vertex.
    pub tangents_s: Vec<f32>,
    pub tangents_t: Vec<f32>,
    pub indices: Vec<u32>,
    /// Part of the 3D skybox (see [`SkyCamera`]): in the skybox's own small units, where the map keeps it.
    pub sky: bool,
    /// Part of a door (an index into [`Map::doors`]): it moves as the door opens.
    pub door: Option<usize>,
}

/// A sliding door (`func_door`): which way it opens and how far (map units), how fast (units a second), and whether it starts open
/// (its spawn position, or a gate the round's logic opens rather than a trigger: open, as the round has begun).
pub struct MapDoor {
    pub name: String,
    pub dir: [f32; 3],
    pub distance: f32,
    pub speed: f32,
    pub start_open: bool,
    /// The animations it starts on props as it opens or closes (`OnOpen`/`OnClose` outputs to `SetAnimation`): (`open` or `close`, the
    /// prop's name, a pattern maybe ending in `*`, the sequence).
    pub anims: Vec<(String, String, String)>,
}

/// Whether an entity's name is what an output targets (a name, or the start of names ending in `*`; lower case).
pub fn name_matches(name: &str, target: &str) -> bool {
    match target.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => name == target,
    }
}

/// A trigger (`trigger_multiple`) that opens doors while someone is in it: its box (map units) and the doors it opens on being entered
/// and closes on being left (by name).
pub struct MapTrigger {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub open: Vec<String>,
    pub close: Vec<String>,
}

/// The 3D skybox: a small copy of the scenery around the map, built somewhere out of the way in the map. The game draws it first, seen
/// from `origin + eye / scale` (so a point `p` of it shows where `(p - origin) * scale` is in the map), then the map over it.
#[derive(Clone, Copy)]
pub struct SkyCamera {
    pub origin: [f32; 3],
    pub scale: f32,
    /// Its fog (`fogenable`): colour (0..1, gamma), where it starts and ends (in the map's units, seen from the eye) and how thick it gets.
    pub fog: Option<([f32; 3], f32, f32, f32)>,
}

/// The fog an entity sets (`env_fog_controller`, `sky_camera`), when it turns it on: colour (0..1, gamma), start, end, most thickness.
fn entity_fog(e: &HashMap<String, String>) -> Option<([f32; 3], f32, f32, f32)> {
    if !e.get("fogenable").is_some_and(|v| v.trim() == "1") {
        return None;
    }
    let num = |k: &str| e.get(k).and_then(|v| v.trim().parse::<f32>().ok());
    let c: Vec<f32> = e.get("fogcolor").map(|c| c.split_whitespace().filter_map(|v| v.parse().ok()).collect()).unwrap_or_default();
    let color = if c.len() >= 3 { [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0] } else { [1.0; 3] };
    Some((color, num("fogstart").unwrap_or(500.0), num("fogend").unwrap_or(2000.0), num("fogmaxdensity").filter(|d| *d > 0.0).unwrap_or(1.0).min(1.0)))
}

/// A model the map places: a static prop or a prop entity.
pub struct MapProp {
    /// A static prop's number in the map (what its baked lighting, `sp_hdr_<n>.vhv`, is named by); none for a prop entity.
    pub static_index: Option<u32>,
    /// `models/....mdl`, in lower case with forward slashes.
    pub model: String,
    pub origin: [f32; 3],
    /// Pitch, yaw, roll in degrees, as the game gives them.
    pub angles: [f32; 3],
    pub skin: i32,
    pub scale: f32,
    /// The light around it, as the game lights a prop: the ambient cube of the map where it stands with the map's lights that reach it
    /// folded in (+X -X +Y -Y +Z -Z, linear), and whether the sun reaches it.
    pub ambient: [[f32; 3]; 6],
    pub sunlit: bool,
    /// The strongest light that reaches it (not in `ambient`): the direction toward it and its colour.
    pub key: Option<([f32; 3], [f32; 3])>,
    /// The door it is attached to (`parentname`, an index into [`Map::doors`]): it moves with it.
    pub door: Option<usize>,
    /// Where the game lights it from, when the map says (a static prop's lighting origin).
    pub lighting_origin: Option<[f32; 3]>,
    /// The sequence a prop entity plays (its DefaultAnim; none: its first). Static props do not move.
    pub animation: Option<String>,
    /// It stands in the 3D skybox (see [`SkyCamera`]).
    pub sky: bool,
    /// A prop entity's name (`targetname`, lower case), when it has one.
    pub name: Option<String>,
}

/// How the map's characters cast their shadows (its `shadow_control`): the way the shadows fall (a direction, the map's axes), their
/// colour (0..1) and how far they reach from what casts them.
#[derive(Debug, Clone, Copy)]
pub struct MapShadow {
    pub dir: [f32; 3],
    pub color: [f32; 3],
    pub distance: f32,
}

/// The sun of the map (`light_environment`): the direction toward it and its colour (linear).
#[derive(Clone, Copy)]
pub struct MapSun {
    pub dir: [f32; 3],
    pub color: [f32; 3],
}

/// A spawn point (`info_player_teamspawn`).
pub struct MapSpawn {
    pub origin: [f32; 3],
    pub yaw: f32,
    /// 2 RED, 3 BLU, 0 either.
    pub team: i32,
}

pub struct Map {
    pub meshes: Vec<MapMesh>,
    pub props: Vec<MapProp>,
    pub spawns: Vec<MapSpawn>,
    /// The lightmap atlas: [`LIGHTMAP_PAGES`] pages of `width` x `height` RGBA one above the other (the plain light, then the light from
    /// the three directions of the bump basis), each colour the square root of the light over [`LIGHTMAP_RANGE`] (so 8 bits keep the
    /// darks); alpha is 255.
    pub lightmap_width: u32,
    pub lightmap_height: u32,
    pub lightmap: Vec<u8>,
    /// The 2D sky (`skyname` of worldspawn), when it names one.
    pub sky: Option<String>,
    /// The world's bounds (min xyz, max xyz).
    pub bounds: [f32; 6],
    /// The sun, when the map has one.
    pub sun: Option<MapSun>,
    /// The limits the map gives the game's auto exposure (`env_tonemap_controller`'s SetAutoExposureMin / Max, when it sets them).
    pub exposure_min: Option<f32>,
    pub exposure_max: Option<f32>,
    /// How its characters cast their shadows (its shadow_control; the game's default without one); none when it turns them off.
    pub shadow: Option<MapShadow>,
    /// Where the map's cubemaps were taken (`env_cubemap`s): their pictures are `materials/maps/<map>/c<x>_<y>_<z>.vtf` in its files.
    pub cubemaps: Vec<[i32; 3]>,
    /// The map's light where something stands (for the characters).
    pub light: MapLight,
    /// Its 3D skybox, when it has one (the meshes and props with `sky` set).
    pub sky_camera: Option<SkyCamera>,
    /// Its fog (`env_fog_controller`, the first one on): colour (0..1, gamma), start, end (map units) and how thick it gets at most.
    pub fog: Option<([f32; 3], f32, f32, f32)>,
    /// Its sliding doors and the triggers that open them.
    pub doors: Vec<MapDoor>,
    pub triggers: Vec<MapTrigger>,
}

/// What the light of a map is made of, to ask it where things stand: its BSP tree (which leaf a point is in), its brushes (whether a
/// ray to the sun is blocked or reaches the sky) and the ambient light samples of its leaves.
pub struct MapLight {
    planes: Vec<([f32; 3], f32)>,
    nodes: Vec<(usize, [i32; 2])>,
    head: i32,
    /// contents, area, mins, maxs, first leaf brush, leaf brush count, first ambient sample, sample count
    leaves: Vec<Leaf>,
    leaf_brushes: Vec<u16>,
    /// contents, first side, side count, has a sky side
    brushes: Vec<(i32, usize, usize, bool)>,
    /// plane, bevel
    sides: Vec<(usize, bool)>,
    /// position (0..1 in its leaf), cube
    samples: Vec<([f32; 3], [[f32; 3]; 6])>,
    lights: Vec<WorldLight>,
    pub sun: Option<MapSun>,
}

/// A light of the map, as the game lights models with it (`dworldlight_t`).
#[derive(Clone, Copy)]
struct WorldLight {
    kind: i32,
    origin: [f32; 3],
    intensity: [f32; 3],
    normal: [f32; 3],
    stopdot: f32,
    stopdot2: f32,
    exponent: f32,
    radius: f32,
    attn: [f32; 3],
}

const EMIT_SURFACE: i32 = 0;
const EMIT_POINT: i32 = 1;
const EMIT_SPOTLIGHT: i32 = 2;
const EMIT_SKYLIGHT: i32 = 3;

/// The light at a point, as the game lights a model there: an ambient cube (the map's, with the lesser lights added to it) and the
/// strongest light that reaches it, as a direction toward it and a colour.
pub struct LightAt {
    pub cube: [[f32; 3]; 6],
    pub key: Option<([f32; 3], [f32; 3])>,
}

/// The six directions of an ambient cube.
const CUBE_AXES: [[f32; 3]; 6] = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]];

#[derive(Clone, Copy)]
struct Leaf {
    contents: i32,
    area: u16,
    mins: [f32; 3],
    maxs: [f32; 3],
    first_brush: usize,
    brush_count: usize,
    first_sample: usize,
    sample_count: usize,
}

impl MapLight {
    fn leaf_at(&self, p: [f32; 3]) -> Option<usize> {
        let mut node = self.head;
        for _ in 0..4096 {
            if node < 0 {
                let leaf = (-1 - node) as usize;
                return (leaf < self.leaves.len()).then_some(leaf);
            }
            let (plane, children) = *self.nodes.get(node as usize)?;
            let (n, d) = *self.planes.get(plane)?;
            node = if dot(n, p) - d >= 0.0 { children[0] } else { children[1] };
        }
        None
    }

    /// The area (the part of the map portals split off) a point is in.
    fn area_at(&self, p: [f32; 3]) -> Option<u16> {
        self.leaf_at(p).map(|l| self.leaves[l].area)
    }

    /// The brush a point is in, when it is in a solid one: whether it has a sky side.
    pub fn solid_at(&self, p: [f32; 3]) -> Option<bool> {
        let leaf = self.leaves.get(self.leaf_at(p)?)?;
        for &b in self.leaf_brushes.get(leaf.first_brush..leaf.first_brush + leaf.brush_count).unwrap_or(&[]) {
            let Some(&(contents, first, count, sky)) = self.brushes.get(b as usize) else { continue };
            if contents & (CONTENTS_SOLID | CONTENTS_WINDOW | CONTENTS_GRATE) == 0 {
                continue;
            }
            let inside = self.sides.get(first..first + count).unwrap_or(&[]).iter().filter(|(_, bevel)| !bevel).all(|&(plane, _)| {
                self.planes.get(plane).is_some_and(|&(n, d)| dot(n, p) - d <= 0.01)
            });
            if inside {
                return Some(sky || contents & CONTENTS_SOLID == 0);
            }
        }
        (leaf.contents & CONTENTS_SOLID != 0).then_some(false)
    }

    /// Whether the sun reaches a point: a ray toward it, followed through the map until it is in the sky (a sky brush) or outside the
    /// world, or blocked by a solid brush.
    pub fn sunlit(&self, p: [f32; 3]) -> bool {
        let Some(sun) = self.sun else { return false };
        self.sunlit_toward(p, sun.dir)
    }

    fn sunlit_toward(&self, p: [f32; 3], dir: [f32; 3]) -> bool {
        let sun = MapSun { dir, color: [0.0; 3] };
        // (from a little above the point, so the floor it stands on does not block it)
        let start = [p[0], p[1], p[2] + 8.0];
        let mut t = 0.0;
        while t < 32768.0 {
            let q = [start[0] + sun.dir[0] * t, start[1] + sun.dir[1] * t, start[2] + sun.dir[2] * t];
            if self.leaf_at(q).is_none() {
                return true;
            }
            if let Some(sky) = self.solid_at(q) {
                return sky;
            }
            t += 6.0;
        }
        true
    }

    /// Whether nothing solid is between two points.
    fn clear_between(&self, a: [f32; 3], b: [f32; 3]) -> bool {
        let d = sub(b, a);
        let len = dot(d, d).sqrt();
        let step = 6.0;
        let mut t = step;
        while t < len - step {
            let q = [a[0] + d[0] * t / len, a[1] + d[1] * t / len, a[2] + d[2] * t / len];
            if self.solid_at(q).is_some() {
                return false;
            }
            t += step;
        }
        true
    }

    /// The light the game would give a model at a point (see [`LightAt`]): the leaf's ambient cube, and the map's lights that reach it.
    pub fn light_at(&self, p: [f32; 3]) -> LightAt {
        let mut cube = self.ambient_at(p);
        let mut direct: Vec<([f32; 3], [f32; 3])> = Vec::new();
        for l in &self.lights {
            let (dir, ratio) = match l.kind {
                EMIT_SKYLIGHT => {
                    let dir = l.normal.map(|v| -v);
                    let lit = self.sun.map_or(false, |_| true) && self.sunlit_toward(p, dir);
                    (dir, if lit { 1.0 } else { 0.0 })
                }
                EMIT_POINT | EMIT_SPOTLIGHT | EMIT_SURFACE => {
                    let delta = sub(l.origin, p);
                    let dist2 = dot(delta, delta).max(1.0);
                    let dist = dist2.sqrt();
                    if l.radius > 0.0 && dist > l.radius {
                        continue;
                    }
                    let dir = delta.map(|v| v / dist);
                    let mut ratio = match l.kind {
                        EMIT_SURFACE => {
                            let d = -dot(dir, l.normal);
                            if d <= 0.0 { 0.0 } else { d / dist2 }
                        }
                        _ => 1.0 / (l.attn[0] + l.attn[1] * dist + l.attn[2] * dist2).max(1e-6),
                    };
                    if l.kind == EMIT_SPOTLIGHT {
                        let d = -dot(dir, l.normal);
                        if d <= l.stopdot2 {
                            ratio = 0.0;
                        } else {
                            if l.exponent > 0.0 {
                                ratio *= d.powf(l.exponent);
                            }
                            if d <= l.stopdot && l.stopdot > l.stopdot2 {
                                ratio *= (d - l.stopdot2) / (l.stopdot - l.stopdot2);
                            }
                        }
                    }
                    (dir, ratio)
                }
                _ => continue,
            };
            let color = l.intensity.map(|c| c * ratio);
            if color[0] + color[1] + color[2] < 0.003 {
                continue;
            }
            if l.kind != EMIT_SKYLIGHT && !self.clear_between(p, l.origin) {
                continue;
            }
            direct.push((dir, color));
        }
        // the strongest is the key light; the others go into the cube, as the game folds the lights beyond its few into it
        direct.sort_by(|a, b| (b.1[0] + b.1[1] + b.1[2]).total_cmp(&(a.1[0] + a.1[1] + a.1[2])));
        let key = direct.first().copied();
        for &(dir, color) in direct.iter().skip(1) {
            for (face, axis) in cube.iter_mut().zip(CUBE_AXES) {
                let d = dot(dir, axis);
                if d > 0.0 {
                    for c in 0..3 {
                        face[c] += color[c] * d;
                    }
                }
            }
        }
        LightAt { cube, key }
    }

    /// The light at a point with the key light folded into the cube too (for a prop, which is lit by its cube alone).
    pub fn cube_at(&self, p: [f32; 3]) -> [[f32; 3]; 6] {
        let LightAt { mut cube, key } = self.light_at(p);
        if let Some((dir, color)) = key {
            for (face, axis) in cube.iter_mut().zip(CUBE_AXES) {
                let d = dot(dir, axis);
                if d > 0.0 {
                    for c in 0..3 {
                        face[c] += color[c] * d;
                    }
                }
            }
        }
        cube
    }

    /// The ambient cube of the map at a point (+X -X +Y -Y +Z -Z, linear): the nearest light sample of its leaf, else of the map.
    pub fn ambient_at(&self, p: [f32; 3]) -> [[f32; 3]; 6] {
        let near = |range: &mut dyn Iterator<Item = ([f32; 3], [[f32; 3]; 6])>| {
            range.min_by(|a, b| {
                let da = sub(a.0, p);
                let db = sub(b.0, p);
                dot(da, da).total_cmp(&dot(db, db))
            })
        };
        if let Some(leaf) = self.leaf_at(p).map(|l| self.leaves[l]) {
            let size = sub(leaf.maxs, leaf.mins);
            let mut own = self.samples.get(leaf.first_sample..leaf.first_sample + leaf.sample_count).unwrap_or(&[]).iter().map(|(f, c)| {
                ([leaf.mins[0] + f[0] * size[0], leaf.mins[1] + f[1] * size[1], leaf.mins[2] + f[2] * size[2]], *c)
            });
            if let Some((_, cube)) = near(&mut own) {
                return cube;
            }
        }
        // a point in no lit leaf (in a wall, under the floor): the nearest sample of any leaf
        let mut all = self.leaves.iter().flat_map(|leaf| {
            let size = sub(leaf.maxs, leaf.mins);
            let mins = leaf.mins;
            self.samples.get(leaf.first_sample..leaf.first_sample + leaf.sample_count).unwrap_or(&[]).iter().map(move |(f, c)| {
                ([mins[0] + f[0] * size[0], mins[1] + f[1] * size[1], mins[2] + f[2] * size[2]], *c)
            })
        });
        near(&mut all).map(|(_, c)| c).unwrap_or([[0.3; 3]; 6])
    }
}

fn rgbe(s: &[u8]) -> [f32; 3] {
    let scale = 2f32.powi(s[3] as i8 as i32) / 255.0;
    [s[0] as f32 * scale, s[1] as f32 * scale, s[2] as f32 * scale]
}

/// The light of a map: its tree, brushes, ambient samples and sun.
fn map_light(bsp: &Bsp, sun: Option<MapSun>, texinfo_flags: &[i32]) -> MapLight {
    let planes: Vec<([f32; 3], f32)> = bsp.lump(LUMP_PLANES).data.chunks_exact(20).map(|p| (vec3(p, 0), f32_at(p, 12).unwrap_or(0.0))).collect();
    let nodes = bsp.lump(LUMP_NODES).data.chunks_exact(32).map(|n| (i32_at(n, 0).unwrap_or(0).max(0) as usize, [i32_at(n, 4).unwrap_or(-1), i32_at(n, 8).unwrap_or(-1)])).collect();
    let head = bsp.lump(LUMP_MODELS).data.get(..48).and_then(|m| i32_at(m, 36)).unwrap_or(0);
    let version = u32_at(bsp.file, 4).unwrap_or(20);
    let leaf_size = if version <= 19 { 56 } else { 32 };
    let hdr = !bsp.lump(LUMP_LEAF_AMBIENT_LIGHTING_HDR).data.is_empty();
    let index = bsp.lump(if hdr { LUMP_LEAF_AMBIENT_INDEX_HDR } else { LUMP_LEAF_AMBIENT_INDEX });
    let lighting = bsp.lump(if hdr { LUMP_LEAF_AMBIENT_LIGHTING_HDR } else { LUMP_LEAF_AMBIENT_LIGHTING });
    let leaves = bsp
        .lump(LUMP_LEAFS)
        .data
        .chunks_exact(leaf_size)
        .enumerate()
        .map(|(i, l)| {
            let s16 = |at: usize| i16_at(l, at).unwrap_or(0) as f32;
            Leaf {
                contents: i32_at(l, 0).unwrap_or(0),
                area: u16_at(l, 6).unwrap_or(0) & 0x1ff,
                mins: [s16(8), s16(10), s16(12)],
                maxs: [s16(14), s16(16), s16(18)],
                first_brush: u16_at(l, 24).unwrap_or(0) as usize,
                brush_count: u16_at(l, 26).unwrap_or(0) as usize,
                sample_count: u16_at(&index.data, i * 4).unwrap_or(0) as usize,
                first_sample: u16_at(&index.data, i * 4 + 2).unwrap_or(0) as usize,
            }
        })
        .collect();
    let samples = lighting
        .data
        .chunks_exact(28)
        .map(|s| {
            let cube = std::array::from_fn(|k| rgbe(&s[k * 4..k * 4 + 4]));
            ([s[24] as f32 / 255.0, s[25] as f32 / 255.0, s[26] as f32 / 255.0], cube)
        })
        .collect();
    let sides: Vec<(usize, bool)> = bsp.lump(LUMP_BRUSH_SIDES).data.chunks_exact(8).map(|s| (u16_at(s, 0).unwrap_or(0) as usize, s[6] != 0)).collect();
    let side_sky: Vec<bool> = bsp
        .lump(LUMP_BRUSH_SIDES)
        .data
        .chunks_exact(8)
        .map(|s| {
            let ti = i16_at(s, 2).unwrap_or(-1);
            ti >= 0 && texinfo_flags.get(ti as usize).is_some_and(|f| f & (SURF_SKY | SURF_SKY2D) != 0)
        })
        .collect();
    let brushes = bsp
        .lump(LUMP_BRUSHES)
        .data
        .chunks_exact(12)
        .map(|b| {
            let first = i32_at(b, 0).unwrap_or(0).max(0) as usize;
            let count = i32_at(b, 4).unwrap_or(0).max(0) as usize;
            let sky = side_sky.get(first..first + count).is_some_and(|s| s.iter().any(|&x| x));
            (i32_at(b, 8).unwrap_or(0), first, count, sky)
        })
        .collect();
    let leaf_brushes = bsp.lump(LUMP_LEAF_BRUSHES).data.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
    let lights_lump = bsp.lump(if bsp.lump(LUMP_WORLDLIGHTS_HDR).data.is_empty() { LUMP_WORLDLIGHTS } else { LUMP_WORLDLIGHTS_HDR });
    // (version 1 of the lump has 12 more bytes)
    let stride = if lights_lump.data.len() % 88 == 0 { 88 } else { 100 };
    let lights: Vec<WorldLight> = lights_lump
        .data
        .chunks_exact(stride)
        .map(|l| {
            let f = |at: usize| f32_at(l, at).unwrap_or(0.0);
            WorldLight {
                origin: vec3(l, 0),
                intensity: vec3(l, 12),
                normal: vec3(l, 24),
                kind: i32_at(l, 40).unwrap_or(-1),
                stopdot: f(48),
                stopdot2: f(52),
                exponent: f(56),
                radius: f(60),
                attn: [f(64), f(68), f(72)],
            }
        })
        .collect();
    // the sun: the map's sky light (its colour as the compile made it), else light_environment's
    let sun = lights.iter().find(|l| l.kind == EMIT_SKYLIGHT).map(|l| MapSun { dir: normalize(l.normal.map(|v| -v)), color: l.intensity }).or(sun);
    MapLight { planes, nodes, head, leaves, leaf_brushes, brushes, sides, samples, lights, sun }
}

/// The brightest light the lightmap atlas keeps (linear; 1 is a surface lit to its own colour).
pub const LIGHTMAP_RANGE: f32 = 4.0;
/// The pages of the lightmap atlas (see [`Map::lightmap`]).
pub const LIGHTMAP_PAGES: u32 = 4;

struct Lump<'a> {
    data: std::borrow::Cow<'a, [u8]>,
}

/// The lumps of a map, uncompressed.
struct Bsp<'a> {
    file: &'a [u8],
    lumps: Vec<(usize, usize, u32)>,
}

impl<'a> Bsp<'a> {
    fn new(file: &'a [u8]) -> Result<Self> {
        if file.len() < 8 + 64 * 16 || &file[..4] != b"VBSP" {
            return Err(bad("no VBSP header"));
        }
        let version = u32_at(file, 4).unwrap_or(0);
        if !(19..=21).contains(&version) {
            return Err(bad(&format!("version {version}")));
        }
        let lumps = (0..64)
            .map(|i| {
                let at = 8 + i * 16;
                (u32_at(file, at).unwrap_or(0) as usize, u32_at(file, at + 4).unwrap_or(0) as usize, u32_at(file, at + 12).unwrap_or(0))
            })
            .collect();
        Ok(Bsp { file, lumps })
    }

    fn lump(&self, index: usize) -> Lump<'a> {
        let (ofs, len, uncompressed) = self.lumps[index];
        let Some(raw) = self.file.get(ofs..ofs.saturating_add(len)) else { return Lump { data: std::borrow::Cow::Borrowed(&[]) } };
        if uncompressed > 0 && raw.starts_with(b"LZMA") {
            return Lump { data: std::borrow::Cow::Owned(lzma(raw).unwrap_or_default()) };
        }
        Lump { data: std::borrow::Cow::Borrowed(raw) }
    }
}

/// A lump (or game lump) Valve's tools compressed: `LZMA`, the size it unpacks to, the size packed, the properties, then the stream.
fn lzma(raw: &[u8]) -> Option<Vec<u8>> {
    let size = u32_at(raw, 4)? as u64;
    let packed = u32_at(raw, 8)? as usize;
    let props = raw.get(12..17)?;
    let mut stream = Vec::with_capacity(13 + packed);
    stream.extend_from_slice(props);
    stream.extend_from_slice(&size.to_le_bytes());
    stream.extend_from_slice(raw.get(17..17 + packed.min(raw.len() - 17))?);
    let mut out = Vec::with_capacity(size as usize);
    lzma_rs::lzma_decompress(&mut std::io::Cursor::new(stream), &mut out).ok()?;
    Some(out)
}

fn vec3(d: &[u8], at: usize) -> [f32; 3] {
    [f32_at(d, at).unwrap_or(0.0), f32_at(d, at + 4).unwrap_or(0.0), f32_at(d, at + 8).unwrap_or(0.0)]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let l = dot(v, v).sqrt();
    if l > 1e-8 { [v[0] / l, v[1] / l, v[2] / l] } else { [0.0, 0.0, 1.0] }
}

struct TexInfo {
    texture: [[f32; 4]; 2],
    lightmap: [[f32; 4]; 2],
    flags: i32,
    texdata: i32,
}

struct Face {
    plane: usize,
    side: bool,
    first_edge: i32,
    num_edges: i32,
    texinfo: i32,
    dispinfo: i32,
    lightofs: i32,
    lm_mins: [i32; 2],
    lm_size: [i32; 2],
}

/// Packs rectangles into rows of a square atlas.
struct Atlas {
    width: u32,
    x: u32,
    y: u32,
    row: u32,
}

impl Atlas {
    fn place(&mut self, w: u32, h: u32) -> (u32, u32) {
        if self.x + w > self.width {
            self.x = 0;
            self.y += self.row;
            self.row = 0;
        }
        let at = (self.x, self.y);
        self.x += w + 1;
        self.row = self.row.max(h + 1);
        at
    }
}

/// Reads a map from its bytes.
pub fn read(file: &[u8]) -> Result<Map> {
    read_with(file, &|_| None)
}

/// [`read`], with where each model is lit from (`illum`: a model's illumination position, its own units, by its path): a prop entity is
/// lit there, as the game lights it, rather than a little up from its origin (a gate whose origin is at the floor of a dark doorway).
pub fn read_with(file: &[u8], illum: &dyn Fn(&str) -> Option<[f32; 3]>) -> Result<Map> {
    let bsp = Bsp::new(file)?;
    let planes = bsp.lump(LUMP_PLANES);
    let verts = bsp.lump(LUMP_VERTEXES);
    let edges = bsp.lump(LUMP_EDGES);
    let surfedges = bsp.lump(LUMP_SURFEDGES);
    let texinfo_lump = bsp.lump(LUMP_TEXINFO);
    let texdata = bsp.lump(LUMP_TEXDATA);
    let strings = bsp.lump(LUMP_TEXDATA_STRING_DATA);
    let string_table = bsp.lump(LUMP_TEXDATA_STRING_TABLE);
    let dispinfo = bsp.lump(LUMP_DISPINFO);
    let dispverts = bsp.lump(LUMP_DISP_VERTS);
    let models = bsp.lump(LUMP_MODELS);
    let entities_lump = bsp.lump(LUMP_ENTITIES);
    // the HDR faces and light, when the map was compiled with them (every TF2 map is), else the LDR ones
    let (faces_lump, lighting) = {
        let hdr_light = bsp.lump(LUMP_LIGHTING_HDR);
        let hdr_faces = bsp.lump(LUMP_FACES_HDR);
        if !hdr_light.data.is_empty() {
            (if hdr_faces.data.is_empty() { bsp.lump(LUMP_FACES) } else { hdr_faces }, hdr_light)
        } else {
            (bsp.lump(LUMP_FACES), bsp.lump(LUMP_LIGHTING))
        }
    };
    let (planes, verts, edges, surfedges, texdata, strings, string_table, dispinfo, dispverts) =
        (&planes.data[..], &verts.data[..], &edges.data[..], &surfedges.data[..], &texdata.data[..], &strings.data[..], &string_table.data[..], &dispinfo.data[..], &dispverts.data[..]);

    let texinfos: Vec<TexInfo> = texinfo_lump
        .data
        .chunks_exact(72)
        .map(|t| {
            let f = |i: usize| f32_at(t, i * 4).unwrap_or(0.0);
            TexInfo {
                texture: [[f(0), f(1), f(2), f(3)], [f(4), f(5), f(6), f(7)]],
                lightmap: [[f(8), f(9), f(10), f(11)], [f(12), f(13), f(14), f(15)]],
                flags: i32_at(t, 64).unwrap_or(0),
                texdata: i32_at(t, 68).unwrap_or(-1),
            }
        })
        .collect();
    let texdata_of = |i: i32| -> Option<(String, f32, f32)> {
        let t = texdata.get(i as usize * 32..i as usize * 32 + 32)?;
        let name_id = i32_at(t, 12)? as usize;
        let (w, h) = (i32_at(t, 16)? as f32, i32_at(t, 20)? as f32);
        let ofs = i32_at(string_table, name_id * 4)? as usize;
        let rest = strings.get(ofs..)?;
        let end = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        Some((String::from_utf8_lossy(&rest[..end]).replace('\\', "/").to_ascii_lowercase(), w.max(1.0), h.max(1.0)))
    };
    let faces: Vec<Face> = faces_lump
        .data
        .chunks_exact(56)
        .map(|f| Face {
            plane: u16_at(f, 0).unwrap_or(0) as usize,
            side: f[2] != 0,
            first_edge: i32_at(f, 4).unwrap_or(0),
            num_edges: i16_at(f, 8).unwrap_or(0) as i32,
            texinfo: i16_at(f, 10).unwrap_or(-1) as i32,
            dispinfo: i16_at(f, 12).unwrap_or(-1) as i32,
            lightofs: i32_at(f, 20).unwrap_or(-1),
            lm_mins: [i32_at(f, 28).unwrap_or(0), i32_at(f, 32).unwrap_or(0)],
            lm_size: [i32_at(f, 36).unwrap_or(0), i32_at(f, 40).unwrap_or(0)],
        })
        .collect();
    let vertex = |i: usize| vec3(verts, i * 12);
    let face_vertices = |f: &Face| -> Vec<[f32; 3]> {
        (0..f.num_edges.max(0))
            .filter_map(|k| {
                let se = i32_at(surfedges, (f.first_edge + k) as usize * 4)?;
                let e = se.unsigned_abs() as usize * 4;
                let v = if se >= 0 { u16_at(edges, e)? } else { u16_at(edges, e + 2)? };
                Some(vertex(v as usize))
            })
            .collect()
    };

    // the entities: brush entities shown (by model number, with where they are) and the props and spawns
    let entities = parse_entities(&String::from_utf8_lossy(&entities_lump.data));
    let mut props = Vec::new();
    let mut spawns = Vec::new();
    let mut sky = None;
    let mut shown_models: Vec<(usize, [f32; 3], [f32; 3])> = vec![(0, [0.0; 3], [0.0; 3])];
    let mut sun = None;
    let mut sky_camera = None;
    let mut fog = None;
    // the doors (model, name, movedir angles, speed, lip, starts open), the triggers (model, origin, opens, closes), and the doors that
    // something other than a trigger opens
    let mut door_ents: Vec<(usize, String, [f32; 3], f32, f32, bool, Vec<(String, String, String)>)> = Vec::new();
    let mut trigger_ents: Vec<(usize, [f32; 3], Vec<String>, Vec<String>)> = Vec::new();
    let mut opened_elsewhere: std::collections::HashSet<String> = std::collections::HashSet::new();
    // the prop entities attached to something (by its name): the ones on a door move with it
    let mut prop_parents: Vec<(usize, String)> = Vec::new();
    let (mut exposure_min, mut exposure_max) = (None, None);
    for e in &entities {
        // the outputs that set the auto exposure's limits (target, input, parameter, delay, times; split by commas or ESC)
        for (k, v) in e {
            if !k.starts_with("on") {
                continue;
            }
            for output in v.lines() {
                let parts: Vec<&str> = output.split([',', '\u{1b}']).collect();
                if parts.len() >= 3 {
                    let value = parts[2].trim().parse::<f32>().ok();
                    match parts[1].trim().to_ascii_lowercase().as_str() {
                        "setautoexposuremin" => exposure_min = value.or(exposure_min),
                        "setautoexposuremax" => exposure_max = value.or(exposure_max),
                        _ => {}
                    }
                }
            }
        }
        let class = e.get("classname").map(String::as_str).unwrap_or("");
        let origin = e.get("origin").map(|s| parse3(s)).unwrap_or([0.0; 3]);
        let angles = e.get("angles").map(|s| parse3(s)).unwrap_or([0.0; 3]);
        match class {
            "worldspawn" => sky = e.get("skyname").filter(|s| !s.is_empty()).cloned(),
            "sky_camera" => {
                let scale = e.get("scale").and_then(|v| v.trim().parse::<f32>().ok()).filter(|s| *s > 0.0).unwrap_or(16.0);
                sky_camera = Some(SkyCamera { origin, scale, fog: entity_fog(e) });
            }
            "env_fog_controller" => fog = fog.or_else(|| entity_fog(e)),
            "light_environment" => {
                // the direction the light comes from: its angles, with "pitch" in place of theirs when given
                let pitch = e.get("pitch").and_then(|p| p.parse::<f32>().ok()).unwrap_or(angles[0]);
                let (p, y) = (pitch.to_radians(), angles[1].to_radians());
                let toward = [p.cos() * y.cos(), p.cos() * y.sin(), -p.sin()];
                let light: Vec<f32> = e.get("_light").map(|l| l.split_whitespace().filter_map(|v| v.parse().ok()).collect()).unwrap_or_default();
                let (rgb, bright) = match light.as_slice() {
                    [r, g, b, i, ..] => ([*r, *g, *b], *i / 255.0),
                    [r, g, b] => ([*r, *g, *b], 1.0),
                    _ => ([255.0, 255.0, 255.0], 1.0),
                };
                let color = rgb.map(|c| (c / 255.0).powf(2.2) * bright);
                sun = Some(MapSun { dir: normalize(toward), color });
            }
            "info_player_teamspawn" => spawns.push(MapSpawn { origin, yaw: angles[1], team: e.get("teamnum").and_then(|t| t.parse().ok()).unwrap_or(0) }),
            _ => {}
        }
        // the outputs' targets with a given input (`target,input,parameter,delay,times`, one per line), of the keys starting with any of
        // the given names
        let targets = |keys: &[&str], input: &str| -> Vec<String> {
            e.iter()
                .filter(|(k, _)| keys.iter().any(|p| k.starts_with(p)))
                .flat_map(|(_, v)| v.lines())
                .filter_map(|o| {
                    let parts: Vec<&str> = o.split([',', '\u{1b}']).collect();
                    (parts.len() >= 2 && parts[1].trim().eq_ignore_ascii_case(input)).then(|| parts[0].trim().to_ascii_lowercase())
                })
                .collect()
        };
        let brush = e.get("model").and_then(|m| m.strip_prefix('*')).and_then(|n| n.parse::<usize>().ok());
        match (class, brush) {
            ("func_door", Some(n)) => {
                let num = |k: &str| e.get(k).and_then(|v| v.trim().parse::<f32>().ok());
                let start_open = num("spawnflags").is_some_and(|f| (f as i64) & 1 != 0) || num("spawnpos").is_some_and(|p| p == 1.0);
                let name = e.get("targetname").map(|n| n.to_ascii_lowercase()).unwrap_or_default();
                let movedir = e.get("movedir").map(|s| parse3(s)).unwrap_or([0.0; 3]);
                // the animations its opening and closing start on props
                let mut anims = Vec::new();
                for (key, event) in [("onopen", "open"), ("onclose", "close")] {
                    for o in e.get(key).into_iter().flat_map(|v| v.lines()) {
                        let parts: Vec<&str> = o.split([',', '\u{1b}']).collect();
                        if parts.len() >= 3 && parts[1].trim().eq_ignore_ascii_case("setanimation") && !parts[2].trim().is_empty() {
                            anims.push((event.to_string(), parts[0].trim().to_ascii_lowercase(), parts[2].trim().to_string()));
                        }
                    }
                }
                door_ents.push((n, name, movedir, num("speed").filter(|v| *v > 0.0).unwrap_or(100.0), num("lip").unwrap_or(0.0), start_open, anims));
            }
            ("trigger_multiple" | "trigger_once", Some(n)) => {
                let open = targets(&["onstarttouch", "ontrigger"], "open");
                let close = targets(&["onendtouch"], "close");
                if !open.is_empty() {
                    trigger_ents.push((n, origin, open, close));
                }
            }
            _ => opened_elsewhere.extend(targets(&["on"], "open")),
        }
        let Some(model) = e.get("model") else { continue };
        if let Some(n) = model.strip_prefix('*') {
            if BRUSH_SHOWN.contains(&class) && e.get("rendermode").map_or(true, |m| m != "10") {
                if let Ok(n) = n.parse::<usize>() { shown_models.push((n, origin, angles)); }
            }
        } else if model.ends_with(".mdl") && PROP_SHOWN.contains(&class) && e.get("rendermode").map_or(true, |m| m != "10") {
            props.push(MapProp {
                static_index: None,
                model: model.replace('\\', "/").to_ascii_lowercase(),
                origin,
                angles,
                skin: e.get("skin").and_then(|s| s.parse().ok()).unwrap_or(0),
                scale: e.get("modelscale").and_then(|s| s.parse().ok()).filter(|s: &f32| *s > 0.0).unwrap_or(1.0),
                ambient: [[0.0; 3]; 6],
                sunlit: false,
                key: None,
                lighting_origin: None,
                animation: e.get("defaultanim").map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
                sky: false,
                name: e.get("targetname").map(|n| n.trim().to_ascii_lowercase()).filter(|n| !n.is_empty()),
                door: None,
            });
            if let Some(parent) = e.get("parentname").filter(|p| !p.is_empty()) {
                prop_parents.push((props.len() - 1, parent.to_ascii_lowercase()));
            }
        }
    }
    props.extend(static_props(&bsp));
    let texinfo_flags: Vec<i32> = texinfos.iter().map(|t| t.flags).collect();
    let light = map_light(&bsp, sun, &texinfo_flags);
    let sun = light.sun;
    // the 3D skybox (the small copy of the scenery around the map that the game draws far away): what is in its area is marked
    let sky_area = sky_camera.and_then(|c| light.area_at(c.origin)).filter(|&a| a != 0);
    let sky_camera = sky_camera.filter(|_| sky_area.is_some());
    let in_sky = |p: [f32; 3]| sky_area.is_some() && light.area_at(p) == sky_area;
    for p in &mut props {
        p.sky = in_sky(p.origin);
    }
    let mut illum_of: HashMap<String, Option<[f32; 3]>> = HashMap::new();
    for p in props.iter_mut().filter(|p| p.static_index.is_none() && p.lighting_origin.is_none()) {
        let Some(at) = *illum_of.entry(p.model.clone()).or_insert_with(|| illum(&p.model)) else { continue };
        let rot = rotation(p.angles);
        let s = p.scale;
        p.lighting_origin = Some(std::array::from_fn(|i| p.origin[i] + (rot[i][0] * at[0] + rot[i][1] * at[1] + rot[i][2] * at[2]) * s));
    }
    let mut lit_at: HashMap<[i32; 3], ([[f32; 3]; 6], bool, Option<([f32; 3], [f32; 3])>)> = HashMap::new();
    for p in &mut props {
        // lit where the game lights it: its lighting origin when it has one, else a little up from its origin; a point in a wall (a
        // prop set into one: a vent, a sign) moves out of it first
        let up = [p.origin[0], p.origin[1], p.origin[2] + 16.0];
        let rot = rotation(p.angles);
        let fwd = [rot[0][0], rot[1][0], rot[2][0]];
        let left = [rot[0][1], rot[1][1], rot[2][1]];
        let at = p.lighting_origin.unwrap_or(up);
        let at = [at, up, [up[0], up[1], up[2] + 24.0]]
            .into_iter()
            .chain([fwd, left].into_iter().flat_map(|d| [1.0f32, -1.0].map(|s| [up[0] + d[0] * 20.0 * s, up[1] + d[1] * 20.0 * s, up[2] + d[2] * 20.0 * s])))
            .find(|q| light.solid_at(*q).is_none())
            .unwrap_or(at);
        let key = at.map(|v| (v / 8.0).round() as i32);
        let (ambient, sunlit, key_light) = *lit_at.entry(key).or_insert_with(|| {
            let l = light.light_at(at);
            (l.cube, light.sunlit(at), l.key)
        });
        p.ambient = ambient;
        p.sunlit = sunlit;
        p.key = key_light;
    }

    // the lightmap atlas: the faces' first light style, the plain (not bumped) samples
    let lit = |f: &Face| -> bool {
        f.lightofs >= 0 && f.lm_size[0] >= 0 && f.lm_size[1] >= 0 && texinfos.get(f.texinfo as usize).is_some_and(|t| t.flags & SURF_NOLIGHT == 0)
    };
    let luxels: usize = faces.iter().filter(|f| lit(f)).map(|f| ((f.lm_size[0] + 2) * (f.lm_size[1] + 2)) as usize).sum();
    let width = ((luxels as f32 * 1.2).sqrt().ceil() as u32).clamp(64, 8192).next_power_of_two();
    let mut atlas = Atlas { width, x: 0, y: 0, row: 0 };
    let mut placed: HashMap<usize, (u32, u32)> = HashMap::new();
    // (tallest first, so the rows waste little)
    let mut order: Vec<usize> = (0..faces.len()).filter(|&i| lit(&faces[i])).collect();
    order.sort_by_key(|&i| std::cmp::Reverse((faces[i].lm_size[1], faces[i].lm_size[0])));
    for i in order {
        let f = &faces[i];
        placed.insert(i, atlas.place(f.lm_size[0] as u32 + 1, f.lm_size[1] as u32 + 1));
    }
    let height = (atlas.y + atlas.row).max(1).next_power_of_two();
    // four pages, one above the other: the plain lightmap, then the three of the bump basis (copies of the plain one for a face without)
    let mut lightmap = vec![0u8; (width * height * 4 * LIGHTMAP_PAGES) as usize];
    for px in lightmap.chunks_exact_mut(4) {
        px[3] = 255;
    }
    let lighting_data = &lighting.data[..];
    for (&i, &(ax, ay)) in &placed {
        let f = &faces[i];
        let (w, h) = (f.lm_size[0] as u32 + 1, f.lm_size[1] as u32 + 1);
        let bumped = texinfos.get(f.texinfo as usize).is_some_and(|t| t.flags & SURF_BUMPLIGHT != 0);
        for page in 0..LIGHTMAP_PAGES {
            let from = if bumped { page } else { 0 };
            for y in 0..h {
                for x in 0..w {
                    let at = f.lightofs as usize + ((from * w * h + y * w + x) as usize) * 4;
                    let Some(s) = lighting_data.get(at..at + 4) else { continue };
                    let c3 = rgbe(s);
                    let o = (((page * height + ay + y) * width + ax + x) * 4) as usize;
                    for c in 0..3 {
                        let v = (c3[c] / LIGHTMAP_RANGE).clamp(0.0, 1.0).sqrt();
                        lightmap[o + c] = (v * 255.0 + 0.5) as u8;
                    }
                }
            }
        }
    }
    let lightmap_uv = |i: usize, f: &Face, t: &TexInfo, p: [f32; 3]| -> [f32; 2] {
        let Some(&(ax, ay)) = placed.get(&i) else { return [-1.0, -1.0] };
        let s = dot(p, [t.lightmap[0][0], t.lightmap[0][1], t.lightmap[0][2]]) + t.lightmap[0][3] - f.lm_mins[0] as f32;
        let u = dot(p, [t.lightmap[1][0], t.lightmap[1][1], t.lightmap[1][2]]) + t.lightmap[1][3] - f.lm_mins[1] as f32;
        [(ax as f32 + s + 0.5) / width as f32, (ay as f32 + u + 0.5) / height as f32]
    };

    // the doors and their triggers: a door opens as far as it is wide along its direction, less its lip (func_door's Spawn)
    let model_box = |n: usize| -> Option<([f32; 3], [f32; 3])> {
        let m = models.data.get(n * 48..n * 48 + 48)?;
        Some((vec3(m, 0), vec3(m, 12)))
    };
    let opened_by_trigger: Vec<&String> = trigger_ents.iter().flat_map(|t| t.2.iter()).collect();
    let mut doors = Vec::new();
    let mut door_of: HashMap<usize, usize> = HashMap::new();
    for (n, name, movedir, speed, lip, start_open, anims) in &door_ents {
        let Some((lo, hi)) = model_box(*n) else { continue };
        let (p, y) = (movedir[0].to_radians(), movedir[1].to_radians());
        let dir = [p.cos() * y.cos(), p.cos() * y.sin(), -p.sin()];
        let size = sub(hi, lo);
        let distance = (dir[0].abs() * (size[0] - 2.0) + dir[1].abs() * (size[1] - 2.0) + dir[2].abs() * (size[2] - 2.0) - lip).max(0.0);
        // (outputs may name many doors at once: `door_middle_*`)
        let gate = !name.is_empty()
            && opened_elsewhere.iter().any(|t| name_matches(name, t))
            && !opened_by_trigger.iter().any(|t| name_matches(name, t));
        door_of.insert(*n, doors.len());
        doors.push(MapDoor { name: name.clone(), dir, distance, speed: *speed, start_open: *start_open || gate, anims: anims.clone() });
    }
    for (n, parent) in prop_parents {
        props[n].door = doors.iter().position(|d: &MapDoor| d.name == parent);
    }
    let triggers: Vec<MapTrigger> = trigger_ents
        .into_iter()
        .filter_map(|(n, origin, open, close)| {
            let (lo, hi) = model_box(n)?;
            Some(MapTrigger { min: [lo[0] + origin[0], lo[1] + origin[1], lo[2] + origin[2]], max: [hi[0] + origin[0], hi[1] + origin[1], hi[2] + origin[2]], open, close })
        })
        .collect();

    // the faces of the shown models, by material
    let mut by_material: HashMap<(String, bool, Option<usize>), MapMesh> = HashMap::new();
    // the displacements of the world, by face: the overlays on them follow their surface
    let mut disp_grids: HashMap<usize, DispGrid> = HashMap::new();
    let mut bounds = [f32::MAX, f32::MAX, f32::MAX, f32::MIN, f32::MIN, f32::MIN];
    for &(model, origin, angles) in &shown_models {
        let Some(m) = models.data.get(model * 48..model * 48 + 48) else { continue };
        let (first, count) = (i32_at(m, 40).unwrap_or(0).max(0) as usize, i32_at(m, 44).unwrap_or(0).max(0) as usize);
        let rotate = rotation(angles);
        let door = door_of.get(&model).copied();
        let place = |p: [f32; 3]| -> [f32; 3] {
            let r = mul3(&rotate, p);
            [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]]
        };
        for i in first..(first + count).min(faces.len()) {
            let f = &faces[i];
            let Some(t) = texinfos.get(f.texinfo as usize) else { continue };
            if t.flags & (SURF_TRIGGER | SURF_NODRAW | SURF_HINT | SURF_SKIP) != 0 {
                continue;
            }
            // the sky's faces show the sky (as the game draws its sky brushes), whatever their material
            let sky_face = t.flags & (SURF_SKY | SURF_SKY2D) != 0;
            let Some((material, tw, th)) = (if sky_face { Some((SKY_MATERIAL.to_string(), 1.0, 1.0)) } else { texdata_of(t.texdata) }) else { continue };
            if material.starts_with("tools/") {
                continue;
            }
            let water = t.flags & SURF_WARP != 0;
            // (a face of the 3D skybox: the point just in front of its middle is in the skybox's area)
            let sky = sky_area.is_some() && model == 0 && {
                let poly = face_vertices(f);
                !poly.is_empty() && {
                    let c = poly.iter().fold([0.0; 3], |a, v| [a[0] + v[0], a[1] + v[1], a[2] + v[2]]).map(|v| v / poly.len() as f32);
                    let pn = vec3(planes, f.plane * 20);
                    let n = if f.side { pn.map(|v| -v) } else { pn };
                    in_sky([c[0] + n[0] * 2.0, c[1] + n[1] * 2.0, c[2] + n[2] * 2.0])
                }
            };
            let mesh = by_material.entry((material.clone(), sky, door)).or_insert_with(|| MapMesh { material: material.clone(), sky, door, ..Default::default() });
            let uv = |p: [f32; 3]| -> [f32; 2] {
                [(dot(p, [t.texture[0][0], t.texture[0][1], t.texture[0][2]]) + t.texture[0][3]) / tw, (dot(p, [t.texture[1][0], t.texture[1][1], t.texture[1][2]]) + t.texture[1][3]) / th]
            };
            let corners = face_vertices(f);
            if corners.len() < 3 {
                continue;
            }
            // the front, from the winding (clockwise seen from the front): what the game culls by. (A face on the back of its plane is
            // not always wound against the plane's normal, so the plane and its side are only the fallback for a degenerate polygon.)
            let wound = corners.windows(2).skip(1).fold([0.0f32; 3], |acc, w| {
                let c = cross(sub(w[0], corners[0]), sub(w[1], corners[0]));
                [acc[0] - c[0], acc[1] - c[1], acc[2] - c[2]]
            });
            let plane_normal = vec3(planes, f.plane * 20);
            let front = if dot(wound, wound) > 1e-8 { normalize(wound) } else if f.side { [-plane_normal[0], -plane_normal[1], -plane_normal[2]] } else { plane_normal };
            let normal = mul3(&rotate, front);
            // the tangent frame, as the game makes it (TangentSpaceSurfaceSetup / TangentSpaceComputeBasis)
            let tangents = |n: [f32; 3]| -> ([f32; 3], [f32; 3]) {
                let sv = normalize(mul3(&rotate, [t.texture[0][0], t.texture[0][1], t.texture[0][2]]));
                let tv = normalize(mul3(&rotate, [t.texture[1][0], t.texture[1][1], t.texture[1][2]]));
                let negate = dot(normal, cross(sv, tv)) > 0.0;
                let mut ts = normalize(cross(n, tv));
                let tt = normalize(cross(ts, n));
                if negate {
                    ts = ts.map(|v| -v);
                }
                (ts, tt)
            };
            let base = (mesh.positions.len() / 3) as u32;
            if f.dispinfo >= 0 && !water {
                let Some(d) = dispinfo.get(f.dispinfo as usize * 176..f.dispinfo as usize * 176 + 176) else { continue };
                if corners.len() != 4 {
                    continue;
                }
                let start = vec3(d, 0);
                let first_vert = i32_at(d, 12).unwrap_or(0).max(0) as usize;
                let power = i32_at(d, 20).unwrap_or(2).clamp(1, 4) as u32;
                let n = (1usize << power) + 1;
                // the corners, from the one nearest the displacement's start
                let k = (0..4).min_by(|&a, &b| dot(sub(corners[a], start), sub(corners[a], start)).total_cmp(&dot(sub(corners[b], start), sub(corners[b], start)))).unwrap_or(0);
                let c: Vec<[f32; 3]> = (0..4).map(|j| corners[(k + j) % 4]).collect();
                // its lightmap lies over its grid, not by the texture's projection: lm_size + 1 luxels along the grid's x (from its start
                // corner toward the fourth) and y (toward the second) (stitched to its neighbours' at the shared edges)
                let lm_at = placed.get(&i).copied();
                let mut grid = Vec::with_capacity(n * n);
                for y in 0..n {
                    let ty = y as f32 / (n - 1) as f32;
                    let left = lerp3(c[0], c[1], ty);
                    let right = lerp3(c[3], c[2], ty);
                    for x in 0..n {
                        let tx = x as f32 / (n - 1) as f32;
                        let flat = lerp3(left, right, tx);
                        let dv = dispverts.get((first_vert + y * n + x) * 20..(first_vert + y * n + x) * 20 + 20);
                        let (offset, dist, alpha) = dv.map_or(([0.0; 3], 0.0, 0.0), |v| (vec3(v, 0), f32_at(v, 12).unwrap_or(0.0), f32_at(v, 16).unwrap_or(0.0)));
                        let p = [flat[0] + offset[0] * dist, flat[1] + offset[1] * dist, flat[2] + offset[2] * dist];
                        let tuv = uv(flat);
                        let luv = lm_at.map_or([-1.0, -1.0], |(ax, ay)| {
                            [(ax as f32 + 0.5 + tx * f.lm_size[0] as f32) / width as f32, (ay as f32 + 0.5 + ty * f.lm_size[1] as f32) / height as f32]
                        });
                        grid.push((place(p), tuv, luv, alpha / 255.0));
                    }
                }
                let mut normals = vec![[0.0f32; 3]; n * n];
                for y in 0..n - 1 {
                    for x in 0..n - 1 {
                        let (a, b, c2, d2) = (y * n + x, (y + 1) * n + x, (y + 1) * n + x + 1, y * n + x + 1);
                        // alternate the diagonal, as the game does
                        let tris = if (x + y) % 2 == 0 { [[a, b, c2], [a, c2, d2]] } else { [[a, b, d2], [b, c2, d2]] };
                        for tri in tris {
                            let nn = cross(sub(grid[tri[1]].0, grid[tri[0]].0), sub(grid[tri[2]].0, grid[tri[0]].0));
                            for &v in &tri {
                                normals[v] = [normals[v][0] + nn[0], normals[v][1] + nn[1], normals[v][2] + nn[2]];
                            }
                            mesh.indices.extend(tri.iter().map(|&v| base + v as u32));
                        }
                    }
                }
                // the winding follows the face's normal
                let flip = {
                    let s: [f32; 3] = normals.iter().fold([0.0; 3], |acc, v| [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]]);
                    dot(s, normal) < 0.0
                };
                if flip {
                    let from = mesh.indices.len() - (n - 1) * (n - 1) * 6;
                    for tri in mesh.indices[from..].chunks_exact_mut(3) {
                        tri.swap(1, 2);
                    }
                }
                if model == 0 {
                    let up = |v: [f32; 3]| if flip { normalize(v).map(|x| -x) } else { normalize(v) };
                    disp_grids.insert(i, DispGrid {
                        corners: [c[0], c[1], c[2], c[3]],
                        n,
                        positions: grid.iter().map(|g| g.0).collect(),
                        lightmap: grid.iter().map(|g| g.2).collect(),
                        normals: normals.iter().map(|&v| up(v)).collect(),
                    });
                }
                for (j, (p, tuv, luv, alpha)) in grid.into_iter().enumerate() {
                    let nn = normalize(normals[j]);
                    let nn = if flip { [-nn[0], -nn[1], -nn[2]] } else { nn };
                    mesh.positions.extend_from_slice(&p);
                    mesh.normals.extend_from_slice(&nn);
                    mesh.uvs.extend_from_slice(&tuv);
                    mesh.lightmap_uvs.extend_from_slice(&luv);
                    mesh.blend.push(alpha);
                    let (ts, tt) = tangents(nn);
                    mesh.tangents_s.extend_from_slice(&ts);
                    mesh.tangents_t.extend_from_slice(&tt);
                    if !sky {
                        grow(&mut bounds, p);
                    }
                }
            } else {
                for &p in &corners {
                    let at = place(p);
                    mesh.positions.extend_from_slice(&at);
                    mesh.normals.extend_from_slice(&normal);
                    mesh.uvs.extend_from_slice(&uv(p));
                    mesh.lightmap_uvs.extend_from_slice(&lightmap_uv(i, f, t, p));
                    mesh.blend.push(0.0);
                    let (ts, tt) = tangents(normal);
                    mesh.tangents_s.extend_from_slice(&ts);
                    mesh.tangents_t.extend_from_slice(&tt);
                    if !sky {
                        grow(&mut bounds, at);
                    }
                }
                // a convex polygon, wound clockwise seen from its front (the game's way): a fan, turned to counter-clockwise
                for k in 1..corners.len() as u32 - 1 {
                    mesh.indices.extend_from_slice(&[base, base + k + 1, base + k]);
                }
            }
        }
    }
    // the overlays (posters, signs, stripes on floors: info_overlay, compiled into the map): their quads, a hair off the surface, lit
    // by the lightmap of the face they lie on
    let overlays = bsp.lump(LUMP_OVERLAYS);
    for o in overlays.data.chunks_exact(352) {
        let texinfo = i16_at(o, 4).unwrap_or(-1);
        let Some(t) = texinfos.get(texinfo.max(0) as usize).filter(|_| texinfo >= 0) else { continue };
        let Some((material, _, _)) = texdata_of(t.texdata) else { continue };
        let face = i32_at(o, 8).unwrap_or(-1);
        let u = [f32_at(o, 264).unwrap_or(0.0), f32_at(o, 268).unwrap_or(1.0)];
        let v = [f32_at(o, 272).unwrap_or(0.0), f32_at(o, 276).unwrap_or(1.0)];
        let pts: Vec<[f32; 3]> = (0..4).map(|k| vec3(o, 280 + k * 12)).collect();
        let origin = vec3(o, 328);
        let normal = normalize(vec3(o, 340));
        let sky = in_sky(origin);
        // the basis: U from the points' third components, V = normal x U (the engine's unpacking)
        let bu = normalize([pts[0][2], pts[1][2], pts[2][2]]);
        let bv = cross(normal, bu);
        let corners: Vec<[f32; 3]> = pts.iter().map(|q| {
            let p = [origin[0] + bu[0] * q[0] + bv[0] * q[1], origin[1] + bu[1] * q[0] + bv[1] * q[1], origin[2] + bu[2] * q[0] + bv[2] * q[1]];
            [p[0] + normal[0] * 0.25, p[1] + normal[1] * 0.25, p[2] + normal[2] * 0.25]
        }).collect();
        let uvs = [[u[0], v[0]], [u[0], v[1]], [u[1], v[1]], [u[1], v[0]]];
        let mesh = by_material.entry((format!("{OVERLAY_PREFIX}{material}"), sky, None)).or_insert_with(|| MapMesh { material: format!("{OVERLAY_PREFIX}{material}"), sky, ..Default::default() });
        let ts = bu;
        let tt = bv.map(|c| -c);
        // wound to face along the normal
        let n = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
        let along = dot(n, normal) >= 0.0;
        // the faces it lies on (as many as 64: a long stripe crosses several): each piece of it on a face, lit by that face's lightmap
        let count = (u16_at(o, 6).unwrap_or(0) & 0x3fff).min(64) as usize;
        let on: Vec<usize> = (0..count).filter_map(|k| i32_at(o, 8 + k * 4)).filter(|&f| f >= 0 && (f as usize) < faces.len()).map(|f| f as usize).collect();
        let quad: Vec<([f32; 3], [f32; 2])> = corners.iter().copied().zip(uvs).collect();
        let mut pieces: Vec<(Vec<([f32; 3], [f32; 2])>, Option<usize>)> = Vec::new();
        if on.len() <= 1 {
            pieces.push((quad.clone(), on.first().copied().or((face >= 0).then_some(face as usize))));
        } else {
            for &fi in &on {
                let poly = face_vertices(&faces[fi]);
                if poly.len() < 3 {
                    continue;
                }
                let c = poly.iter().fold([0.0; 3], |a, v| [a[0] + v[0], a[1] + v[1], a[2] + v[2]]).map(|v| v / poly.len() as f32);
                // the face's edges, each a plane the piece must be inside of (toward the face's middle)
                let mut piece = quad.clone();
                for k in 0..poly.len() {
                    let (a, b) = (poly[k], poly[(k + 1) % poly.len()]);
                    let mut en = cross(sub(b, a), normal);
                    if dot(en, sub(c, a)) < 0.0 {
                        en = en.map(|x| -x);
                    }
                    let side = |p: [f32; 3]| dot(en, sub(p, a));
                    let mut out = Vec::new();
                    for j in 0..piece.len() {
                        let (p, q) = (piece[j], piece[(j + 1) % piece.len()]);
                        let (dp, dq) = (side(p.0), side(q.0));
                        if dp >= 0.0 {
                            out.push(p);
                        }
                        if (dp >= 0.0) != (dq >= 0.0) {
                            let t = dp / (dp - dq);
                            out.push(([p.0[0] + (q.0[0] - p.0[0]) * t, p.0[1] + (q.0[1] - p.0[1]) * t, p.0[2] + (q.0[2] - p.0[2]) * t], [p.1[0] + (q.1[0] - p.1[0]) * t, p.1[1] + (q.1[1] - p.1[1]) * t]));
                        }
                    }
                    piece = out;
                    if piece.len() < 3 {
                        break;
                    }
                }
                if piece.len() >= 3 {
                    pieces.push((piece, Some(fi)));
                }
            }
        }
        for (piece, fi) in pieces {
            // on a displacement: laid over its triangles (as the game clips an overlay to a displacement's surface)
            if let Some(g) = fi.and_then(|fi| disp_grids.get(&fi)) {
                for tri in g.drape(&piece, normal) {
                    let base = (mesh.positions.len() / 3) as u32;
                    let n = normalize(cross(sub(tri[1].0, tri[0].0), sub(tri[2].0, tri[0].0)));
                    let up = tri.iter().fold([0.0; 3], |a, v| [a[0] + v.3[0], a[1] + v.3[1], a[2] + v.3[2]]);
                    for (p, uv, luv, vn) in &tri {
                        // (a little off the surface, along it)
                        mesh.positions.extend_from_slice(&[p[0] + vn[0] * 0.5, p[1] + vn[1] * 0.5, p[2] + vn[2] * 0.5]);
                        mesh.normals.extend_from_slice(vn);
                        mesh.uvs.extend_from_slice(uv);
                        mesh.lightmap_uvs.extend_from_slice(luv);
                        mesh.blend.push(0.0);
                        mesh.tangents_s.extend_from_slice(&ts);
                        mesh.tangents_t.extend_from_slice(&tt);
                    }
                    // wound counter-clockwise seen from above the surface
                    if dot(n, up) >= 0.0 {
                        mesh.indices.extend_from_slice(&[base, base + 1, base + 2]);
                    } else {
                        mesh.indices.extend_from_slice(&[base, base + 2, base + 1]);
                    }
                }
                continue;
            }
            let lit = fi.and_then(|fi| faces.get(fi).and_then(|f| texinfos.get(f.texinfo as usize).map(|ft| (fi, f, ft))));
            // on its face's plane, along its normal, as the engine projects an overlay (its origin may be well off the surface)
            let plane = lit.map(|(_, f, _)| (vec3(planes, f.plane * 20), f32_at(planes, f.plane * 20 + 12).unwrap_or(0.0)));
            let piece: Vec<([f32; 3], [f32; 2])> = piece
                .into_iter()
                .map(|(p, uv)| {
                    let Some((pn, pd)) = plane else { return (p, uv) };
                    let along_n = dot(pn, normal);
                    if along_n.abs() < 1e-3 {
                        return (p, uv);
                    }
                    // (a little off it along its normal, as the corners were)
                    let t = (dot(pn, p) - pd) / along_n - 0.25;
                    ([p[0] - normal[0] * t, p[1] - normal[1] * t, p[2] - normal[2] * t], uv)
                })
                .collect();
            let base = (mesh.positions.len() / 3) as u32;
            for (p, uv) in &piece {
                mesh.positions.extend_from_slice(p);
                mesh.normals.extend_from_slice(&normal);
                mesh.uvs.extend_from_slice(uv);
                mesh.lightmap_uvs.extend_from_slice(&lit.map_or([-1.0, -1.0], |(fi, f, ft)| lightmap_uv(fi, f, ft, *p)));
                mesh.blend.push(0.0);
                mesh.tangents_s.extend_from_slice(&ts);
                mesh.tangents_t.extend_from_slice(&tt);
            }
            for k in 1..piece.len() as u32 - 1 {
                if along {
                    mesh.indices.extend_from_slice(&[base, base + k, base + k + 1]);
                } else {
                    mesh.indices.extend_from_slice(&[base, base + k + 1, base + k]);
                }
            }
        }
    }
    let mut meshes: Vec<MapMesh> = by_material.into_values().filter(|m| !m.indices.is_empty()).collect();
    meshes.sort_by(|a, b| (a.sky, &a.material).cmp(&(b.sky, &b.material)));
    if bounds[0] > bounds[3] {
        bounds = [0.0; 6];
    }
    let cubemaps = bsp.lump(LUMP_CUBEMAPS).data.chunks_exact(16).map(|c| [i32_at(c, 0).unwrap_or(0), i32_at(c, 4).unwrap_or(0), i32_at(c, 8).unwrap_or(0)]).collect();
    // shadow_control: its angles (the default 80 30 0 without one), colour (64 64 64) and distance (75)
    let control = entities.iter().find(|e| e.get("classname").is_some_and(|c| c == "shadow_control"));
    let number3 = |s: Option<&String>| -> Option<[f32; 3]> {
        let v: Vec<f32> = s?.split_whitespace().filter_map(|x| x.parse().ok()).collect();
        (v.len() >= 3).then(|| [v[0], v[1], v[2]])
    };
    let shadow = if control.and_then(|c| c.get("disableallshadows")).is_some_and(|d| d.trim() == "1") {
        None
    } else {
        let [pitch, yaw, _] = number3(control.and_then(|c| c.get("angles"))).unwrap_or([80.0, 30.0, 0.0]);
        let (p, y) = (pitch.to_radians(), yaw.to_radians());
        let color = number3(control.and_then(|c| c.get("color"))).unwrap_or([64.0, 64.0, 64.0]).map(|c| (c / 255.0).clamp(0.0, 1.0));
        let distance = control.and_then(|c| c.get("distance")).and_then(|d| d.trim().parse().ok()).filter(|d: &f32| *d > 0.0).unwrap_or(75.0);
        Some(MapShadow { dir: [p.cos() * y.cos(), p.cos() * y.sin(), -p.sin()], color, distance })
    };
    Ok(Map { meshes, props, spawns, lightmap_width: width, lightmap_height: height, lightmap, sky, bounds, sun, light, exposure_min, exposure_max, cubemaps, shadow, sky_camera, fog, doors, triggers })
}

/// A displacement of the world: its flat quad (from the corner its grid starts at: the grid's y runs toward the second, x toward the
/// fourth) and its grid (n x n, row by row): where each point is, its lightmap position and its normal.
struct DispGrid {
    corners: [[f32; 3]; 4],
    n: usize,
    positions: Vec<[f32; 3]>,
    lightmap: Vec<[f32; 2]>,
    normals: Vec<[f32; 3]>,
}

/// A vertex of an overlay laid over a displacement: where it is, its overlay uv, its lightmap uv, its normal.
type DrapedVertex = ([f32; 3], [f32; 2], [f32; 2], [f32; 3]);

impl DispGrid {
    /// Where a point over the flat quad is in its grid (x, y in 0..1), seen along a direction (the overlay's normal: the game projects
    /// an overlay onto a sloped face along it, not across the face): the bilinear quad's parameters, by a few Newton steps.
    fn param(&self, p: [f32; 3], along: [f32; 3]) -> [f32; 2] {
        // (vectors with their part along the direction taken out)
        let flat = |v: [f32; 3]| { let d = dot(v, along); [v[0] - along[0] * d, v[1] - along[1] * d, v[2] - along[2] * d] };
        let [c0, c1, c2, c3] = self.corners;
        let at = |x: f32, y: f32| lerp3(lerp3(c0, c1, y), lerp3(c3, c2, y), x);
        let (mut x, mut y) = (0.5f32, 0.5f32);
        for _ in 0..8 {
            let e = flat(sub(at(x, y), p));
            // d/dx and d/dy of the quad
            let dx = flat(sub(lerp3(c3, c2, y), lerp3(c0, c1, y)));
            let dy = flat(sub(lerp3(c1, c2, x), lerp3(c0, c3, x)));
            // least squares: [dx dy] [ix iy] = -e (seen along the direction)
            let (a, b, c) = (dot(dx, dx), dot(dx, dy), dot(dy, dy));
            let (r0, r1) = (-dot(dx, e), -dot(dy, e));
            let det = a * c - b * b;
            if det.abs() < 1e-9 {
                break;
            }
            x += (r0 * c - r1 * b) / det;
            y += (a * r1 - b * r0) / det;
        }
        [x, y]
    }

    /// An overlay's piece (a convex polygon with its uv, over the flat quad) laid over the displacement's triangles: the triangles of it.
    fn drape(&self, piece: &[([f32; 3], [f32; 2])], along: [f32; 3]) -> Vec<[DrapedVertex; 3]> {
        let n = self.n;
        let m = (n - 1) as f32;
        // the piece in the grid's space, with its uv
        let poly: Vec<([f32; 2], [f32; 2])> = piece.iter().map(|(p, uv)| (self.param(*p, along), *uv)).collect();
        let (mut lo, mut hi) = ([f32::MAX; 2], [f32::MIN; 2]);
        for (q, _) in &poly {
            for k in 0..2 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
        let cell = |v: f32| ((v * m).floor().max(0.0) as usize).min(n - 2);
        let mut out = Vec::new();
        for gy in cell(lo[1])..=cell(hi[1]) {
            for gx in cell(lo[0])..=cell(hi[0]) {
                let (a, b, c2, d2) = (gy * n + gx, (gy + 1) * n + gx, (gy + 1) * n + gx + 1, gy * n + gx + 1);
                let tris = if (gx + gy) % 2 == 0 { [[a, b, c2], [a, c2, d2]] } else { [[a, b, d2], [b, c2, d2]] };
                for tri in tris {
                    let gp = tri.map(|k| [(k % n) as f32 / m, (k / n) as f32 / m]);
                    // the piece clipped to the triangle (its three edges, toward its third corner)
                    let mut clipped = poly.clone();
                    for e in 0..3 {
                        let (p0, p1, p2) = (gp[e], gp[(e + 1) % 3], gp[(e + 2) % 3]);
                        let edge = |q: [f32; 2]| (p1[0] - p0[0]) * (q[1] - p0[1]) - (p1[1] - p0[1]) * (q[0] - p0[0]);
                        let inside = edge(p2).signum();
                        let side = |q: [f32; 2]| edge(q) * inside;
                        let mut next = Vec::new();
                        for j in 0..clipped.len() {
                            let (pa, pb) = (clipped[j], clipped[(j + 1) % clipped.len()]);
                            let (da, db) = (side(pa.0), side(pb.0));
                            if da >= 0.0 {
                                next.push(pa);
                            }
                            if (da >= 0.0) != (db >= 0.0) {
                                let t = da / (da - db);
                                let l2 = |u: [f32; 2], v: [f32; 2]| [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
                                next.push((l2(pa.0, pb.0), l2(pa.1, pb.1)));
                            }
                        }
                        clipped = next;
                        if clipped.len() < 3 {
                            break;
                        }
                    }
                    if clipped.len() < 3 {
                        continue;
                    }
                    // each vertex on the displaced triangle: by its barycentric weights there
                    let det = (gp[1][1] - gp[2][1]) * (gp[0][0] - gp[2][0]) + (gp[2][0] - gp[1][0]) * (gp[0][1] - gp[2][1]);
                    if det.abs() < 1e-12 {
                        continue;
                    }
                    let vert = |(q, uv): ([f32; 2], [f32; 2])| -> DrapedVertex {
                        let w0 = ((gp[1][1] - gp[2][1]) * (q[0] - gp[2][0]) + (gp[2][0] - gp[1][0]) * (q[1] - gp[2][1])) / det;
                        let w1 = ((gp[2][1] - gp[0][1]) * (q[0] - gp[2][0]) + (gp[0][0] - gp[2][0]) * (q[1] - gp[2][1])) / det;
                        let w = [w0, w1, 1.0 - w0 - w1];
                        let mix3 = |v: &[[f32; 3]]| -> [f32; 3] {
                            let mut o = [0.0; 3];
                            for (k, &idx) in tri.iter().enumerate() {
                                for c in 0..3 {
                                    o[c] += v[idx][c] * w[k];
                                }
                            }
                            o
                        };
                        let mut l = [0.0; 2];
                        for (k, &idx) in tri.iter().enumerate() {
                            l[0] += self.lightmap[idx][0] * w[k];
                            l[1] += self.lightmap[idx][1] * w[k];
                        }
                        (mix3(&self.positions), uv, l, normalize(mix3(&self.normals)))
                    };
                    let vs: Vec<DrapedVertex> = clipped.into_iter().map(vert).collect();
                    for k in 1..vs.len() - 1 {
                        out.push([vs[0], vs[k], vs[k + 1]]);
                    }
                }
            }
        }
        out
    }
}

fn grow(b: &mut [f32; 6], p: [f32; 3]) {
    for i in 0..3 {
        b[i] = b[i].min(p[i]);
        b[i + 3] = b[i + 3].max(p[i]);
    }
}

/// The material name the sky's faces are grouped under (no such material exists: they show the sky).
pub const SKY_MATERIAL: &str = "__sky__";
/// What an overlay's material name starts with in the meshes (`overlay:decals/stripes`): drawn over the surface it lies on.
pub const OVERLAY_PREFIX: &str = "overlay:";

/// The brush entities whose faces are drawn (doors, walls, glass ...); triggers, clips and the like are not.
const BRUSH_SHOWN: &[&str] = &[
    "func_brush", "func_door", "func_door_rotating", "func_wall", "func_wall_toggle", "func_illusionary", "func_breakable", "func_breakable_surf",
    "func_movelinear", "func_rotating", "func_tracktrain", "func_lod", "func_button", "func_physbox", "func_reflective_glass", "func_water_analog",
    "func_tanktrain", "func_conveyor", "func_detail_blocker", "func_croc", "func_capturezone_visualizer",
];

/// The entities whose model is drawn.
const PROP_SHOWN: &[&str] = &[
    "prop_dynamic", "prop_dynamic_override", "prop_physics", "prop_physics_override", "prop_physics_multiplayer", "prop_dynamic_ornament",
    "prop_static", "item_healthkit_full", "item_healthkit_medium", "item_healthkit_small", "item_ammopack_full", "item_ammopack_medium",
    "item_ammopack_small", "team_control_point", "item_teamflag", "monster_resource",
];

/// The rotation a set of game angles (pitch, yaw, roll in degrees) makes, as rows.
fn rotation(a: [f32; 3]) -> [[f32; 3]; 3] {
    let (p, y, r) = (a[0].to_radians(), a[1].to_radians(), a[2].to_radians());
    let (sp, cp, sy, cy, sr, cr) = (p.sin(), p.cos(), y.sin(), y.cos(), r.sin(), r.cos());
    // AngleMatrix (mathlib): columns are forward, left, up
    [
        [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
        [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
        [-sp, sr * cp, cr * cp],
    ]
}

fn mul3(m: &[[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

fn parse3(s: &str) -> [f32; 3] {
    let mut out = [0.0; 3];
    for (o, v) in out.iter_mut().zip(s.split_whitespace()) {
        *o = v.parse().unwrap_or(0.0);
    }
    out
}

/// The entities lump: `{ "key" "value" ... }` blocks.
/// A map's entities (keys in lower case; a key given more than once has its values joined by new lines).
pub fn entities(file: &[u8]) -> Result<Vec<HashMap<String, String>>> {
    let bsp = Bsp::new(file)?;
    let lump = bsp.lump(LUMP_ENTITIES);
    Ok(parse_entities(&String::from_utf8_lossy(&lump.data)))
}

fn parse_entities(text: &str) -> Vec<HashMap<String, String>> {
    let mut out = Vec::new();
    let mut current: Option<HashMap<String, String>> = None;
    let mut chars = text.chars().peekable();
    let mut pending: Option<String> = None;
    while let Some(c) = chars.next() {
        match c {
            '{' => current = Some(HashMap::new()),
            '}' => {
                if let Some(e) = current.take() { out.push(e); }
                pending = None;
            }
            '"' => {
                let mut s = String::new();
                for c in chars.by_ref() {
                    if c == '"' { break; }
                    s.push(c);
                }
                if let Some(e) = current.as_mut() {
                    match pending.take() {
                        // (a key given more than once, the outputs: all of its values, one per line)
                        Some(k) => {
                            e.entry(k.to_ascii_lowercase()).and_modify(|v: &mut String| { v.push('\n'); v.push_str(&s); }).or_insert(s);
                        }
                        None => pending = Some(s),
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// The static props of the game lump `sprp`.
fn static_props(bsp: &Bsp) -> Vec<MapProp> {
    let game = bsp.lump(LUMP_GAME_LUMP);
    let g = &game.data[..];
    let mut out = Vec::new();
    let Some(count) = i32_at(g, 0) else { return out };
    for i in 0..count.max(0) as usize {
        let h = 4 + i * 16;
        let (Some(id), Some(flags), Some(version), Some(ofs), Some(len)) = (u32_at(g, h), u16_at(g, h + 4), u16_at(g, h + 6), i32_at(g, h + 8), i32_at(g, h + 12)) else { break };
        if id != u32::from_be_bytes(*b"sprp") {
            continue;
        }
        // (offsets are from the start of the file)
        let Some(raw) = bsp.file.get(ofs.max(0) as usize..(ofs.max(0) + len.max(0)) as usize) else { continue };
        let data = if flags & 1 != 0 || raw.starts_with(b"LZMA") { std::borrow::Cow::Owned(lzma(raw).unwrap_or_default()) } else { std::borrow::Cow::Borrowed(raw) };
        let d = &data[..];
        let Some(names) = i32_at(d, 0) else { continue };
        let names: Vec<String> = (0..names.max(0) as usize)
            .filter_map(|k| d.get(4 + k * 128..4 + k * 128 + 128))
            .map(|n| String::from_utf8_lossy(&n[..n.iter().position(|&b| b == 0).unwrap_or(128)]).replace('\\', "/").to_ascii_lowercase())
            .collect();
        let mut at = 4 + names.len() * 128;
        let leaves = i32_at(d, at).unwrap_or(0).max(0) as usize;
        at += 4 + leaves * 2;
        let props = i32_at(d, at).unwrap_or(0).max(0) as usize;
        at += 4;
        if props == 0 {
            continue;
        }
        let stride = (d.len() - at) / props;
        if stride < 56 {
            continue;
        }
        for k in 0..props {
            let p = &d[at + k * stride..at + (k + 1) * stride];
            let Some(model) = names.get(u16_at(p, 24).unwrap_or(0) as usize) else { continue };
            // version 11 ends with a uniform scale
            let scale = if version >= 11 { f32_at(p, stride - 4).filter(|s| *s > 0.0 && s.is_finite()).unwrap_or(1.0) } else { 1.0 };
            out.push(MapProp { static_index: Some(k as u32), model: model.clone(), origin: vec3(p, 0), angles: vec3(p, 12), skin: i32_at(p, 32).unwrap_or(0), scale, ambient: [[0.0; 3]; 6], sunlit: false, key: None, door: None, name: None,
                // (flag 2: STATIC_PROP_USE_LIGHTING_ORIGIN)
                lighting_origin: (p[31] & 2 != 0).then(|| vec3(p, 44)), animation: None, sky: false });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entities_parse_with_their_keys() {
        let e = parse_entities("{\n\"classname\" \"worldspawn\"\n\"skyname\" \"sky_day01_01\"\n}\n{\n\"classname\" \"info_player_teamspawn\"\n\"origin\" \"1 2 3\"\n\"TeamNum\" \"2\"\n}\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e[0]["skyname"], "sky_day01_01");
        assert_eq!(e[1]["teamnum"], "2");
        assert_eq!(parse3(&e[1]["origin"]), [1.0, 2.0, 3.0]);
    }

    #[test]
    fn angles_turn_like_the_game() {
        // yaw 90 turns forward (x) to left (y)
        let m = rotation([0.0, 90.0, 0.0]);
        let v = mul3(&m, [1.0, 0.0, 0.0]);
        assert!((v[0]).abs() < 1e-5 && (v[1] - 1.0).abs() < 1e-5);
        // pitch 90 turns forward to down
        let v = mul3(&rotation([90.0, 0.0, 0.0]), [1.0, 0.0, 0.0]);
        assert!((v[2] + 1.0).abs() < 1e-5);
    }

    #[test]
    fn a_short_or_strange_file_is_refused() {
        assert!(read(b"VBSP").is_err());
        assert!(read(&[0u8; 2000]).is_err());
    }
}

#[cfg(test)]
mod game_tests {
    use super::*;

    /// A real map, from the game folder in TF2_TF_DIR (skipped without it).
    #[test]
    fn a_game_map_reads_with_front_facing_triangles() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let Ok(maps) = std::fs::read_dir(std::path::Path::new(&dir).join("maps")) else { return };
        for entry in maps.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "bsp") {
                continue;
            }
            let map = read(&std::fs::read(&path).unwrap()).unwrap();
            let (mut agree, mut total) = (0usize, 0usize);
            for m in &map.meshes {
                let p = |i: u32| [m.positions[i as usize * 3], m.positions[i as usize * 3 + 1], m.positions[i as usize * 3 + 2]];
                for t in m.indices.chunks_exact(3) {
                    let n = cross(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0])));
                    if dot(n, n) < 1e-6 {
                        continue;
                    }
                    let nv = |i: u32| [m.normals[i as usize * 3], m.normals[i as usize * 3 + 1], m.normals[i as usize * 3 + 2]];
                    let (a, b, c) = (nv(t[0]), nv(t[1]), nv(t[2]));
                    let vn = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
                    total += 1;
                    agree += (dot(n, vn) > 0.0) as usize;
                }
            }
            let tris: usize = map.meshes.iter().map(|m| m.indices.len() / 3).sum();
            eprintln!(
                "{}: {} materials, {tris} triangles, {} props, {} spawns, lightmap {}x{}, sky {:?}, front-facing {}/{}",
                path.display(), map.meshes.len(), map.props.len(), map.spawns.len(), map.lightmap_width, map.lightmap_height, map.sky, agree, total
            );
            // (a steep displacement folds over its face here and there: a few of its triangles face away from their neighbours)
            assert!(tris > 1000 && agree * 100 >= total * 98);
            assert!(map.meshes.iter().all(|m| m.uvs.len() / 2 == m.positions.len() / 3 && m.lightmap_uvs.len() == m.uvs.len() && m.blend.len() == m.positions.len() / 3));
        }
    }
}

/// What a map's material needs to be drawn: its shader, the parameters that change how, and its base textures (the second one of a
/// blend), each read at the first mip no bigger than `max_size`.
pub struct MapMaterial {
    pub shader: String,
    pub params: HashMap<String, String>,
    /// `base` and, for a blend (WorldVertexTransition), `base2`; an animated texture's other frames as `base_f<N>` / `bump_f<N>`.
    pub textures: Vec<(String, crate::vtf::Image)>,
    /// Its proxies (an animated texture, a scrolling one: the renderer runs them on its clock).
    pub proxies: Vec<crate::vmt::Proxy>,
}

/// The most frames of an animated map texture kept.
const MAP_ANIMATION_FRAMES: usize = 64;

/// The parameters of a map material the viewer reads.
const MAP_MATERIAL_PARAMS: &[&str] = &[
    "$translucent", "$alphatest", "$alphatestreference", "$additive", "$nocull", "$color", "$color2", "$fogcolor", "$basetexturetransform",
    "$basetexturetransform2", "$selfillum", "$alpha", "$vertexalpha", "$blendmodulatetexture", "$surfaceprop", "$ssbump", "$envmap",
    "$envmaptint", "$basealphaenvmapmask", "$normalmapalphaenvmapmask", "$envmapcontrast", "$envmapsaturation", "$fresnelreflection",
    "$bumptransform", "$nodiffusebumplighting", "$selfillumtint", "$detailscale", "$detailblendfactor", "$detailblendmode", "$decal",
    "$detailtexturetransform", "$phong", "$phongexponent", "$phongboost", "$phongfresnelranges", "$phongtint", "$basemapalphaphongmask",
    "$rimlight", "$rimlightexponent", "$rimlightboost", "$rimmask", "$selfillum", "$halflambert", "$phongalbedotint", "$invertphongmask",
    "$nofog", "$texture2transform",
];

/// The biggest face of a material's cubemap (reflections are blurry).
const CUBE_FACE: u32 = 128;

pub fn map_material(vpk: &crate::VpkSet, name: &str, max_size: u32) -> std::result::Result<MapMaterial, String> {
    let path = format!("materials/{}.vmt", name.trim_start_matches('/').trim_end_matches(".vmt"));
    let vmt = crate::vmt::load(vpk, &path).map_err(|e| e.to_string())?;
    let mut textures = Vec::new();
    let vtf_of = |tex: &str| {
        let tex = tex.replace('\\', "/").to_ascii_lowercase();
        format!("materials/{}.vtf", tex.trim_start_matches('/').trim_end_matches(".vtf"))
    };
    for (slot, keys) in [
        ("base", &["$basetexture"][..]),
        ("base2", &["$basetexture2"][..]),
        // (UnlitTwoTexture's second texture, multiplied in)
        ("texture2", &["$texture2"][..]),
        ("bump", &["$bumpmap", "$normalmap"][..]),
        ("bump2", &["$bumpmap2"][..]),
        ("envmask", &["$envmapmask"][..]),
        ("detail", &["$detail"][..]),
        ("exponent", &["$phongexponenttexture"][..]),
    ] {
        let Some(tex) = keys.iter().find_map(|k| vmt.get(k)) else { continue };
        let vtf = vtf_of(tex);
        let Ok(bytes) = vpk.read(&vtf) else { continue };
        let Ok(info) = crate::vtf::info(&bytes) else { continue };
        let mut mip = 0;
        while (info.width.max(info.height) >> mip) > max_size && mip + 1 < info.mip_count {
            mip += 1;
        }
        if let Ok(img) = crate::vtf::decode(&bytes, mip) {
            textures.push((slot.to_string(), img));
        }
        // its other frames, when an AnimatedTexture proxy cycles it
        let var = keys[0];
        let animated = vmt.proxies.iter().any(|p| p.name == "animatedtexture" && p.params.get("animatedtexturevar").is_some_and(|v| v.eq_ignore_ascii_case(var)));
        if animated && info.frames > 1 && (slot == "base" || slot == "bump") {
            if let Ok(frames) = crate::vtf::decode_frames(&bytes, mip, MAP_ANIMATION_FRAMES) {
                textures.extend(frames.into_iter().enumerate().skip(1).map(|(i, img)| (format!("{slot}_f{i}"), img)));
            }
        }
    }
    // the cubemap it reflects: its own, or the map's nearest (a patch material of the map names that one in place of env_cubemap)
    if let Some(env) = vmt.get("$envmap").filter(|e| !e.eq_ignore_ascii_case("env_cubemap")) {
        let base = vtf_of(env);
        let hdr = base.replace(".vtf", ".hdr.vtf");
        for path in [base, hdr] {
            let Ok(bytes) = vpk.read(&path) else { continue };
            let Ok(info) = crate::vtf::info(&bytes) else { continue };
            let mut mip = 0;
            while (info.width >> mip) > CUBE_FACE && mip + 1 < info.mip_count {
                mip += 1;
            }
            if let Ok(faces) = crate::vtf::decode_faces(&bytes, mip) {
                textures.extend(faces.into_iter().enumerate().map(|(i, img)| (format!("env{i}"), img)));
                break;
            }
        }
    }
    let params = MAP_MATERIAL_PARAMS.iter().filter_map(|k| vmt.get(k).map(|v| (k.to_string(), v.to_string()))).collect();
    Ok(MapMaterial { shader: vmt.shader.clone(), params, textures, proxies: vmt.proxies.clone() })
}

#[cfg(test)]
mod light_tests {
    /// The light of a real map (TF2_TF_DIR): props are lit, some by the sun and some not, and the ambient light is not all dark.
    #[test]
    fn a_game_maps_props_are_lit() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let path = std::path::Path::new(&dir).join("maps/koth_krampus.bsp");
        let Ok(bytes) = std::fs::read(&path) else { return };
        let t = std::time::Instant::now();
        let map = super::read(&bytes).unwrap();
        let sunlit = map.props.iter().filter(|p| p.sunlit).count();
        let bright = map.props.iter().filter(|p| p.ambient.iter().flatten().sum::<f32>() + p.key.map_or(0.0, |k| k.1.iter().sum::<f32>()) > 0.05).count();
        eprintln!("{} props, {sunlit} in the sun, {bright} with ambient light, sun {:?}, {:?}", map.props.len(), map.sun.map(|s| (s.dir, s.color)), t.elapsed());
        let p = &map.props[map.props.len() / 2];
        eprintln!("sample {} {:?} {:?}", p.model, p.origin, p.ambient);
        assert!(map.sun.is_some() && sunlit > 0 && sunlit < map.props.len() && bright > map.props.len() / 2);
    }
}

#[cfg(test)]
mod overlay_tests {
    /// itemtest (TF2_TF_DIR): its floor stripes are overlays and it sets its exposure limits; vsh_maul's sky has faces.
    #[test]
    fn itemtest_has_its_overlays_sky_and_exposure() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let Ok(bytes) = std::fs::read(std::path::Path::new(&dir).join("maps/itemtest.bsp")) else { return };
        let map = super::read(&bytes).unwrap();
        let overlays: Vec<&str> = map.meshes.iter().filter(|m| m.material.starts_with(super::OVERLAY_PREFIX)).map(|m| m.material.as_str()).collect();
        eprintln!("overlays {overlays:?} exposure {:?}..{:?}", map.exposure_min, map.exposure_max);
        assert!(!overlays.is_empty());
        assert_eq!((map.exposure_min, map.exposure_max), (Some(0.5), Some(0.8)));
        // an outdoor map's sky has faces
        let Ok(bytes) = std::fs::read(std::path::Path::new(&dir).join("maps/vsh_maul.bsp")) else { return };
        assert!(super::read(&bytes).unwrap().meshes.iter().any(|m| m.material == super::SKY_MATERIAL));
    }
}

#[cfg(test)]
mod overlay_light_tests {
    /// itemtest (TF2_TF_DIR): its long floor stripe crosses several faces; every piece of it reads a lit part of the lightmap.
    #[test]
    fn itemtests_stripe_is_lit_all_along() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let Ok(bytes) = std::fs::read(std::path::Path::new(&dir).join("maps/itemtest.bsp")) else { return };
        let map = super::read(&bytes).unwrap();
        let (w, h) = (map.lightmap_width as usize, map.lightmap_height as usize);
        let (mut dark, mut total) = (0, 0);
        for m in map.meshes.iter().filter(|m| m.material.starts_with(super::OVERLAY_PREFIX)) {
            for uv in m.lightmap_uvs.chunks_exact(2) {
                total += 1;
                let (x, y) = ((uv[0] * w as f32) as usize, (uv[1] * h as f32) as usize);
                let px = map.lightmap.get((y.min(h - 1) * w + x.min(w - 1)) * 4..).map_or(0, |p| p[0] as u32 + p[1] as u32 + p[2] as u32);
                if uv[0] < 0.0 || px == 0 {
                    dark += 1;
                }
            }
        }
        assert!(total > 4 && dark == 0, "{dark} of {total} overlay corners unlit");
    }
}

#[cfg(test)]
mod disp_lightmap_tests {
    /// Surfaces (koth_krampus in TF2_TF_DIR) meet their neighbours' light where they share an edge: a displacement's lightmap is read
    /// over its grid, as the game lays it out (read by the texture's projection, its slopes showed their neighbours' shadows: 11 apart
    /// on average, against 4).
    #[test]
    fn displacements_meet_their_neighbours_light() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let Ok(bytes) = std::fs::read(std::path::Path::new(&dir).join("maps/koth_krampus.bsp")) else { return };
        let map = super::read(&bytes).unwrap();
        let (w, h) = (map.lightmap_width as usize, map.lightmap_height as usize);
        let sample = |uv: &[f32]| {
            let (x, y) = (((uv[0] * w as f32) as usize).min(w - 1), ((uv[1] * h as f32) as usize).min(h - 1));
            let o = (y * w + x) * 4;
            map.lightmap[o] as i32 + map.lightmap[o + 1] as i32 + map.lightmap[o + 2] as i32
        };
        // the light at each point of the map's surfaces
        // (by place and facing: where two surfaces meet at an angle, a wall and a floor, their light differs)
        let mut at: std::collections::HashMap<[i32; 6], Vec<i32>> = Default::default();
        for m in &map.meshes {
            for (k, uv) in m.lightmap_uvs.chunks_exact(2).enumerate() {
                if uv[0] < 0.0 {
                    continue;
                }
                let n = |c: usize| (m.normals[k * 3 + c] * 4.0).round() as i32;
                let p = [m.positions[k * 3].round() as i32, m.positions[k * 3 + 1].round() as i32, m.positions[k * 3 + 2].round() as i32, n(0), n(1), n(2)];
                at.entry(p).or_default().push(sample(uv));
            }
        }
        let shared: Vec<i32> = at.values().filter(|v| v.len() > 1).map(|v| v.iter().max().unwrap() - v.iter().min().unwrap()).collect();
        let mean = shared.iter().sum::<i32>() as f32 / shared.len().max(1) as f32;
        assert!(shared.len() > 1000 && mean < 7.0, "{} shared points, mean light difference {mean}", shared.len());
    }
}

#[cfg(test)]
mod shadow_control_tests {
    /// koth_camp_saxton (TF2_TF_DIR): its shadow_control says how its characters' shadows fall; its lanterns play an animation.
    #[test]
    fn camp_saxtons_shadows_and_animated_props() {
        let Some(dir) = std::env::var_os("TF2_TF_DIR") else { return };
        let Ok(bytes) = std::fs::read(std::path::Path::new(&dir).join("maps/koth_camp_saxton.bsp")) else { return };
        let map = super::read(&bytes).unwrap();
        let s = map.shadow.expect("its shadows");
        let len = (s.dir[0] * s.dir[0] + s.dir[1] * s.dir[1] + s.dir[2] * s.dir[2]).sqrt();
        assert!((len - 1.0).abs() < 1e-3 && s.dir[2] < 0.0 && s.distance > 0.0, "{s:?}");
        assert!(map.props.iter().any(|p| p.static_index.is_none() && p.model.contains("lantern")));
        assert!(map.props.iter().any(|p| p.animation.as_deref() == Some("ref")));
    }
}
