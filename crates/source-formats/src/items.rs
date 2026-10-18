//! Cosmetics database from `scripts/items/items_game.txt` (+ English names from
//! `resource/tf_english.txt`). Items inherit from prefabs, so each item is resolved by merging its
//! prefab chain (later prefabs override earlier ones, the item's own keys override all).

use std::collections::{BTreeMap, HashMap};

use crate::{
    binary::{fail, ParseError, Result},
    kv::{self, Node, Value},
    vpk::VpkSet,
};

/// One entry of an item's `visuals/styles` block: a variant that can swap the model, the team skin, the
/// inventory icon and the hidden class bodygroups.
#[derive(Debug, Clone, Default)]
pub struct ItemStyle {
    /// Localized style name, or empty when the install has no text for it.
    pub name: String,
    /// Replaces the item's model for every class unless `per_class` has an entry.
    pub model: Option<String>,
    pub per_class: BTreeMap<String, String>,
    /// Skin family used for RED / BLU (`skin_red` / `skin_blu`, or the single `skin`).
    pub skin_red: Option<i32>,
    pub skin_blu: Option<i32>,
    pub image: Option<String>,
    /// `additional_hidden_bodygroups` of the style, on top of the item's own.
    pub bodygroups: BTreeMap<String, i32>,
}

/// A particle effect an item always shows: the `attach particle effect` (`static`) attribute, an id in the game's table of attached
/// particles, or a `visuals/attached_particlesystems` entry, a system by name at an attachment of the item's model.
#[derive(Debug, Clone, PartialEq)]
pub struct ItemParticle {
    pub effect: Option<u32>,
    pub system: Option<String>,
    pub attachment: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Item {
    /// Stock loadout item (`baseitem`), including its retained upgradeable equivalent.
    pub base_item: bool,
    pub id: u32,
    /// Internal name, e.g. `Fancy Fedora`.
    pub name: String,
    /// Localized name when available, else `name`.
    pub display_name: String,
    pub item_class: String,
    /// `head` or `misc` for cosmetics.
    pub slot: String,
    /// Lowercase class names as used by the game (`demoman`, not `demo`). Empty = unrestricted.
    pub classes: Vec<String>,
    /// `used_by_classes` entries that name a slot instead of `1` (e.g. the Engineer's shotgun is `primary`): class -> slot.
    pub class_slots: BTreeMap<String, String>,
    /// Model used by every class unless `per_class` has an entry.
    pub model: Option<String>,
    pub per_class: BTreeMap<String, String>,
    pub image: Option<String>,
    /// `visuals/player_bodygroups` and `additional_hidden_bodygroups`: class bodygroup -> model index
    /// (1 hides the class's own geometry, e.g. the Soldier's helmet).
    pub bodygroups: BTreeMap<String, i32>,
    pub equip_regions: Vec<String>,
    pub paintable: bool,
    /// The item has the `player_skin_override` attribute (the Voodoo-Cursed souls): its wearer is drawn in the zombie skin of the
    /// class model, a skin family the model has for exactly this.
    pub skin_override: bool,
    /// The particle effects the item always shows (a pipe's smoke, the Earbuds' notes).
    pub particles: Vec<ItemParticle>,
    /// `anim_slot`: which animation set the item uses (`PRIMARY`, `MELEE_ALLCLASS`, ...), uppercase. Empty when unset.
    pub anim_slot: String,
    /// `visuals/player_poseparam`: pose parameters the item sets on the player while it is held (lowercase name -> value in
    /// the parameter's own units, e.g. `r_hand_grip` 16).
    pub pose_params: BTreeMap<String, f32>,
    /// Extra models shown with the item: its `extra_wearable` (a backpack, e.g. the Buff Banner's) and the
    /// `visuals/attached_models` (e.g. the Degreaser's pilot light). Festivizer models are not included.
    pub extra_models: Vec<String>,
    /// Selectable styles in game order (empty for items without any).
    pub styles: Vec<ItemStyle>,
    /// `item_quality` of the definition, lowercase (`unique`, `vintage`, `selfmade`, ...); `unique` when unset.
    pub quality: String,
    /// `item_type_name` token (e.g. `#TF_Wearable_CommunityMedal`), lowercased without the `#`.
    pub type_token: String,
    /// `prefab` names the item was declared with (lowercased), before resolution.
    pub prefabs: Vec<String>,
    /// Taunts only: class -> the player's intro scene file name without folder or extension (`taunt_brutalLegend`), which is
    /// also the name of the sequence the scene plays.
    pub taunt_scenes: BTreeMap<String, String>,
    /// Taunts only: class -> the prop's own scene file name (the prop plays a sequence of that name on its model).
    pub taunt_prop_scenes: BTreeMap<String, String>,
    /// Taunts only: class -> the player's scene path (`scenes/player/heavy/low/taunt_x.vcd`, lower case, forward slashes): its face.
    pub taunt_scene_paths: BTreeMap<String, String>,
    /// A cosmetic from the workshop importer's zips (`tf/workshop/import_source`), not from the game's own schema.
    pub workshop: bool,
}

impl Item {
    /// Medals and badges (tournament, community update, ...): items worn in the `medal` equip region.
    /// There are thousands of them, so browsers usually hide them.
    pub fn is_medal(&self) -> bool {
        self.equip_regions.iter().any(|r| r == "medal")
    }

