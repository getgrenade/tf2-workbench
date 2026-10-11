//! App settings, stored as JSON in the app's config folder. Some settings (see `Settings::browser_args`) are only
//! read when the window is created, so changing them takes effect after a restart.

use std::{collections::BTreeMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Turn off the web view's colour management so saturated colours reach the screen unconverted, like hlmv.exe (on by default).
    /// On wide-gamut displays this is what makes our reds and oranges match hlmv's; the UI gets more saturated too.
    pub match_hlmv_colors: bool,
    /// Picking a weapon switches the animation to the matching `stand_*` sequence (on by default).
    pub auto_weapon_animation: bool,
    /// Ease camera movement and navigation-axis transitions (on by default).
    pub camera_smoothing: bool,
    /// Leaving a camera's view puts the viewport back exactly where it was before (position, rotation, field of view) instead of
    /// keeping the camera's own place (off by default).
    pub restore_viewport_on_camera_exit: bool,
    pub play_hit_reactions: bool,
    /// Mouse-wheel zoom multiplier (1 preserves the original strength).
    pub scroll_strength: f32,
    /// Start with the scene of the last session (characters, loadouts, camera, lights) instead of a single Soldier (on by default).
    pub restore_last_scene: bool,
    /// Ask before closing a scene tab (on by default).
    pub confirm_close_scene: bool,
    /// Equipping a cosmetic leaves the ones in the same equip region on (off by default: the game's rule, the newer one replaces them).
    pub allow_overlapping_cosmetics: bool,
    /// The base tone of the interface and its highlight ("#rrggbb"); every colour of the interface is mixed from these two.
    pub ui_base: String,
    /// The size of the interface: 0 fits it to the screen (the layout is made for 1440p), otherwise a factor (0.5–2).
    pub ui_scale: f32,
    pub ui_accent: String,
    /// Interface colours of the 3D view: the wireframe overlay and the floor grid ("#rrggbb" display colours, opacities 0..1).
    pub wire_color: String,
    pub wire_opacity: f32,
    pub grid_color: String,
    pub grid_opacity: f32,
    /// The glow around a character or cosmetic that was clicked in the 3D view.
    pub flash_color: String,
    /// How strong the outline around what is selected is, 0..1 (the glow of a click is in proportion to it).
    pub selection_opacity: f32,
    /// Screenshots: size relative to the view (1, 2 or 4) and whether the background is left out.
    pub screenshot_scale: u32,
    pub screenshot_transparent: bool,
    /// Key and mouse bindings the user changed, by action id ("tool.move" -> "KeyW"); an action that is missing has its default,
    /// an empty string is no binding. The ids and the default bindings are in `src/hotkeys.ts`.
    pub hotkeys: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            match_hlmv_colors: true,
            auto_weapon_animation: true,
            camera_smoothing: true,
            restore_viewport_on_camera_exit: false,
            play_hit_reactions: true,
            scroll_strength: 1.0,
            restore_last_scene: true,
            confirm_close_scene: true,
            allow_overlapping_cosmetics: false,
            ui_base: "#222226".into(),
            ui_scale: 0.0,
            ui_accent: "#e08a3c".into(),
            wire_color: "#b7d2be".into(),
            wire_opacity: 0.1,
            grid_color: "#5fab60".into(),
            grid_opacity: 0.46,
            flash_color: "#4ef320".into(),
            selection_opacity: 0.85,
            screenshot_scale: 2,
            screenshot_transparent: true,
            hotkeys: BTreeMap::new(),
        }
    }
}

impl Settings {
    /// Command line arguments for the WebView2 browser process. They replace Tauri's defaults, which are repeated here.
    pub fn browser_args(&self) -> String {
        let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI");
        if self.match_hlmv_colors {
            args.push_str(" --force-color-profile=srgb");
        }
        args
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    crate::commands::config_dir(app).ok().map(|d| d.join("settings.json"))
}

/// Reads the settings, falling back to the defaults for a missing or unreadable file.
pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .and_then(|p| fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let p = path(app).ok_or("no config folder")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(p, serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn scroll_strength_defaults_for_old_settings_and_round_trips() {
        let legacy: Settings = serde_json::from_str(r#"{"cameraSmoothing":false}"#).unwrap();
        assert_eq!(legacy.scroll_strength, 1.0);
        assert!(legacy.play_hit_reactions);
        assert!(!legacy.camera_smoothing);
        let settings = Settings { scroll_strength: 3.5, ..Settings::default() };
        let json = serde_json::to_string(&settings).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.scroll_strength, 3.5);
    }

    #[test]
    fn hotkeys_are_empty_for_old_settings_and_round_trip() {
        let legacy: Settings = serde_json::from_str(r#"{"cameraSmoothing":false}"#).unwrap();
        assert!(legacy.hotkeys.is_empty());
        let mut settings = Settings::default();
        settings.hotkeys.insert("tool.move".into(), "KeyG".into());
        settings.hotkeys.insert("select.box".into(), String::new());
        let restored: Settings = serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(restored.hotkeys.get("tool.move").map(String::as_str), Some("KeyG"));
        assert_eq!(restored.hotkeys.get("select.box").map(String::as_str), Some(""));
    }
}

#[cfg(test)]
mod hit_reaction_tests {
    use super::Settings;
    #[test]
    fn hit_reactions_default_and_roundtrip(){let legacy:Settings=serde_json::from_str("{}").unwrap();assert!(legacy.play_hit_reactions);let value=Settings {play_hit_reactions:false,..Settings::default()};let restored:Settings=serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();assert!(!restored.play_hit_reactions);}
}
