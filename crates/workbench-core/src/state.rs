use std::{
    collections::HashMap,
    sync::{Arc, Mutex, RwLock},
};

use source_formats::{anim::AnimSet, Model, VpkSet};

/// Shared app state. Parsed models and decoded materials stay cached so
/// switching is instant.
#[derive(Default)]
pub struct AppState {
    vpk: RwLock<Option<Arc<VpkSet>>>,
    models: Mutex<HashMap<String, Arc<Model>>>,
    /// Encoded material payloads (JSON + RGBA pixels), keyed by lowercased VMT path.
    materials: Mutex<HashMap<String, Arc<Vec<u8>>>>,
    /// Animation sets (model + $includemodel files), keyed by lowercased model path.
    anims: Mutex<HashMap<String, Arc<AnimSet>>>,
    /// Encoded cosmetics catalog (parsed once per indexed install).
    items: Mutex<Option<Arc<Vec<u8>>>>,
    particles: Mutex<Option<Arc<HashMap<String, String>>>>,
}

impl AppState {
    pub fn set_vpk(&self, vpk: VpkSet) {
        *self.vpk.write().unwrap() = Some(Arc::new(vpk));
        self.models.lock().unwrap().clear();
        self.materials.lock().unwrap().clear();
        self.anims.lock().unwrap().clear();
        *self.items.lock().unwrap() = None;
        *self.particles.lock().unwrap() = None;
    }

    /// Rescans the custom effect zips after one was added, replaced or removed, and forgets what was read from them.
    pub fn refresh_effects(&self) -> Result<(), String> {
        let vpk = self.vpk()?;
        vpk.rescan_workshop();
        self.materials.lock().unwrap().clear();
        *self.particles.lock().unwrap() = None;
        Ok(())
    }

    /// Rescans the workshop importer's zips and forgets what was cached from them (models, materials) and the cosmetics catalog.
    pub fn refresh_workshop(&self) -> Result<(), String> {
        let vpk = self.vpk()?;
        vpk.rescan_workshop();
        let is_workshop = |k: &String| k.contains("workshop");
        self.models.lock().unwrap().retain(|k, _| !is_workshop(k));
        self.materials.lock().unwrap().retain(|k, _| !is_workshop(k));
        self.anims.lock().unwrap().retain(|k, _| !is_workshop(k));
        *self.items.lock().unwrap() = None;
        Ok(())
    }

    pub fn vpk(&self) -> Result<Arc<VpkSet>, String> {
        self.vpk
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| "TF2 has not been indexed yet".to_string())
    }

    pub fn particle_files(&self) -> Result<Arc<HashMap<String,String>>,String> {
        let mut cache = self.particles.lock().map_err(|e| e.to_string())?;
        if let Some(files) = &*cache { return Ok(files.clone()); }
        let vpk = self.vpk()?; let mut files = HashMap::new();
        for path in vpk.search("particles/",usize::MAX).into_iter().filter(|p| p.ends_with(".pcf") && !p.contains("_dx80") && !p.contains("_high")) {
            if let Ok(bytes) = vpk.read(path) { if let Some(names) = crate::game::pcf_system_names(&bytes) {
                for name in names { files.insert(name,path.to_owned()); }
            }}
        }
        let files = Arc::new(files); *cache = Some(files.clone()); Ok(files)
    }

    /// Returns the cached model, parsing it on first use.
    pub fn model(&self, path: &str) -> Result<Arc<Model>, String> {
        self.model_lod(path, 0)
    }

    /// The model at a LOD (past its last, the last one); cached per LOD.
    pub fn model_lod(&self, path: &str, lod: usize) -> Result<Arc<Model>, String> {
        let name = path.to_ascii_lowercase();
        let key = if lod == 0 { name.clone() } else { format!("{name}#{lod}") };
        if let Some(m) = self.models.lock().unwrap().get(&key) {
            return Ok(m.clone());
        }
        let vpk = self.vpk()?;
        let model = Arc::new(source_formats::model::load_lod(&vpk, &name, lod).map_err(|e| e.to_string())?);
        self.models.lock().unwrap().insert(key, model.clone());
        Ok(model)
    }

    /// Returns the cached encoded material, decoding it on first use.
    pub fn material_payload(&self, path: &str) -> Result<Arc<Vec<u8>>, String> {
        let key = path.to_ascii_lowercase();
        if let Some(m) = self.materials.lock().unwrap().get(&key) {
            return Ok(m.clone());
        }
        let vpk = self.vpk()?;
        let mat = source_formats::material::load(&vpk, &key).map_err(|e| format!("{key}: {e}"))?;
        let bytes = Arc::new(crate::payload::encode_material(&mat));
        self.materials.lock().unwrap().insert(key, bytes.clone());
        Ok(bytes)
    }
}

impl AppState {
    /// Returns the cached animation set for a model, loading it on first use.
    pub fn anim_set(&self, path: &str) -> Result<Arc<AnimSet>, String> {
        let key = path.to_ascii_lowercase();
        if let Some(a) = self.anims.lock().unwrap().get(&key) {
            return Ok(a.clone());
        }
        let vpk = self.vpk()?;
        let set = Arc::new(AnimSet::load(&vpk, &key).map_err(|e| format!("{key}: {e}"))?);
        self.anims.lock().unwrap().insert(key, set.clone());
        Ok(set)
    }
}

impl AppState {
    /// Returns the encoded cosmetics catalog, parsing `items_game.txt` on first use.
    pub fn items_payload(&self) -> Result<Arc<Vec<u8>>, String> {
        if let Some(p) = self.items.lock().unwrap().as_ref() {
            return Ok(p.clone());
        }
        let vpk = self.vpk()?;
        let db = source_formats::items::load(&vpk).map_err(|e| format!("items_game.txt: {e}"))?;
        let bytes = Arc::new(crate::payload::encode_items(&db));
        *self.items.lock().unwrap() = Some(bytes.clone());
        Ok(bytes)
    }
}