    /// Model for the given class (`soldier`, `demoman`, ...).
    pub fn model_for(&self, class: &str) -> Option<&str> {
        self.per_class.get(class).map(String::as_str).or(self.model.as_deref())
    }

    /// The loadout slot of the item for a class: a per-class override, else the item's own slot.
    pub fn slot_for(&self, class: &str) -> &str {
        self.class_slots.get(class).map(String::as_str).unwrap_or(&self.slot)
    }

    pub fn usable_by(&self, class: &str) -> bool {
        if self.classes.is_empty() {
            return self.model.is_some() || self.per_class.contains_key(class);
        }
        self.classes.iter().any(|c| c == class) && (self.model_for(class).is_some() || (self.base_item && self.item_class == "tf_weapon_fists"))
    }
}

/// A paint can: the packed RGB written by the `set item tint RGB` attribute (0xRRGGBB).
#[derive(Debug, Clone)]
pub struct Paint {
    pub id: u32,
    pub name: String,
    pub display_name: String,
    /// Colour for RED (and the only colour of ordinary paints).
    pub rgb: u32,
    /// Colour for BLU, set by team-colour paints (`set item tint RGB 2`).
    pub rgb2: Option<u32>,
}

#[derive(Debug, Default)]
pub struct ItemDb {
    pub items: Vec<Item>,
    /// Weapons that are held in the hand (primary / secondary / melee) with a `models/weapons/c_models` model.
    pub weapons: Vec<Item>,
    /// Taunts that come with a prop model. The prop is the item's per-class `model`, so they behave like held items.
    pub taunts: Vec<Item>,
    pub paints: Vec<Paint>,
    /// Equip region -> regions it conflicts with (both directions are looked up by consumers).
    pub equip_conflicts: BTreeMap<String, Vec<String>>,
}

fn find<'a>(nodes: &'a [Node], key: &str) -> Option<&'a Node> {
    kv::find(nodes, key)
}

fn get_str<'a>(nodes: &'a [Node], key: &str) -> Option<&'a str> {
    find(nodes, key).and_then(Node::as_str)
}

fn get_block<'a>(nodes: &'a [Node], key: &str) -> Option<&'a [Node]> {
    find(nodes, key).and_then(Node::block)
}

/// Deep-merges `src` into `dst`: blocks merge recursively, scalars replace.
fn merge(dst: &mut Vec<Node>, src: &[Node]) {
    for n in src {
        match dst.iter_mut().find(|d| d.key.eq_ignore_ascii_case(&n.key)) {
            Some(existing) => match (&mut existing.value, &n.value) {
                (Value::Block(d), Value::Block(s)) => merge(d, s),
                _ => existing.value = n.value.clone(),
            },
            None => dst.push(n.clone()),
        }
    }
}

/// Resolves `own` against its `prefab` list. `depth` guards against cyclic prefabs.
fn resolve(own: &[Node], prefabs: &HashMap<String, Vec<Node>>, depth: u32) -> Vec<Node> {
    let mut out = Vec::new();
    if depth < 8 {
        if let Some(list) = get_str(own, "prefab") {
            for name in list.split_whitespace() {
                if let Some(p) = prefabs.get(&name.to_ascii_lowercase()) {
                    let resolved = resolve(p, prefabs, depth + 1);
                    merge(&mut out, &resolved);
                }
            }
        }
    }
    let own_without_prefab: Vec<Node> = own.iter().filter(|n| !n.key.eq_ignore_ascii_case("prefab")).cloned().collect();
    merge(&mut out, &own_without_prefab);
    out
}

