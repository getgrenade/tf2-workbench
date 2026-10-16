#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod blender;
mod commands;
mod payload;
mod settings;
mod thumbcache;
mod state;
mod native_particles;
mod play_mouse;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .manage(native_particles::NativeParticles::default())
        .manage(play_mouse::PlayMouse::default())
        .invoke_handler(tauri::generate_handler![
            blender::find_blender,
            blender::export_blend_rig,
            play_mouse::play_mouse_start,
            play_mouse::play_mouse_stop,
            commands::find_tf2,
            commands::index_tf2,
            commands::list_dir,
            commands::search_paths,
            commands::file_preview,
            commands::load_model,
            commands::load_material,
            commands::load_texture_frames,
            commands::load_particle_asset,
            commands::load_overlay_font,
            commands::list_unusual_effects,
            commands::list_cubemaps,
            commands::cubemaps_dir,
            commands::list_custom_effects,
            commands::import_effect_zip,
            commands::remove_custom_effect,
            commands::get_weapon_profile,
            commands::particle_system_file,
            native_particles::native_particle_start,
            native_particles::native_particle_reset,
            native_particles::native_particle_step,
            native_particles::native_particle_stop,
            commands::list_sequences,
            commands::bake_sequence,
            commands::prepare_workshop_taunt,
            commands::clear_taunt_cache,
            commands::taunt_cache_path,
            commands::eval_poses,
            commands::list_items,
            commands::player_gibs,
            commands::model_physics,
            commands::get_settings,
            commands::set_settings,
            commands::write_text_file,
            commands::read_text_file,
            commands::read_source_file,
            commands::build_item,
            commands::build_prop,
            commands::read_prop_session,
            commands::thumb_cache_get,
            commands::thumb_cache_put,
            commands::list_models,
            commands::list_custom_content,
            commands::add_custom_content,
            commands::remove_custom_content,
            commands::reveal_file,
            commands::source_stamp,
            commands::source_siblings,
            commands::write_binary_file,
            commands::write_adjusted_model,
            commands::rewrite_model_file,
            commands::save_item_icon,
            commands::import_source_dir,
            commands::read_item_session,
            commands::load_session,
            commands::save_session,
            commands::refresh_workshop,
            commands::workshop_stamp,
            commands::list_poses,
            commands::read_poses,
            commands::open_poses_folder,
            commands::save_pose,
            commands::load_pose,
            commands::delete_pose,
            commands::read_light_setups,
            commands::save_light_setup,
            commands::delete_light_setup,
            commands::open_light_setups_folder,
        ])
        .setup(|app| {
            use tauri::Manager;
            let cache = app.path().app_cache_dir()?.join("workshop-taunts");
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = source_formats::workshop::cleanup_cache(&cache, Some(std::time::Duration::from_secs(30 * 24 * 60 * 60))) {
                    eprintln!("Taunt cache cleanup: {error}");
                }
            });
            // The main window is created here (not in tauri.conf.json) so that settings such as colour management,
            // which are fixed once the web view exists, can be applied.
            let settings = settings::load(app.handle());
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("TF2 Workbench")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .maximized(true)
                .additional_browser_args(&settings.browser_args())
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TF2 Workbench");
}
