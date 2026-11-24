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
    pub indices: Vec<u32>,
}

/// A model the map places: a static prop or a prop entity.
pub struct MapProp {
    /// `models/....mdl`, in lower case with forward slashes.
    pub model: String,
    pub origin: [f32; 3],
    /// Pitch, yaw, roll in degrees, as the game gives them.
    pub angles: [f32; 3],
    pub skin: i32,
    pub scale: f32,
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
    /// The lightmap atlas: `width` x `height` RGBA, each colour the square root of the light over [`LIGHTMAP_RANGE`] (so 8 bits keep the
    /// darks); alpha is 255.
    pub lightmap_width: u32,
    pub lightmap_height: u32,
    pub lightmap: Vec<u8>,
    /// The 2D sky (`skyname` of worldspawn), when it names one.
    pub sky: Option<String>,
    /// The world's bounds (min xyz, max xyz).
    pub bounds: [f32; 6],
}

/// The brightest light the lightmap atlas keeps (linear; 1 is a surface lit to its own colour).
pub const LIGHTMAP_RANGE: f32 = 4.0;

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
    for e in &entities {
        let class = e.get("classname").map(String::as_str).unwrap_or("");
        let origin = e.get("origin").map(|s| parse3(s)).unwrap_or([0.0; 3]);
        let angles = e.get("angles").map(|s| parse3(s)).unwrap_or([0.0; 3]);
        match class {
            "worldspawn" => sky = e.get("skyname").filter(|s| !s.is_empty()).cloned(),
            "info_player_teamspawn" => spawns.push(MapSpawn { origin, yaw: angles[1], team: e.get("teamnum").and_then(|t| t.parse().ok()).unwrap_or(0) }),
            _ => {}
        }
        let Some(model) = e.get("model") else { continue };
        if let Some(n) = model.strip_prefix('*') {
            if BRUSH_SHOWN.contains(&class) && e.get("rendermode").map_or(true, |m| m != "10") {
                if let Ok(n) = n.parse::<usize>() { shown_models.push((n, origin, angles)); }
            }
        } else if model.ends_with(".mdl") && PROP_SHOWN.contains(&class) && e.get("rendermode").map_or(true, |m| m != "10") {
            props.push(MapProp {
                model: model.replace('\\', "/").to_ascii_lowercase(),
                origin,
                angles,
                skin: e.get("skin").and_then(|s| s.parse().ok()).unwrap_or(0),
                scale: e.get("modelscale").and_then(|s| s.parse().ok()).filter(|s: &f32| *s > 0.0).unwrap_or(1.0),
            });
        }
    }
    props.extend(static_props(&bsp));

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
    let mut lightmap = vec![0u8; (width * height * 4) as usize];
    for px in lightmap.chunks_exact_mut(4) {
        px[3] = 255;
    }
    let light = &lighting.data[..];
    for (&i, &(ax, ay)) in &placed {
        let f = &faces[i];
        let (w, h) = (f.lm_size[0] as u32 + 1, f.lm_size[1] as u32 + 1);
        for y in 0..h {
            for x in 0..w {
                let at = f.lightofs as usize + ((y * w + x) as usize) * 4;
                let Some(s) = light.get(at..at + 4) else { continue };
                let scale = 2f32.powi(s[3] as i8 as i32) / 255.0;
                let o = (((ay + y) * width + ax + x) * 4) as usize;
                for c in 0..3 {
                    let v = (s[c] as f32 * scale / LIGHTMAP_RANGE).clamp(0.0, 1.0).sqrt();
                    lightmap[o + c] = (v * 255.0 + 0.5) as u8;
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

    // the faces of the shown models, by material
    let mut by_material: HashMap<String, MapMesh> = HashMap::new();
    let mut bounds = [f32::MAX, f32::MAX, f32::MAX, f32::MIN, f32::MIN, f32::MIN];
    for &(model, origin, angles) in &shown_models {
        let Some(m) = models.data.get(model * 48..model * 48 + 48) else { continue };
        let (first, count) = (i32_at(m, 40).unwrap_or(0).max(0) as usize, i32_at(m, 44).unwrap_or(0).max(0) as usize);
        let rotate = rotation(angles);
        let place = |p: [f32; 3]| -> [f32; 3] {
            let r = mul3(&rotate, p);
            [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]]
        };
        for i in first..(first + count).min(faces.len()) {
            let f = &faces[i];
            let Some(t) = texinfos.get(f.texinfo as usize) else { continue };
            if t.flags & (SURF_SKY | SURF_SKY2D | SURF_TRIGGER | SURF_NODRAW | SURF_HINT | SURF_SKIP) != 0 {
                continue;
            }
            let Some((material, tw, th)) = texdata_of(t.texdata) else { continue };
            if material.starts_with("tools/") {
                continue;
            }
            let water = t.flags & SURF_WARP != 0;
            let mesh = by_material.entry(material.clone()).or_insert_with(|| MapMesh { material: material.clone(), ..Default::default() });
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
                let lm: Vec<[f32; 2]> = c.iter().map(|&p| lightmap_uv(i, f, t, p)).collect();
                let mut grid = Vec::with_capacity(n * n);
                for y in 0..n {
                    let ty = y as f32 / (n - 1) as f32;
                    let left = lerp3(c[0], c[1], ty);
                    let right = lerp3(c[3], c[2], ty);
                    let lm_left = [lm[0][0] + (lm[1][0] - lm[0][0]) * ty, lm[0][1] + (lm[1][1] - lm[0][1]) * ty];
                    let lm_right = [lm[3][0] + (lm[2][0] - lm[3][0]) * ty, lm[3][1] + (lm[2][1] - lm[3][1]) * ty];
                    for x in 0..n {
                        let tx = x as f32 / (n - 1) as f32;
                        let flat = lerp3(left, right, tx);
                        let dv = dispverts.get((first_vert + y * n + x) * 20..(first_vert + y * n + x) * 20 + 20);
                        let (offset, dist, alpha) = dv.map_or(([0.0; 3], 0.0, 0.0), |v| (vec3(v, 0), f32_at(v, 12).unwrap_or(0.0), f32_at(v, 16).unwrap_or(0.0)));
                        let p = [flat[0] + offset[0] * dist, flat[1] + offset[1] * dist, flat[2] + offset[2] * dist];
                        let tuv = uv(flat);
                        let luv = if lm[0][0] < 0.0 { [-1.0, -1.0] } else { [lm_left[0] + (lm_right[0] - lm_left[0]) * tx, lm_left[1] + (lm_right[1] - lm_left[1]) * tx] };
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
                for (j, (p, tuv, luv, alpha)) in grid.into_iter().enumerate() {
                    let nn = normalize(normals[j]);
                    let nn = if flip { [-nn[0], -nn[1], -nn[2]] } else { nn };
                    mesh.positions.extend_from_slice(&p);
                    mesh.normals.extend_from_slice(&nn);
                    mesh.uvs.extend_from_slice(&tuv);
                    mesh.lightmap_uvs.extend_from_slice(&luv);
                    mesh.blend.push(alpha);
                    grow(&mut bounds, p);
                }
            } else {
                for &p in &corners {
                    let at = place(p);
                    mesh.positions.extend_from_slice(&at);
                    mesh.normals.extend_from_slice(&normal);
                    mesh.uvs.extend_from_slice(&uv(p));
                    mesh.lightmap_uvs.extend_from_slice(&lightmap_uv(i, f, t, p));
                    mesh.blend.push(0.0);
                    grow(&mut bounds, at);
                }
                // a convex polygon, wound clockwise seen from its front (the game's way): a fan, turned to counter-clockwise
                for k in 1..corners.len() as u32 - 1 {
                    mesh.indices.extend_from_slice(&[base, base + k + 1, base + k]);
                }
            }
        }
    }
    let mut meshes: Vec<MapMesh> = by_material.into_values().filter(|m| !m.indices.is_empty()).collect();
    meshes.sort_by(|a, b| a.material.cmp(&b.material));
    if bounds[0] > bounds[3] {
        bounds = [0.0; 6];
    }
    Ok(Map { meshes, props, spawns, lightmap_width: width, lightmap_height: height, lightmap, sky, bounds })
}

fn grow(b: &mut [f32; 6], p: [f32; 3]) {
    for i in 0..3 {
        b[i] = b[i].min(p[i]);
        b[i + 3] = b[i + 3].max(p[i]);
    }
}

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
                        Some(k) => { e.entry(k.to_ascii_lowercase()).or_insert(s); }
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
            out.push(MapProp { model: model.clone(), origin: vec3(p, 0), angles: vec3(p, 12), skin: i32_at(p, 32).unwrap_or(0), scale });
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
    /// `base` and, for a blend (WorldVertexTransition), `base2`.
    pub textures: Vec<(String, crate::vtf::Image)>,
}

/// The parameters of a map material the viewer reads.
const MAP_MATERIAL_PARAMS: &[&str] = &[
    "$translucent", "$alphatest", "$alphatestreference", "$additive", "$nocull", "$color", "$color2", "$fogcolor", "$basetexturetransform",
    "$basetexturetransform2", "$selfillum", "$alpha", "$vertexalpha", "$blendmodulatetexture", "$surfaceprop",
];

pub fn map_material(vpk: &crate::VpkSet, name: &str, max_size: u32) -> std::result::Result<MapMaterial, String> {
    let path = format!("materials/{}.vmt", name.trim_start_matches('/').trim_end_matches(".vmt"));
    let vmt = crate::vmt::load(vpk, &path).map_err(|e| e.to_string())?;
    let mut textures = Vec::new();
    for (slot, keys) in [("base", &["$basetexture"][..]), ("base2", &["$basetexture2"][..])] {
        let Some(tex) = keys.iter().find_map(|k| vmt.get(k)) else { continue };
        let tex = tex.replace('\\', "/").to_ascii_lowercase();
        let vtf = format!("materials/{}.vtf", tex.trim_start_matches('/').trim_end_matches(".vtf"));
        let Ok(bytes) = vpk.read(&vtf) else { continue };
        let Ok(info) = crate::vtf::info(&bytes) else { continue };
        let mut mip = 0;
        while (info.width.max(info.height) >> mip) > max_size && mip + 1 < info.mip_count {
            mip += 1;
        }
        if let Ok(img) = crate::vtf::decode(&bytes, mip) {
            textures.push((slot.to_string(), img));
        }
    }
    let params = MAP_MATERIAL_PARAMS.iter().filter_map(|k| vmt.get(k).map(|v| (k.to_string(), v.to_string()))).collect();
    Ok(MapMaterial { shader: vmt.shader.clone(), params, textures })
}