/// Resolved weapon schema, including prefab attributes and visual overrides.
pub fn definition(text: &str, id: u32) -> Result<Vec<Node>> {
    let nodes = kv::parse(text)?;
    let root = get_block(&nodes, "items_game").ok_or_else(|| ParseError("Missing items_game".into()))?;
    let prefabs = get_block(root, "prefabs").unwrap_or(&[]).iter()
        .filter_map(|n| Some((n.key.to_ascii_lowercase(), n.block()?.to_vec()))).collect();
    let own = get_block(root, "items").and_then(|b| get_block(b, &id.to_string()))
        .ok_or_else(|| ParseError(format!("Missing weapon #{id}")))?;
    Ok(resolve(own, &prefabs, 0))
}

fn string_keys(block: Option<&[Node]>) -> Vec<String> {
    block.map(|b| b.iter().map(|n| n.key.to_ascii_lowercase()).collect()).unwrap_or_default()
}

/// Models that accompany an item: `extra_wearable` and the entries of `visuals/attached_models`.
fn extra_models(nodes: &[Node]) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(m) = get_str(nodes, "extra_wearable").filter(|m| !m.is_empty()) {
        out.push(m.replace('\\', "/"));
    }
    if let Some(block) = get_block(nodes, "visuals").and_then(|v| get_block(v, "attached_models")) {
        for n in block {
            if let Some(m) = n.block().and_then(|b| get_str(b, "model")).filter(|m| !m.is_empty()) {
                out.push(m.replace('\\', "/"));
            }
        }
    }
    out
}

/// `basename` is a pattern for the per-class models: every `%s` becomes the class's model name.
fn expand_basename(per_class: &mut BTreeMap<String, String>) {
    if let Some(pattern) = per_class.remove("basename") {
        for (class, model_name) in [
            ("scout", "scout"),
            ("soldier", "soldier"),
            ("pyro", "pyro"),
            ("demoman", "demo"),
            ("heavy", "heavy"),
            ("engineer", "engineer"),
            ("medic", "medic"),
            ("sniper", "sniper"),
            ("spy", "spy"),
        ] {
            per_class.entry(class.to_string()).or_insert_with(|| pattern.replace("%s", model_name));
        }
    }
}

/// Reads `visuals/styles` (blocks keyed 0, 1, 2, ...), skipping styles marked `selectable 0`.
fn parse_styles(nodes: &[Node], names: &HashMap<String, String>) -> Vec<ItemStyle> {
    let Some(block) = get_block(nodes, "visuals").and_then(|v| get_block(v, "styles")) else { return Vec::new() };
    let mut entries: Vec<(u32, &[Node])> = block.iter().filter_map(|n| Some((n.key.parse().ok()?, n.block()?))).collect();
    entries.sort_by_key(|(i, _)| *i);
    entries
        .into_iter()
        .filter(|(_, s)| get_str(s, "selectable").map_or(true, |v| v.trim() != "0"))
        .map(|(_, s)| {
            let mut per_class = BTreeMap::new();
            if let Some(b) = get_block(s, "model_player_per_class") {
                for n in b {
                    if let Some(p) = n.as_str() {
                        per_class.insert(n.key.to_ascii_lowercase(), p.replace('\\', "/"));
                    }
                }
            }
            expand_basename(&mut per_class);
            let int = |k: &str| get_str(s, k).and_then(|v| v.trim().parse::<i32>().ok());
            let single = int("skin");
            let mut bodygroups = BTreeMap::new();
            if let Some(b) = get_block(s, "additional_hidden_bodygroups") {
                for n in b {
                    if let Some(v) = n.as_str().and_then(|v| v.trim().parse::<i32>().ok()) {
                        bodygroups.insert(n.key.to_ascii_lowercase(), v);
                    }
                }
            }
            ItemStyle {
                // a localization token of the game's (`#TF_..._Style0`), or, in the workshop schema file, the name itself
                name: get_str(s, "name")
                    .map(|t| names.get(&t.trim_start_matches('#').to_ascii_lowercase()).cloned().unwrap_or_else(|| if t.starts_with('#') { String::new() } else { t.trim().to_string() }))
                    .unwrap_or_default(),
                model: get_str(s, "model_player").filter(|m| !m.is_empty()).map(|m| m.replace('\\', "/")),
                per_class,
                skin_red: int("skin_red").or(single),
                skin_blu: int("skin_blu").or(single),
                image: get_str(s, "image_inventory").map(str::to_string),
                bodygroups,
            }
        })
        .collect()
}

/// `class -> value` of a block like `custom_taunt_prop_per_class`, values mapped by `f`.
fn class_map(block: Option<&[Node]>, f: impl Fn(&str) -> String) -> BTreeMap<String, String> {
    block
        .map(|b| b.iter().filter_map(|n| Some((n.key.to_ascii_lowercase(), f(n.as_str()?.trim())))).filter(|(_, v)| !v.is_empty()).collect())
        .unwrap_or_default()
}

