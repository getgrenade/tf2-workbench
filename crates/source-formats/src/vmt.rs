//! Valve Material (`.vmt`) loader. Flattens the top-level parameters of a
//! material, resolving `patch` materials (`include` + `insert`/`replace`).

use std::collections::HashMap;

use crate::{
    binary::{fail, Result},
    kv::{self, Node, Value},
    vpk::VpkSet,
};

/// One entry of a VMT `Proxies` block, e.g. `ItemTintColor { resultVar "$colortint_tmp" }`.
#[derive(Debug, Clone, Default)]
pub struct Proxy {
    /// Proxy name, lowercased (`itemtintcolor`).
    pub name: String,
    /// Its parameters with lowercased keys (`resultvar`, `srcvar1`, ...).
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Default)]
pub struct Vmt {
    /// Shader name, lowercased (e.g. `vertexlitgeneric`).
    pub shader: String,
    /// Parameters with lowercased keys (e.g. `$basetexture`).
    pub params: HashMap<String, String>,
    /// Material proxies in file order. They are evaluated by the renderer (the engine runs them every frame).
    pub proxies: Vec<Proxy>,
}

impl Vmt {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.params.get(&key.to_ascii_lowercase()).map(String::as_str)
    }

    pub fn flag(&self, key: &str) -> bool {
        self.get(key).is_some_and(|v| v.trim().parse::<f32>().map_or(false, |n| n != 0.0))
    }

    /// The main color texture. Eye materials use `$iris` instead of `$basetexture`.
    pub fn base_texture(&self) -> Option<&str> {
        ["$basetexture", "$iris", "$diffuse", "$texture1"].iter().find_map(|k| self.get(k))
    }
}

pub fn parse(text: &str) -> Result<(String, Vec<Node>)> {
    let nodes = kv::parse(text)?;
    let Some(root) = nodes.into_iter().next() else {
        return fail("empty VMT");
    };
    match root.value {
        Value::Block(b) => Ok((root.key.to_ascii_lowercase(), b)),
        Value::Str(_) => fail("VMT root is not a block"),
    }
}

fn parse_proxies(nodes: &[Node]) -> Vec<Proxy> {
    let Some(block) = kv::find(nodes, "proxies").and_then(Node::block) else { return Vec::new() };
    block
        .iter()
        .filter_map(|n| {
            let b = n.block()?;
            let params = b
                .iter()
                .filter_map(|p| p.as_str().map(|v| (p.key.to_ascii_lowercase(), v.to_string())))
                .collect();
            Some(Proxy { name: n.key.to_ascii_lowercase(), params })
        })
        .collect()
}

/// The DX level hlmv / TF2 run at (`mat_dxlevel 95`): conditional blocks such as `">=DX90" { ... }` are compared with it.
const DX_LEVEL: i32 = 95;

/// Evaluates a conditional block name like `>=DX90`, `<DX90`, `DX80` or `>DX81`. Returns None when the key is not a DX condition.
fn dx_condition(key: &str) -> Option<bool> {
    let k = key.trim().to_ascii_lowercase();
    let (op, rest) = if let Some(r) = k.strip_prefix(">=") {
        (">=", r)
    } else if let Some(r) = k.strip_prefix("<=") {
        ("<=", r)
    } else if let Some(r) = k.strip_prefix('>') {
        (">", r)
    } else if let Some(r) = k.strip_prefix('<') {
        ("<", r)
    } else {
        ("==", k.as_str())
    };
    let level: i32 = rest.strip_prefix("dx")?.parse().ok()?;
    Some(match op {
        ">=" => DX_LEVEL >= level,
        "<=" => DX_LEVEL <= level,
        ">" => DX_LEVEL > level,
        "<" => DX_LEVEL < level,
        _ => DX_LEVEL == level,
    })
}

fn apply(params: &mut HashMap<String, String>, nodes: &[Node]) {
    for n in nodes {
        if let Some(v) = n.as_str() {
            params.insert(n.key.to_ascii_lowercase(), v.to_string());
        } else if let (Some(block), Some(true)) = (n.block(), dx_condition(&n.key)) {
            // A satisfied conditional block overrides the parameters declared before it.
            apply(params, block);
        }
    }
}

/// Loads and flattens a material by its VPK path (e.g. `materials/models/.../x.vmt`).
pub fn load(vpk: &VpkSet, path: &str) -> Result<Vmt> {
    load_depth(vpk, path, 0)
}

fn load_depth(vpk: &VpkSet, path: &str, depth: u32) -> Result<Vmt> {
    let bytes = vpk.read(path).map_err(|e| crate::binary::ParseError(e.to_string()))?;
    let (shader, nodes) = parse(&String::from_utf8_lossy(&bytes))?;

    if shader != "patch" {
        let mut vmt = Vmt { shader, params: HashMap::new(), proxies: parse_proxies(&nodes) };
        apply(&mut vmt.params, &nodes);
        return Ok(vmt);
    }
    if depth > 4 {
        return fail("VMT patch chain too deep");
    }
    let Some(include) = kv::find(&nodes, "include").and_then(Node::as_str) else {
        return fail("patch VMT has no include");
    };
    let mut vmt = load_depth(vpk, &include.replace('\\', "/"), depth + 1)?;
    for section in ["insert", "replace"] {
        if let Some(block) = kv::find(&nodes, section).and_then(Node::block) {
            apply(&mut vmt.params, block);
        }
    }
    Ok(vmt)
}