/// A scene path (`scenes/player/sniper/low/taunt_x.vcd`) reduced to its file name without extension.
fn scene_name(path: &str) -> String {
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    file.strip_suffix(".vcd").unwrap_or(file).to_string()
}

/// A taunt: its per-class scenes (the animations) and, when it has one, its prop: `taunt/custom_taunt_prop_per_class` models become the
/// item's per-class models. Taunts without a prop (most of them) are only an animation, usable by the classes the scenes name.
fn taunt_item(item: &mut Item, nodes: &[Node]) -> bool {
    let Some(taunt) = get_block(nodes, "taunt") else { return false };
    let props = class_map(get_block(taunt, "custom_taunt_prop_per_class"), |p| p.replace('\\', "/"));
    let scenes = class_map(get_block(taunt, "custom_taunt_scene_per_class"), scene_name);
    if props.is_empty() && scenes.is_empty() {
        return false;
    }
    item.taunt_scenes = scenes;
    item.taunt_scene_paths = class_map(get_block(taunt, "custom_taunt_scene_per_class"), |p| p.replace('\\', "/").to_ascii_lowercase());
    item.taunt_prop_scenes = class_map(get_block(taunt, "custom_taunt_prop_scene_per_class"), scene_name);
    if item.classes.is_empty() {
        item.classes = item.taunt_scenes.keys().chain(props.keys()).cloned().collect();
        item.classes.sort();
        item.classes.dedup();
    }
    if !props.is_empty() {
        item.per_class = props;
        item.model = None;
    }
    true
}

fn build_item(id: u32, nodes: &[Node], names: &HashMap<String, String>) -> Item {
    let name = get_str(nodes, "name").unwrap_or("").to_string();
    let display_name = get_str(nodes, "item_name")
        .and_then(|t| names.get(&t.trim_start_matches('#').to_ascii_lowercase()))
        .cloned()
        .unwrap_or_else(|| name.clone());

    let mut per_class = BTreeMap::new();
    if let Some(b) = get_block(nodes, "model_player_per_class") {
        for n in b {
            if let Some(p) = n.as_str() {
                per_class.insert(n.key.to_ascii_lowercase(), p.replace('\\', "/"));
            }
        }
    }

    expand_basename(&mut per_class);

    let mut bodygroups = BTreeMap::new();
    if let Some(visuals) = get_block(nodes, "visuals") {
        for section in ["player_bodygroups", "additional_hidden_bodygroups"] {
            if let Some(b) = get_block(visuals, section) {
                for n in b {
                    if let Some(v) = n.as_str().and_then(|v| v.trim().parse::<i32>().ok()) {
                        bodygroups.insert(n.key.to_ascii_lowercase(), v);
                    }
                }
            }
        }
    }

    let mut equip_regions = Vec::new();
    if let Some(r) = get_str(nodes, "equip_region") {
        equip_regions.push(r.to_ascii_lowercase());
    }
    equip_regions.extend(string_keys(get_block(nodes, "equip_regions")));

    Item {
        id,
        name,
        display_name,
        item_class: get_str(nodes, "item_class").unwrap_or("").to_string(),
        slot: get_str(nodes, "item_slot").unwrap_or("").to_string(),
        classes: string_keys(get_block(nodes, "used_by_classes")),
        class_slots: get_block(nodes, "used_by_classes")
            .map(|b| b.iter().filter_map(|n| n.as_str().map(|v| (n.key.to_ascii_lowercase(), v.trim().to_ascii_lowercase()))).filter(|(_, v)| !v.is_empty() && v != "1").collect())
            .unwrap_or_default(),
        model: get_str(nodes, "model_player").filter(|m| !m.is_empty()).map(|m| m.replace('\\', "/")),
        per_class,
        image: get_str(nodes, "image_inventory").map(str::to_string),
        bodygroups,
        equip_regions,
        type_token: get_str(nodes, "item_type_name").unwrap_or("").trim_start_matches('#').to_ascii_lowercase(),
        prefabs: Vec::new(),
        taunt_scenes: BTreeMap::new(),
        taunt_prop_scenes: BTreeMap::new(),
        taunt_scene_paths: BTreeMap::new(),
        workshop: false,
        extra_models: extra_models(nodes),
        pose_params: get_block(nodes, "visuals")
            .and_then(|v| get_block(v, "player_poseparam"))
            .map(|b| b.iter().filter_map(|n| Some((n.key.to_ascii_lowercase(), n.as_str()?.trim().parse::<f32>().ok()?))).collect())
            .unwrap_or_default(),
        anim_slot: get_str(nodes, "anim_slot").map(|s| s.trim().to_ascii_uppercase()).unwrap_or_default(),
        base_item: get_str(nodes, "baseitem").is_some_and(|s| s.trim() == "1"),
        styles: parse_styles(nodes, names),
        quality: get_str(nodes, "item_quality").map(str::to_ascii_lowercase).unwrap_or_else(|| "unique".to_string()),
        skin_override: has_attribute_class(nodes, "player_skin_override"),
        particles: item_particles(nodes),
        paintable: get_block(nodes, "capabilities").and_then(|c| get_str(c, "paintable")).is_some_and(|v| v.trim() != "0"),
    }
}

/// The particle effects an item always shows (see [`ItemParticle`]).
fn item_particles(nodes: &[Node]) -> Vec<ItemParticle> {
    let mut out = Vec::new();
    for attribute in ["attach particle effect static", "attach particle effect"] {
        if let Some(id) = attribute_number(nodes, attribute).map(|v| v as u32).filter(|v| *v > 0) {
            out.push(ItemParticle { effect: Some(id), system: None, attachment: None });
        }
    }
    if let Some(systems) = get_block(nodes, "visuals").and_then(|v| get_block(v, "attached_particlesystems")) {
        for n in systems {
            let Some(b) = n.block() else { continue };
            let Some(system) = get_str(b, "system").map(|s| s.trim()).filter(|s| !s.is_empty()) else { continue };
            out.push(ItemParticle { effect: None, system: Some(system.to_string()), attachment: get_str(b, "attachment").map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) });
        }
    }
    out
}

/// Whether an item's `attributes` / `static_attrs` block has an attribute of this class that is not zero.
fn has_attribute_class(nodes: &[Node], class: &str) -> bool {
    ["attributes", "static_attrs"].iter().filter_map(|block| get_block(nodes, block)).flatten().any(|n| match &n.value {
        Value::Block(b) => get_str(b, "attribute_class").is_some_and(|c| c.eq_ignore_ascii_case(class)) && get_str(b, "value").map_or(true, |v| v.trim() != "0"),
        Value::Str(_) => false,
    })
}

/// Reads a numeric attribute from an item's `attributes` / `static_attrs` block (written as a value, or a block with a `value`).
fn attribute_number(nodes: &[Node], attribute: &str) -> Option<f64> {
    for block in ["attributes", "static_attrs"] {
        let Some(node) = get_block(nodes, block).and_then(|b| find(b, attribute)) else { continue };
        let text = match &node.value {
            Value::Str(v) => Some(v.as_str()),
            Value::Block(b) => get_str(b, "value"),
        };
        if let Some(v) = text.and_then(|t| t.trim().parse::<f64>().ok()) {
            return Some(v);
        }
    }
    None
}

/// Reads the packed RGB of a tint attribute from an item's `attributes` / `static_attrs` block.
fn tint_value(nodes: &[Node], attribute: &str) -> Option<u32> {
    attribute_number(nodes, attribute).map(|v| v as u32 & 0x00ff_ffff)
}

fn build_paint(id: u32, nodes: &[Node], names: &HashMap<String, String>) -> Option<Paint> {
    let is_paint_can = get_block(nodes, "tool").and_then(|t| get_str(t, "type")).is_some_and(|t| t == "paint_can");
    if !is_paint_can {
        return None;
    }
    let rgb = tint_value(nodes, "set item tint RGB")?;
    let name = get_str(nodes, "name").unwrap_or("").to_string();
    let display_name = get_str(nodes, "item_name")
        .and_then(|t| names.get(&t.trim_start_matches('#').to_ascii_lowercase()))
        .cloned()
        .unwrap_or_else(|| name.clone());
    Some(Paint { id, name, display_name, rgb, rgb2: tint_value(nodes, "set item tint RGB 2") })
}

/// Decodes a Source text resource: UTF-16LE with BOM (the localization files) or UTF-8.
pub fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)).into_owned()
    }
}

/// Localization tokens (lowercased keys) from `resource/tf_english.txt`.
pub fn load_english(vpk: &VpkSet) -> HashMap<String, String> {
    let Ok(bytes) = vpk.read("resource/tf_english.txt") else { return HashMap::new() };
    let Ok(nodes) = kv::parse(&decode_text(&bytes)) else { return HashMap::new() };
    let tokens = nodes
        .iter()
        .find(|n| n.key.eq_ignore_ascii_case("lang"))
        .and_then(Node::block)
        .and_then(|b| get_block(b, "Tokens"));
    tokens
        .map(|t| t.iter().filter_map(|n| n.as_str().map(|v| (n.key.to_ascii_lowercase(), v.to_string()))).collect())
        .unwrap_or_default()
}

/// Things the viewer can put in a hand: primary / secondary / melee items (not wearables) whose model is a
/// `models/weapons/c_models` one (the bonemerged third-person models), and the utility items (PDAs, sappers, the
/// toolbox, the disguise kit: slots `pda`, `pda2` and `building`), whose third-person model may also be a
/// `w_models` one. Both kinds have a `weapon_bone` root; viewmodel-only items (`v_models`) are skipped.
fn is_held_weapon(item: &Item) -> bool {
    // Stock fists use the Heavy's own hands, without a separate world model.
    if item.base_item && item.item_class == "tf_weapon_fists" { return true; }
    if item.item_class.starts_with("tf_wearable") {
        return false;
    }
    let has = |needle: &str| item.model.iter().chain(item.per_class.values()).any(|m| m.to_ascii_lowercase().contains(needle));
    match item.slot.as_str() {
        "primary" | "secondary" | "melee" => has("weapons/c_models/"),
        "pda" | "pda2" | "building" => has("weapons/c_models/") || has("weapons/w_models/"),
        _ => false,
    }
}

/// Removes the duplicate entries from the weapon list. The schema carries a stock "template" entry for every basic weapon
/// (`TF_WEAPON_BAT`, quality `normal`) next to the real one (`Upgradeable TF_WEAPON_BAT`), and the weapon-skin entries
/// (`pyroland_knife_bluemew`, quality `normal`) reuse the base model. A `normal` entry is dropped when a non-`normal`
/// one has the same model and covers every class (in the same slot) it is for. Paint-kit skin entries go too when a
/// non-skin entry has the same model and icon. Entries with no such twin, like the
/// Spy's disguise kit or the Engineer's destruction PDA, stay.
fn drop_duplicate_weapons(weapons: &mut Vec<Item>) {
    let covered = |w: &Item, v: &Item| {
        v.id != w.id
            && v.quality != "normal"
            && v.model == w.model
            && v.per_class == w.per_class
            && w.classes.iter().all(|c| v.classes.is_empty() || v.classes.contains(c))
            && w.classes.iter().all(|c| v.slot_for(c) == w.slot_for(c))
    };
    // Paint-kit weapon skins (`paintkit_weapon_*` prefabs, ids 15000+, quality unique) reuse the base weapon's model AND its
    // inventory icon, and only differ by a texture that is applied at run time, so here they are copies of the real weapon.
    let is_skin = |w: &Item| w.prefabs.iter().any(|p| p.starts_with("paintkit_weapon"));
    let skin_copy = |w: &Item, v: &Item| {
        is_skin(w)
            && !is_skin(v)
            && v.id != w.id
            && v.model == w.model
            && v.per_class == w.per_class
            && v.image == w.image
            && v.slot == w.slot
            && w.classes.iter().all(|c| v.classes.is_empty() || v.classes.contains(c))
    };
    // Stock schema entries are often removed in favour of upgradeable copies. Keep their
    // default-loadout designation on the surviving equivalent for Play mode slot selection.
    let stock: Vec<Item> = weapons.iter().filter(|w| w.base_item).cloned().collect();
    for weapon in weapons.iter_mut() {
        // Other unlocks can share the stock model (Kritzkrieg, Golden Wrench). Only the
        // schema's explicitly named upgradeable stock definitions inherit this marker.
        if weapon.name.starts_with("Upgradeable ") && stock.iter().any(|base| covered(base, weapon)) { weapon.base_item = true; }
    }
    let drop: Vec<bool> = weapons
        .iter()
        .map(|w| (w.quality == "normal" && weapons.iter().any(|v| covered(w, v))) || weapons.iter().any(|v| skin_copy(w, v)))
        .collect();
    let mut i = 0;
    weapons.retain(|_| {
        i += 1;
        !drop[i - 1]
    });
}

/// A cosmetic from the importer's manifest (`ItemSchema` is written like an items_game entry, `ImportSession` has the classes it was made
/// for). It has no id of its own: a stable one comes from a hash of its import name (high bit set, so it never meets a game id).
fn workshop_item(zip_name: &str, manifest: &str, prefabs: &HashMap<String, Vec<Node>>, names: &HashMap<String, String>) -> Option<Item> {
    let root = kv::parse(manifest).ok()?;
    // the importer's own copy is `data { ImportSession }`, the one packed in the zip is `asset { ImportSession ... }`
    let session = root.iter().filter_map(Node::block).find_map(|b| get_block(b, "ImportSession"))?;
    let schema = get_block(session, "ItemSchema")?;
    let import = get_str(schema, "import_name").or_else(|| get_str(session, "name")).unwrap_or(zip_name).to_string();
    let resolved = resolve(schema, prefabs, 0);
    let mut item = build_item(0, &resolved, names);
    item.prefabs = get_str(schema, "prefab").map(|p| p.split_whitespace().map(str::to_ascii_lowercase).collect()).unwrap_or_default();
    let is_taunt = item.slot == "taunt" || item.prefabs.iter().any(|p| p == "taunt");
    if is_taunt {
        item.slot = "taunt".to_string();
        if !taunt_item(&mut item, &resolved) { return None; }
    } else if item.model.is_none() && item.per_class.is_empty() {
        return None;
    }
    if item.slot.is_empty() {
        item.slot = if item.prefabs.iter().any(|p| p == "hat") { "head" } else { "misc" }.to_string();
    }
    if item.item_class.is_empty() {
        item.item_class = "tf_wearable".to_string();
    }
    // the classes: the schema's own, else the ones the importer session was filled in for ("demo" is the game's "demoman")
    if item.classes.is_empty() {
        item.classes = string_keys(get_block(session, "classes")).into_iter().map(|c| if c == "demo" { "demoman".to_string() } else { c }).collect();
    }
    item.name = import.clone();
    // the schema's name token is a localization key the game does not have: the import name, tidied, is the title
    item.display_name = import
        .trim_start_matches("a_")
        .split(['_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    item.quality = "community".to_string();
    item.workshop = true;
    // FNV-1a of the import name
    let mut h: u32 = 0x811c9dc5;
    for b in import.to_ascii_lowercase().bytes() {
        h = (h ^ b as u32).wrapping_mul(0x01000193);
    }
    item.id = 0x8000_0000 | (h & 0x7fff_ffff);
    Some(item)
}

/// Lays a block of the workshop schema file over a workshop item: each part the block has (the regions, the styles, the particles,
/// the bodygroups, the classes, the models, the title, ...) takes the place of what the zip gave, written as items_game writes it.
fn overlay_item(item: &mut Item, own: &[Node], prefabs: &HashMap<String, Vec<Node>>, names: &HashMap<String, String>) {
    let resolved = resolve(own, prefabs, 0);
    let o = build_item(item.id, &resolved, names);
    let has = |key: &str| find(&resolved, key).is_some();
    let visuals = get_block(&resolved, "visuals");
    if let Some(t) = get_str(&resolved, "item_name") {
        // a localization token of the game's, or the title itself
        let key = t.trim_start_matches('#');
        item.display_name = names.get(&key.to_ascii_lowercase()).cloned().unwrap_or_else(|| key.to_string());
    }
    if has("item_slot") { item.slot = o.slot; }
    if has("used_by_classes") { item.classes = o.classes; item.class_slots = o.class_slots; }
    if has("model_player") { item.model = o.model; }
    if has("model_player_per_class") { item.per_class = o.per_class; }
    if has("equip_region") || has("equip_regions") { item.equip_regions = o.equip_regions; }
    if has("image_inventory") { item.image = o.image; }
    if get_block(&resolved, "capabilities").is_some_and(|c| get_str(c, "paintable").is_some()) { item.paintable = o.paintable; }
    if visuals.is_some_and(|v| get_block(v, "player_bodygroups").is_some() || get_block(v, "additional_hidden_bodygroups").is_some()) { item.bodygroups = o.bodygroups; }
    if visuals.is_some_and(|v| get_block(v, "styles").is_some()) { item.styles = o.styles; }
    if !o.particles.is_empty() { item.particles = o.particles; }
    if has("attributes") || has("static_attrs") { item.skin_override = o.skin_override; }
    if !o.extra_models.is_empty() { item.extra_models = o.extra_models; }
    if !o.pose_params.is_empty() { item.pose_params = o.pose_params; }
}

/// The item blocks of a workshop schema file, by import name: at the top, or under `items`, or under `items_game` / `items` as the
/// game's own file has them.
fn schema_blocks(nodes: &[Node]) -> Vec<(String, Vec<Node>)> {
    let mut out = Vec::new();
    for n in nodes {
        let Some(b) = n.block() else { continue };
        if n.key.eq_ignore_ascii_case("items") || n.key.eq_ignore_ascii_case("items_game") { out.extend(schema_blocks(b)); }
        else if !n.key.eq_ignore_ascii_case("prefabs") { out.push((n.key.to_ascii_lowercase(), b.to_vec())); }
    }
    out
}

/// Parses `items_game.txt` text. Only wearable cosmetics (head/misc slot with a player model) are kept.
pub fn parse(text: &str, names: &HashMap<String, String>) -> Result<ItemDb> {
    parse_with(text, names, &[])
}

/// [`parse`], plus the cosmetics of workshop import manifests (`(zip name, manifest text)`).
pub fn parse_with(text: &str, names: &HashMap<String, String>, workshop: &[(String, String)]) -> Result<ItemDb> {
    parse_with_schema(text, names, workshop, None)
}

/// [`parse_with`], plus the workshop schema file (`items_game.txt` beside the zips): what the zips cannot say about their items, in
/// items_game's own words, laid over them by import name (see [`overlay_item`]). Its own `prefabs` block adds to the game's.
pub fn parse_with_schema(text: &str, names: &HashMap<String, String>, workshop: &[(String, String)], schema: Option<&str>) -> Result<ItemDb> {
    let root = kv::parse(text)?;
    let Some(game) = root.iter().find(|n| n.key.eq_ignore_ascii_case("items_game")).and_then(Node::block) else {
        return fail("items_game.txt has no items_game block");
    };

    let prefabs: HashMap<String, Vec<Node>> = get_block(game, "prefabs")
        .map(|b| b.iter().filter_map(|n| n.block().map(|v| (n.key.to_ascii_lowercase(), v.to_vec()))).collect())
        .unwrap_or_default();

    let mut items = Vec::new();
    let mut weapons = Vec::new();
    let mut taunts = Vec::new();
    let mut paints = Vec::new();
    if let Some(block) = get_block(game, "items") {
        for n in block {
            let (Ok(id), Some(own)) = (n.key.parse::<u32>(), n.block()) else { continue };
            let resolved = resolve(own, &prefabs, 0);
            if let Some(paint) = build_paint(id, &resolved, names) {
                paints.push(paint);
                continue;
            }
            let mut item = build_item(id, &resolved, names);
            item.prefabs = get_str(own, "prefab").map(|p| p.split_whitespace().map(str::to_ascii_lowercase).collect()).unwrap_or_default();
            let wearable = item.item_class.starts_with("tf_wearable") && !item.item_class.contains("_vm");
            // (the Demoman's shields are wearables of the secondary slot: they hang on the arm whatever is in the hand, so they are cosmetics)
            let cosmetic_slot = matches!(item.slot.as_str(), "head" | "misc") || item.item_class == "tf_wearable_demoshield";
            if wearable && cosmetic_slot && (item.model.is_some() || !item.per_class.is_empty()) {
                items.push(item);
            } else if is_held_weapon(&item) {
                weapons.push(item);
            } else if item.slot == "taunt" && taunt_item(&mut item, &resolved) {
                taunts.push(item);
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut from_zips: Vec<Item> = Vec::new();
    for (zip_name, manifest) in workshop {
        if let Some(item) = workshop_item(zip_name, manifest, &prefabs, names) {
            if seen.insert(item.id) { from_zips.push(item); }
        }
    }
    if let Some(schema) = schema.and_then(|t| kv::parse(t).ok()) {
        let mut prefabs = prefabs.clone();
        for n in &schema {
            if n.key.eq_ignore_ascii_case("prefabs") {
                if let Some(b) = n.block() { prefabs.extend(b.iter().filter_map(|p| p.block().map(|v| (p.key.to_ascii_lowercase(), v.to_vec())))); }
            }
        }
        for (name, block) in schema_blocks(&schema) {
            for item in from_zips.iter_mut().filter(|i| i.name.eq_ignore_ascii_case(&name)) {
                overlay_item(item, &block, &prefabs, names);
            }
        }
    }
    for item in from_zips {
        if item.slot == "taunt" { taunts.push(item); } else { items.push(item); }
    }

    drop_duplicate_weapons(&mut weapons);

    let mut equip_conflicts = BTreeMap::new();
    if let Some(block) = get_block(game, "equip_conflicts") {
        for n in block {
            if let Some(b) = n.block() {
                equip_conflicts.insert(n.key.to_ascii_lowercase(), b.iter().map(|c| c.key.to_ascii_lowercase()).collect());
            }
        }
    }
    Ok(ItemDb { items, weapons, taunts, paints, equip_conflicts })
}

/// Loads the cosmetics database from the TF2 install (loose files, falling back to VPK contents).
pub fn load(vpk: &VpkSet) -> Result<ItemDb> {
    let bytes = vpk.read("scripts/items/items_game.txt").map_err(|e| ParseError(e.to_string()))?;
    parse_with_schema(&decode_text(&bytes), &load_english(vpk), &vpk.workshop_manifests(), vpk.workshop_schema().as_deref())
}
