//! The parts of the app's backend that do not depend on Tauri: they read the game's files through a [`VpkSet`] and answer in JSON or bytes.
//! The desktop app calls them from its commands.
use serde::Serialize;
use source_formats::VpkSet;

#[derive(Serialize)]
pub struct UnusualEffectDto { pub id: u32, pub name: String, pub system: String, pub kind: String, pub file: Option<String>, pub attachment: String, pub root_bone: bool, pub refire: f64 }

pub fn weapon_profile(vpk: &VpkSet, id: u32, class: &str, team: u32) -> Result<serde_json::Value,String> {
    use source_formats::{items,kv,weapon,anim::AnimSet};
    let bytes = vpk.read("scripts/items/items_game.txt").map_err(|e| e.to_string())?;
    let text = items::decode_text(&bytes);
    let item = items::definition(&text,id).map_err(|e| e.to_string())?;
    let schema = kv::parse(&text).map_err(|e| e.to_string())?;
    let attributes = kv::find(&schema,"items_game").and_then(kv::Node::block).and_then(|b|kv::find(b,"attributes")).and_then(kv::Node::block).unwrap_or(&[]);
    let value = |nodes: &[kv::Node], key: &str| kv::find(nodes,key).and_then(kv::Node::as_str).unwrap_or("").to_owned();
    let weapon_class = value(&item,"item_class");
    let weapon_class = weapon::translated_class(&weapon_class,class);
    let script = weapon::script(vpk,weapon_class).map_err(|e| e.to_string())?;
    let num = |key: &str, default: f64| value(&script,key).parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(default);
    let class_data = weapon::script(vpk,&format!("playerclasses/{}",if class=="heavy" {"heavyweapons"} else {class})).map_err(|e| e.to_string())?;
    let ammo_type = value(&script,"primary_ammo");
    let reserve = kv::find(&class_data,"AmmoMax").and_then(kv::Node::block).map(|b| value(b,&ammo_type).parse::<i32>().unwrap_or(0)).unwrap_or(0);
    let visuals = kv::find(&item,"visuals").and_then(kv::Node::block).unwrap_or(&[]);
    let team_visuals = kv::find(&item,if team==1 {"visuals_blu"} else {"visuals_red"}).and_then(kv::Node::block).unwrap_or(&[]);
    let muzzle = kv::find(team_visuals,"muzzle_flash").or_else(|| kv::find(visuals,"muzzle_flash")).and_then(kv::Node::as_str)
        .unwrap_or_else(|| kv::find(&script,"MuzzleFlashParticleEffect").and_then(kv::Node::as_str).unwrap_or(""));
    let brass = kv::find(&item,"brass_eject_model").and_then(kv::Node::as_str).unwrap_or_else(|| kv::find(&script,"BrassModel").and_then(kv::Node::as_str).unwrap_or(""));
    let role = value(&item,"anim_slot").to_uppercase();
    let role = if role.is_empty() {value(&script,"WeaponType").to_uppercase()} else {role};
    let hands = value(&class_data,"model_hands");
    let animations = AnimSet::load(vpk,&hands).ok();
    let seqs = animations.as_ref().map(|a| a.sequences()).unwrap_or_default();
    let activity = |action: &str| {
        let base = format!("ACT_{role}_{action}");
        let raw = if action=="RELOAD_START" {"ACT_RELOAD_START".to_owned()} else if action=="RELOAD_FINISH" {"ACT_RELOAD_FINISH".to_owned()} else {format!("ACT_{action}")};
        // Econ visuals may remap the activity (Force-A-Nature, Frontier Justice, etc.).
        let mapped = [team_visuals,visuals].iter().find_map(|v|kv::find(v,"animation_replacement").and_then(kv::Node::block)
            .and_then(|b|kv::find(b,&raw)).and_then(kv::Node::as_str)).map(str::to_owned).unwrap_or(base);
        seqs.iter().find(|s| animations.as_ref().unwrap().activity_name(s.index)==mapped)
    };
    let duration = |action: &str, fallback: f64| activity(action).map(|s| if s.fps>0. {s.frames.saturating_sub(1) as f64/s.fps as f64} else {fallback}).unwrap_or(fallback);
    let eject = activity("VM_PRIMARYATTACK").map(|s| animations.as_ref().unwrap().brass_events(s.index)).unwrap_or_default();
    let attribute = |class: &str, default: f64| -> f64 {
        let mut product=default;
        for section in ["attributes","static_attrs"] { if let Some(b)=kv::find(&item,section).and_then(kv::Node::block) {
            for n in b { let definition=attributes.iter().find(|a|a.key==n.key || a.block().is_some_and(|b|value(b,"name")==n.key));
                if !definition.and_then(kv::Node::block).is_some_and(|b|value(b,"attribute_class")==class) {continue;}
                let v=n.as_str().map(str::to_owned).unwrap_or_else(|| n.block().map(|b|value(b,"value")).unwrap_or_default());
                if let Ok(v)=v.parse::<f64>() {if v.is_finite(){let format=definition.and_then(kv::Node::block).map(|b|value(b,"description_format")).unwrap_or_default();
                    if format.contains("additive") || format=="value_is_particle_index" {product+=v;}
                    else if format.contains("percentage") {product*=v;}
                    else if format.contains("lookup") {product=v;}
                    else if format=="value_is_or" {product=((product as i32)|(v as i32)) as f64;}
                    else if default==0. {product+=v;} else {product*=v;}}}
            }
        }} product
    };
    let singly = (weapon_class.contains("shotgun") || matches!(weapon_class,"tf_weapon_scattergun"|"tf_weapon_rocketlauncher"|"tf_weapon_rocketlauncher_directhit"|"tf_weapon_rocketlauncher_airstrike"|"tf_weapon_cannon"|"tf_weapon_grenadelauncher"|"tf_weapon_pipebomblauncher"))
        && attribute("set_scattergun_no_reload_single",0.)!=1.;
    let reload_scale = attribute("mult_reload_time",1.) * attribute("mult_reload_time_hidden",1.) * attribute("fast_reload",1.);
    // The Huntsman has no reload: its fire animation carries AE_WPN_INCREMENTAMMO, which moves the next arrow into the clip
    // (tf_weapon_compound_bow.cpp). The animation is played faster by the same factor as the fire delay (LaunchGrenade).
    let ammo_event = if weapon_class == "tf_weapon_compound_bow" {
        activity("VM_PRIMARYATTACK").and_then(|s| animations.as_ref().unwrap().events(s.index).into_iter().find(|(_,_,name)| name=="AE_WPN_INCREMENTAMMO"))
            .map(|(time,_,_)| time as f64*attribute("mult_postfiredelay",1.)*attribute("fast_reload",1.))
    } else {None};
    let flame = weapon_class == "tf_weapon_flamethrower";
    let fire_particle = if flame {
        let mode = attribute("set_weapon_mode",0.) as i32;
        let default = match mode {1=>"drg_phlo_stream_new_flame",2=>"flamethrower_giant_mvm_new_flame",3=>"flamethrower_rainbow_new_flame",_=>"new_flame"};
        let name = if team==1 {"fire particle blue"} else {"fire particle red"};
        ["attributes","static_attrs"].iter().find_map(|section| kv::find(&item,section).and_then(kv::Node::block).and_then(|b|b.iter().find_map(|n| {
            let def=attributes.iter().find(|a|a.key==n.key || a.block().is_some_and(|b|value(b,"name")==n.key));
            if !def.and_then(kv::Node::block).is_some_and(|b|value(b,"name")==name) {return None;}
            n.as_str().map(str::to_owned).or_else(|| n.block().map(|b|value(b,"value")))
        }))).unwrap_or_else(||default.to_owned())
    } else if weapon_class=="tf_weapon_minigun" {"muzzle_minigun_constant".to_owned()}
    else if weapon_class=="tf_weapon_particle_cannon" {if team==1 {"drg_cow_muzzleflash_normal_blue"} else {"drg_cow_muzzleflash_normal"}.to_owned()}
    else if weapon_class=="tf_weapon_raygun" {"drg_bison_muzzleflash".to_owned()}
    else {muzzle.to_owned()};
    // The lunchboxes (CTFLunchBox): the kind of food or drink is the item's weapon mode attribute; what is thrown with the secondary fire depends on it.
    let lunchbox=attribute("set_weapon_mode",0.) as i32;
    let plate=match lunchbox {
        1 => "models/workshop/weapons/c_models/c_chocolate/plate_chocolate.mdl", 2 => "models/workshop/weapons/c_models/c_buffalo_steak/plate_buffalo_steak.mdl",
        3 => "models/items/plate_robo_sandwich.mdl", 4 => "models/items/plate_sandwich_xmas.mdl", 6 => "models/items/banana/plate_banana.mdl",
        7 => "models/workshop/weapons/c_models/c_fishcake/plate_fishcake.mdl", _ => "models/items/plate.mdl",
    };
    let static_number=|name:&str,default:f64| kv::find(&item,"static_attrs").and_then(kv::Node::block).and_then(|b|kv::find(b,name)).and_then(kv::Node::as_str).and_then(|v|v.parse::<f64>().ok()).unwrap_or(default);
    let projectile = match weapon_class {
        "tf_weapon_rocketlauncher" | "tf_weapon_rocketlauncher_directhit" | "tf_weapon_rocketlauncher_airstrike" => Some(("rocket", if attribute("mini_rockets",0.)!=0. {"models/weapons/w_models/w_rocket_airstrike/w_rocket_airstrike.mdl"} else {"models/weapons/w_models/w_rocket.mdl"}, if attribute("mini_rockets",0.)!=0. {"rockettrail_airstrike"} else if attribute("no_self_blast_dmg",0.)!=0. {"rockettrail_RocketJumper"} else {"rockettrail"}, 1100.*attribute("mult_projectile_speed",1.), 0., 8., false)),
        "tf_weapon_grenadelauncher" => Some(("grenade", "models/weapons/w_models/w_grenade_grenadelauncher.mdl", if team==1 {"pipebombtrail_blue"} else {"pipebombtrail_red"}, 1200.*attribute("mult_projectile_speed",1.)*attribute("mult_projectile_range",1.), 800., 2., attribute("grenade_no_spin",0.)==0.)),
        "tf_weapon_cannon" => Some(("cannon", "models/weapons/w_models/w_cannonball.mdl", if team==1 {"pipebombtrail_blue"} else {"pipebombtrail_red"},1200.*attribute("mult_projectile_speed",1.),800.,attribute("grenade_launcher_mortar_mode",0.),true)),
        "tf_weapon_pipebomblauncher" => Some(("sticky",if attribute("set_detonate_mode",0.)==1. {"models/weapons/w_models/w_stickybomb_d.mdl"} else {"models/weapons/w_models/w_stickybomb.mdl"},if team==1 {"stickybombtrail_blue"} else {"stickybombtrail_red"},900.,800.,3600.,true)),
        // Jarate and Mad Milk are pipebomb-type projectiles that burst on the first thing they touch (tf_weapon_jar.cpp); the cleaver is the same
        // body thrown at 3000 units/s and not bursting. override_projectile_type swaps the model (festive jar, bread monster).
        "tf_weapon_jar" | "tf_weapon_jar_milk" => {
            let milk = weapon_class=="tf_weapon_jar_milk";
            let model = match (attribute("override_projectile_type",0.) as i32, milk) {
                (24|25, true) => "models/weapons/c_models/c_breadmonster/c_breadmonster_milk.mdl",
                (24|25, false) => "models/weapons/c_models/c_breadmonster/c_breadmonster.mdl",
                (22, false) => "models/weapons/c_models/c_xms_urinejar.mdl",
                (_, true) => "models/workshop/weapons/c_models/c_madmilk/c_madmilk.mdl",
                _ => "models/weapons/c_models/urinejar.mdl",
            };
            Some(("jar", model, if team==1 {"peejar_trail_blu"} else {"peejar_trail_red"}, 1000., 800., 2., true))
        },
        // CTFLunchBox::SecondaryAttack: the food is thrown out as a health kit at 500 units a second, ten degrees up, and falls like a dropped item
        "tf_weapon_lunchbox" => Some(("plate",plate,"",500.,800.,30.,false)),
        "tf_weapon_cleaver" => Some(("cleaver","models/workshop_partner/weapons/c_models/c_sd_cleaver/c_sd_cleaver.mdl",if team==1 {"peejar_trail_blu_glow"} else {"peejar_trail_red_glow"},3000.,800.,4.,true)),
        // The healing bolt is an arrow (CTFProjectile_Arrow) with the syringe's model at three times the size and a team coloured trail (c_tf_projectile_arrow.cpp)
        "tf_weapon_crossbow" => Some(("arrow",if id==1079 {"models/workshop/weapons/c_models/c_crusaders_crossbow/c_crusaders_crossbow_xmas_proj.mdl"} else {"models/weapons/w_models/w_syringe_proj.mdl"},if team==1 {"healshot_trail_blue"} else {"healshot_trail_red"},2400.,160.,10.,false)),
        "tf_weapon_compound_bow" => Some(("arrow",if id==1005 {"models/weapons/w_models/w_arrow_xmas.mdl"} else {"models/weapons/w_models/w_arrow.mdl"},"",1800.,400.,10.,false)),
        "tf_weapon_particle_cannon" => Some(("energy", "models/weapons/w_models/w_drg_ball.mdl", if team==1 {"drg_cow_rockettrail_normal_blue"} else {"drg_cow_rockettrail_normal"}, 1100., 0., 8., false)),
        "tf_weapon_raygun" => Some(("energy", "", "drg_bison_projectile", 1200., 0., 8., false)),
        "tf_weapon_syringegun_medic" => Some(("syringe", "models/weapons/w_models/w_syringe_proj.mdl", if team==1 {"nailtrails_medic_blue"} else {"nailtrails_medic_red"}, 1000., 240., 3., false)),
        _ => None,
    }.map(|(kind,model,trail,speed,gravity,lifetime,spin)| {
        let bolt=weapon_class=="tf_weapon_crossbow";
        let custom_model=["attributes","static_attrs"].iter().find_map(|section|kv::find(&item,section).and_then(kv::Node::block).and_then(|b|b.iter().find_map(|n| {
            let def=attributes.iter().find(|a|a.key==n.key || a.block().is_some_and(|b|value(b,"name")==n.key));
            if !def.and_then(kv::Node::block).is_some_and(|b|value(b,"name")=="custom projectile model") {return None;}
            n.as_str().map(str::to_owned).or_else(||n.block().map(|b|value(b,"value")))
        })));
        let impact=if weapon_class=="tf_weapon_particle_cannon" {if team==1 {"drg_cow_explosioncore_normal_blue"} else {"drg_cow_explosioncore_normal"}.to_owned()}
            else if weapon_class=="tf_weapon_raygun" {"drg_pomson_impact".to_owned()} else if kind=="jar" {if weapon_class=="tf_weapon_jar_milk" {"peejar_impact_milk"} else {"peejar_impact"}.to_owned()}
            else if matches!(kind,"rocket"|"grenade"|"cannon"|"sticky") {value(&script,"ExplosionEffect")} else {String::new()};
        let impact_air=if weapon_class=="tf_weapon_particle_cannon" || kind=="jar" {impact.clone()} else if matches!(kind,"rocket"|"grenade"|"cannon"|"sticky") {value(&script,"ExplosionPlayerEffect")} else {String::new()};
        serde_json::json!({"kind":kind,"model":custom_model.unwrap_or_else(||model.to_owned()),"trail":trail,"speed":speed,"gravity":gravity,"lifetime":lifetime,"spin":spin,"team":team,"impact":impact,"impactAir":impact_air,"speedMax":if kind=="sticky" {2400.} else if kind=="arrow" && !bolt {2600.} else {speed},"gravityMin":if kind=="arrow" && !bolt {80.} else {gravity},"scale":if bolt {3.} else {1.},"damageRadius":if attribute("mult_dmg",1.)<=0. {0.} else {num("DamageRadius",146.)},"armTime":attribute("sticky_arm_time",0.8).max(0.),"maxActive":8.+attribute("add_max_pipebombs",0.),"detonateMode":attribute("set_detonate_mode",0.),"spriteTrail":if kind=="arrow" && !bolt {if team==1 {"effects/arrowtrail_blu.vmt"} else {"effects/arrowtrail_red.vmt"}} else {""}})
    });
    let colors = if matches!(weapon_class,"tf_weapon_particle_cannon"|"tf_weapon_raygun") {
        if team==1 {vec![0.345,0.52,0.635,0.145,0.427,0.55]} else {vec![0.72,0.22,0.23,0.5,0.18,0.125]}
    } else {vec![]};
    let charge=match weapon_class {
        "tf_weapon_pipebomblauncher"=>Some(serde_json::json!({"seconds":4.*attribute("stickybomb_charge_rate",1.),"autoRelease":true,"cook":false})),
        "tf_weapon_cannon"=>Some(serde_json::json!({"seconds":attribute("grenade_launcher_mortar_mode",0.),"autoRelease":true,"cook":true})),
        "tf_weapon_compound_bow"=>Some(serde_json::json!({"seconds":attribute("mult_postfiredelay",1.),"autoRelease":false,"cook":false})),_=>None,
    };
    // A thrown jar leaves the hand until the effect bar has refilled (InternalGetEffectBarRechargeTime); the throw itself happens 0.1 s into the animation (TossJarThink).
    let throwable=match weapon_class {
        "tf_weapon_jar"|"tf_weapon_jar_milk" => Some(serde_json::json!({"recharge":20.1*attribute("effect_bar_recharge_rate",1.),"delay":0.1})),
        "tf_weapon_cleaver" => Some(serde_json::json!({"recharge":5.1*attribute("effect_bar_recharge_rate",1.),"delay":0.1})),
        _ => None,
    };
    // The item's `animation_replacement` also rewrites the player's own activities (the Buff Banner plays the bugle call, the Self-Aware Beauty Mark throws):
    // the third-person ones (ACT_MP_*) go to the viewer, which matches them to the class model's sequences; the team's own entries win.
    let mut anim_replacement=serde_json::Map::new();
    for v in [visuals,team_visuals] {
        if let Some(b)=kv::find(v,"animation_replacement").and_then(kv::Node::block) {
            for n in b { if n.key.to_ascii_uppercase().starts_with("ACT_MP_") { if let Some(to)=n.as_str() { anim_replacement.insert(n.key.to_ascii_uppercase(),serde_json::Value::String(to.to_ascii_uppercase())); } } }
        }
    }
    // The tracer of a hitscan weapon: the item's `tracer_effect` (or the weapon script's TracerEffect) with the team's colour (CTFWeaponBase::GetTracerType), and the rail
    // that rifles with "sniper fires tracer" draw (MaybeDrawRailgunBeam; the Classic has its own).
    let tracer_base=kv::find(team_visuals,"tracer_effect").or_else(|| kv::find(visuals,"tracer_effect")).and_then(kv::Node::as_str).map(str::to_owned).unwrap_or_else(|| value(&script,"TracerEffect"));
    let side=if team==1 {"blue"} else {"red"};
    let rail=attribute("sniper_fires_tracer",0.)!=0. || attribute("sniper_fires_tracer_hidden",0.)!=0. || attribute("sniper_fires_tracer_HIDDEN",0.)!=0.;
    let tracer=if weapon_class=="tf_weapon_sniperrifle_classic" {"tfc_sniper_distortion_trail".to_owned()} else if rail {format!("dxhr_sniper_rail_{side}")}
        else if !tracer_base.is_empty() {format!("{tracer_base}_{side}")} else {String::new()};
    // Eating and drinking (CTFLunchBox::PrimaryAttack is a taunt): the Heavy's bites come every second from the first, healing 75 (25 for the bars), and the
    // Scout's drink starts its effect 0.9 s in (tf_player.cpp, TAUNTATK_HEAVY_EAT / TAUNTATK_SCOUT_DRINK). The meters: Sandwiches 30 s, bars and the banana 10 s (item_meter_charge_rate);
    // the drinks regain in TF_SANDWICH_REGENTIME (30 s). Bonk is the phase (Bonk effect), Crit-a-Cola the minicrit boost, both for the 8 s the drink's meter lasts.
    let consumable = match weapon_class {
        "tf_weapon_lunchbox" => Some(serde_json::json!({"kind":"food","type":lunchbox,"recharge":static_number("item_meter_charge_rate",30.),
            "heal":(if matches!(lunchbox,1|7) {25.} else {75.})*attribute("lunchbox_healing_scale",1.),"firstBiteBuff":if lunchbox==2 {"crit"} else {""},"buffSeconds":16.,"keepsMelee":lunchbox==2,
            "stays":matches!(lunchbox,0|3|4)})),
        "tf_weapon_lunchbox_drink" => Some(serde_json::json!({"kind":"drink","type":lunchbox,"recharge":30.*attribute("effect_bar_recharge_rate",1.),"drinkAt":0.9,
            "buff":if lunchbox==2 {"crit"} else {"phase"},"buffSeconds":8.,
            "splash":kv::find(visuals,"custom_particlesystem").and_then(kv::Node::block).map(|b|value(b,"system")).filter(|v|!v.is_empty()).unwrap_or_else(||"energydrink_splash".to_owned())})),
        _ => None,
    };
    let healing=if weapon_class=="tf_weapon_medigun" {Some(serde_json::json!({"system":if team==1 {"medicgun_beam_blue"} else {"medicgun_beam_red"},"range":num("Range",450.)}))} else {None};
    let muzzle=if weapon_class=="tf_weapon_compound_bow" {""} else {fire_particle.as_str()};
    let clip = num("clip_size",-1.);
    Ok(serde_json::json!({"itemId":id,"weaponClass":weapon_class,"clipSize":if clip<0. {-1} else {(clip*attribute("mult_clipsize",1.)).round().max(0.) as i32},
        "reserve":(reserve as f64*attribute(if ammo_type.eq_ignore_ascii_case("TF_AMMO_SECONDARY") {"mult_maxammo_secondary"} else {"mult_maxammo_primary"},1.)).round() as i32,
        "ammoPerShot":if flame {14.*0.02*attribute("mult_flame_ammopersec",1.)} else {num("AmmoPerShot",1.).max(1.)},
        "fireDelay":if flame {0.02} else {(num("TimeFireDelay",0.5)*attribute("mult_postfiredelay",1.)).max(1./60.)},
        "reloadSingly":singly,"reloadStart":duration("RELOAD_START",num("TimeReloadStart",0.))*reload_scale,
        "reloadTime":(if singly {duration("VM_RELOAD",num("TimeReload",0.5))} else {(duration("VM_RELOAD",num("TimeReload",0.5))-0.2).max(0.1)})*reload_scale,
        "reloadPlaybackRate":if reload_scale>0. {(1./reload_scale).clamp(-4.,12.)} else {1.},
        "flame":if flame {vec![attribute("flame_speed",0.),attribute("flame_lifetime",0.),attribute("flame_random_life_time_offset",0.),attribute("flame_drag",0.),attribute("flame_gravity",0.),attribute("flame_up_speed",0.),attribute("flame_spread_degree",0.),attribute("mult_flame_size",1.),attribute("mult_end_flame_size",1.),attribute("flame_ignore_player_velocity",0.)]} else {vec![]},
        "reloadEnd":duration("RELOAD_FINISH",0.),"ammoEvent":ammo_event,"muzzle":muzzle,"projectile":projectile,"colors":colors,"charge":charge,"throwable":throwable,"animReplacement":anim_replacement,"tracer":tracer,"consumable":consumable,"healing":healing,
        "melee":if value(&item,"item_slot")=="melee" || role=="MELEE" {Some(serde_json::json!({"range":(if attribute("is_a_sword",0.)>0. {72.} else {48.})*attribute("melee_range_multiplier",1.),"hull":18.*attribute("melee_bounds_multiplier",1.),"delay":num("SmackDelay",0.2)}))} else {None},"hitscan":matches!(weapon_class,"tf_weapon_scattergun"|"tf_weapon_soda_popper"|"tf_weapon_pep_brawler_blaster"|"tf_weapon_minigun"|"tf_weapon_sniperrifle"|"tf_weapon_sniperrifle_decap"|"tf_weapon_sniperrifle_classic"|"tf_weapon_smg"|"tf_weapon_charged_smg"|"tf_weapon_revolver"|"tf_weapon_pistol"|"tf_weapon_pistol_scout"|"tf_weapon_handgun_scout_primary"|"tf_weapon_handgun_scout_secondary") || (weapon_class.contains("shotgun") && weapon_class!="tf_weapon_shotgun_building_rescue"),"range":num("Range",8192.),"brass":brass,"ejectTimes":eject,"continuous":weapon_class=="tf_weapon_minigun" || flame}))
}

#[cfg(test)]
mod weapon_tests {
    use super::*;
    #[test]
    #[ignore = "requires installed TF2 VPK assets"]
    fn interaction_profile_audit() {
        let vpk=VpkSet::open_folder(&source_formats::steam::find_tf2().unwrap()).unwrap();
        for (id,cls,kind) in [(1104,"soldier","rocket"),(996,"demoman","cannon"),(20,"demoman","sticky"),(130,"demoman","sticky"),(1150,"demoman","sticky"),(265,"demoman","sticky"),(56,"sniper","arrow")] {
            let p=weapon_profile(&vpk,id,cls,0).unwrap();
            assert_eq!(p["projectile"]["kind"],kind);
            let model=p["projectile"]["model"].as_str().unwrap();
            source_formats::model::load(&vpk,model).unwrap();
            if kind=="sticky" {assert!(p["projectile"]["armTime"].as_f64().unwrap()>0.);assert!(p["charge"]["seconds"].as_f64().unwrap()>0.);}
            if id==130 {assert_eq!(p["projectile"]["maxActive"],14.);assert_eq!(p["projectile"]["detonateMode"],1.);}
            if id==996 {assert_eq!(p["charge"]["seconds"],1.);assert_eq!(p["projectile"]["speed"],1440.);}
            if id==56 {assert_eq!(p["projectile"]["speedMax"],2600.);assert_eq!(p["projectile"]["gravityMin"],80.);assert_eq!(p["muzzle"],"");}
        }
        for (id,cls) in [(5,"heavy"),(7,"pyro"),(132,"demoman")] {let p=weapon_profile(&vpk,id,cls,0).unwrap();assert!(p["melee"]["range"].as_f64().unwrap()>=48.);assert_eq!(p["melee"]["hull"],18.);assert!(p["melee"]["delay"].as_f64().unwrap()>0.);}
        let p=weapon_profile(&vpk,211,"medic",0).unwrap();assert_eq!(p["healing"]["system"],"medicgun_beam_red");assert_eq!(p["healing"]["range"],450.);
        let db=source_formats::items::load(&vpk).unwrap();
        for (id,cls) in [(1104,"soldier"),(996,"demoman"),(20,"demoman"),(130,"demoman"),(1150,"demoman"),(56,"sniper"),(211,"medic")] {
            let item=db.weapons.iter().find(|w|w.id==if id==20 {207} else {id}).unwrap();let path=item.model_for(cls).unwrap();
            let mdl=source_formats::mdl::parse(&vpk.read(path).unwrap()).unwrap();
            eprintln!("{id} model {path} attachments {:?}",mdl.attachments.iter().map(|a|&a.name).collect::<Vec<_>>());
            assert!(mdl.attachments.iter().any(|a|a.name.eq_ignore_ascii_case("muzzle")),"{id}: muzzle attachment");
            if cls=="medic" {
                let anim=source_formats::anim::AnimSet::load(&vpk,path).unwrap();assert_eq!(anim.seq_name(0),"idle");
                let clip=anim.bake(0,&anim.default_pose_params());assert_eq!(clip.num_bones,mdl.bones.len());

            }
        }
    }
    #[test]
    #[ignore = "exports installed TF2 model fixtures for frontend orientation verification"]
    fn installed_projectile_pose_fixtures() {
        let tf=source_formats::steam::find_tf2().unwrap();let vpk=VpkSet::open_folder(&tf).unwrap();
        let output=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/projectile-orientation");
        std::fs::create_dir_all(&output).unwrap();
        for name in ["w_rocket","w_syringe_proj"] {
            let path=format!("models/weapons/w_models/{name}.mdl");
            let model=source_formats::model::load(&vpk,&path).unwrap();
            let anim=source_formats::anim::AnimSet::load(&vpk,&path).unwrap();
            assert_eq!(anim.seq_name(0),"idle");
            let clip=anim.bake(0,&anim.default_pose_params());
            std::fs::write(output.join(format!("{name}.model")),crate::payload::encode(&model)).unwrap();
            std::fs::write(output.join(format!("{name}.clip")),crate::payload::encode_clip(&clip)).unwrap();
        }
    }
    #[test]
    fn installed_weapon_profiles() {
        let Some(tf)=source_formats::steam::find_tf2() else {return;};
        let vpk=VpkSet::open_folder(&tf).unwrap();
        let shotgun=weapon_profile(&vpk,199,"engineer",0).unwrap();
        assert_eq!(shotgun["clipSize"],6); assert_eq!(shotgun["reserve"],32); assert_eq!(shotgun["muzzle"],"muzzle_shotgun");
        assert_eq!(shotgun["reloadSingly"],true); assert!((shotgun["reloadStart"].as_f64().unwrap()-10./30.).abs()<0.001);
        assert!((shotgun["reloadTime"].as_f64().unwrap()-0.5).abs()<0.001);
        let pistol=weapon_profile(&vpk,209,"scout",0).unwrap();
        assert_eq!(pistol["clipSize"],12); assert_eq!(pistol["reserve"],36);assert_eq!(pistol["reloadSingly"],false);
        assert!((pistol["reloadTime"].as_f64().unwrap()-1.).abs()<0.001);
        // the Huntsman refills its clip from an animation event in its fire sequence, not by reloading; other weapons have none
        let bow=weapon_profile(&vpk,56,"sniper",0).unwrap();
        assert_eq!(bow["weaponClass"],"tf_weapon_compound_bow");
        assert!((bow["ammoEvent"].as_f64().expect("the bow's fire animation has AE_WPN_INCREMENTAMMO")-1.03).abs()<0.02,"bow ammo event at {}",bow["ammoEvent"]);
        assert!(shotgun["ammoEvent"].is_null() && pistol["ammoEvent"].is_null());
        // thrown weapons: one jar at a time, back after the effect bar refills
        for (id,class,kind,impact,recharge) in [(58,"sniper","jar","peejar_impact",20.1),(222,"scout","jar","peejar_impact_milk",20.1),(812,"scout","cleaver","",5.1)] {
            let p=weapon_profile(&vpk,id,class,0).unwrap();
            assert_eq!(p["projectile"]["kind"],kind,"{id}"); assert_eq!(p["projectile"]["impact"],impact,"{id}");
            assert!((p["throwable"]["recharge"].as_f64().unwrap()-recharge).abs()<0.01,"{id} {}",p["throwable"]);
        }
        assert!(shotgun["throwable"].is_null());
        // lunchboxes: food is eaten (and thrown out), drinks are drunk; the meters and the buffs come from the schema
        let sandvich=weapon_profile(&vpk,42,"heavy",0).unwrap();
        assert_eq!(sandvich["consumable"]["kind"],"food");assert_eq!(sandvich["consumable"]["recharge"],30.);assert_eq!(sandvich["consumable"]["stays"],true);
        assert_eq!(sandvich["projectile"]["kind"],"plate");assert_eq!(sandvich["projectile"]["model"],"models/items/plate.mdl");
        let bar=weapon_profile(&vpk,159,"heavy",0).unwrap();
        assert_eq!(bar["consumable"]["recharge"],10.);assert_eq!(bar["consumable"]["heal"],25.);assert_eq!(bar["consumable"]["stays"],false);
        let steak=weapon_profile(&vpk,311,"heavy",0).unwrap();
        assert_eq!(steak["consumable"]["firstBiteBuff"],"crit");assert_eq!(steak["consumable"]["keepsMelee"],true);
        let bonk=weapon_profile(&vpk,46,"scout",0).unwrap();
        assert_eq!(bonk["consumable"]["kind"],"drink");assert_eq!(bonk["consumable"]["buff"],"phase");assert_eq!(bonk["consumable"]["splash"],"energydrink_splash");
        let cola=weapon_profile(&vpk,163,"scout",0).unwrap();
        assert_eq!(cola["consumable"]["buff"],"crit");assert_eq!(cola["consumable"]["splash"],"energydrink_cola_splash");
        assert!(shotgun["consumable"].is_null());
        let mini=weapon_profile(&vpk,202,"heavy",0).unwrap();
        assert_eq!(mini["clipSize"],-1);assert_eq!(mini["reserve"],200);assert_eq!(mini["muzzle"],"muzzle_minigun_constant");
        assert_eq!(mini["fireDelay"],0.1);assert_eq!(mini["continuous"],true);
        for (id,cls,kind,speed,gravity,trail) in [
            (18,"soldier","rocket",1100.,0.,"rockettrail"),
            (127,"soldier","rocket",1980.,0.,"rockettrail"),
            (19,"demoman","grenade",1200.,800.,"pipebombtrail_red"),
            (17,"medic","syringe",1000.,240.,"nailtrails_medic_red"),
            (441,"soldier","energy",1100.,0.,"drg_cow_rockettrail_normal"),
            (442,"soldier","energy",1200.,0.,"drg_bison_projectile")
        ] {
            let p=weapon_profile(&vpk,id,cls,0).unwrap();
            assert_eq!(p["projectile"]["kind"],kind,"item {id}");
            assert!((p["projectile"]["speed"].as_f64().unwrap()-speed).abs()<0.01,"item {id}");
            assert_eq!(p["projectile"]["gravity"],gravity);assert_eq!(p["projectile"]["trail"],trail);
            let model=p["projectile"]["model"].as_str().unwrap();
            if !model.is_empty() {assert!(source_formats::model::load(&vpk,model).is_ok(),"{model}");}
        }
        let iron=weapon_profile(&vpk,1151,"demoman",0).unwrap();
        assert_eq!(weapon_profile(&vpk,308,"demoman",0).unwrap()["projectile"]["spin"],false);
        assert!(iron["projectile"]["model"].as_str().unwrap().contains("w_quadball_grenade"),"Iron Bomber custom projectile: {}",iron["projectile"]);
        assert!(!weapon_profile(&vpk,19,"demoman",0).unwrap()["projectile"]["impact"].as_str().unwrap().is_empty());
        assert_eq!(weapon_profile(&vpk,441,"soldier",1).unwrap()["muzzle"],"drg_cow_muzzleflash_normal_blue");
        assert_eq!(weapon_profile(&vpk,442,"soldier",0).unwrap()["muzzle"],"drg_bison_muzzleflash");
        assert_eq!(shotgun["reloadPlaybackRate"],1.,"Third person gestures retain authored speed");
        let flame=weapon_profile(&vpk,208,"pyro",0).unwrap();
        assert_eq!(flame["muzzle"],"new_flame");assert_eq!(flame["continuous"],true);
        assert_eq!(flame["fireDelay"],0.02);assert!((flame["ammoPerShot"].as_f64().unwrap()-0.28).abs()<1e-6);
        assert_eq!(flame["flame"][0],2450.);assert_eq!(flame["flame"][3],8.5);
        assert_eq!(weapon_profile(&vpk,594,"pyro",0).unwrap()["muzzle"],"drg_phlo_stream_new_flame");
        assert_eq!(weapon_profile(&vpk,741,"pyro",0).unwrap()["muzzle"],"flamethrower_rainbow_new_flame");
        let fan=weapon_profile(&vpk,45,"scout",0).unwrap();
        assert_eq!(fan["clipSize"],2,"Attribute hooks round clip size as Source does");assert_eq!(fan["reloadSingly"],false);
        assert!(!shotgun["ejectTimes"].as_array().unwrap().is_empty(),"Pump event must retain its authored timing");
        for shell in ["shell_shotgun","shell_pistol","shell_sniperrifle"] {
            let path=format!("models/weapons/shells/{shell}.mdl");
            let model=source_formats::model::load(&vpk,&path).unwrap();
            assert!(model.body_parts.iter().any(|p|p.models.iter().any(|m|m.meshes.iter().any(|mesh|!mesh.indices.is_empty()))),"{shell}: original legacy MDL must have visible geometry");
        }
    }
}


/// Only the DMX element directory is needed to locate definitions; attributes stay in the PCF.
pub fn pcf_system_names(bytes: &[u8]) -> Option<Vec<String>> {
    let mut at = 0;
    fn text<'a>(b: &'a [u8], at: &mut usize) -> Option<&'a str> {
        let end = *at + b.get(*at..)?.iter().position(|v| *v == 0)?;
        let s = std::str::from_utf8(b.get(*at..end)?).ok()?; *at = end + 1; Some(s)
    }
    fn u16(b: &[u8], at: &mut usize) -> Option<usize> {
        let v = u16::from_le_bytes(b.get(*at..*at + 2)?.try_into().ok()?) as usize; *at += 2; Some(v)
    }
    if text(bytes, &mut at)?.trim() != "<!-- dmx encoding binary 2 format pcf 1 -->" { return None; }
    let count = u16(bytes, &mut at)?;
    let mut strings = Vec::with_capacity(count);
    for _ in 0..count { strings.push(text(bytes, &mut at)?); }
    let count = u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize; at += 4;
    if count > 50000 { return None; }
    let mut names = Vec::new();
    for _ in 0..count {
        let kind = *strings.get(u16(bytes, &mut at)?)?;
        let name = text(bytes, &mut at)?;
        bytes.get(at..at + 16)?; at += 16;
        if kind == "DmeParticleSystemDefinition" { names.push(name.to_owned()); }
    }
    Some(names)
}


/// Read the game's own unusual categories and localized names, rather than maintaining a list.
pub fn unusual_effects(vpk: &VpkSet) -> Result<Vec<UnusualEffectDto>, String> {
    use source_formats::{items, kv};
    let bytes = vpk.read("scripts/items/items_game.txt").map_err(|e| e.to_string())?;
    let nodes = kv::parse(&items::decode_text(&bytes)).map_err(|e| e.to_string())?;
    let root = kv::find(&nodes, "items_game").and_then(kv::Node::block).ok_or("Missing item schema")?;
    let particles = kv::find(root, "attribute_controlled_attached_particles").and_then(kv::Node::block).ok_or("Missing unusual particle catalog")?;
    let names = items::load_english(vpk);
    let mut files = std::collections::HashMap::new();
    for path in vpk.search("particles/", usize::MAX).into_iter().filter(|p| p.ends_with(".pcf")) {
        if let Ok(bytes) = vpk.read(path) {
            if let Some(systems) = pcf_system_names(&bytes) {
                for system in systems { files.insert(system, path.to_owned()); }
            }
        }
    }
    let mut result = Vec::new();
    // ("other": the effects some items always show, such as the Cheater's Lament's halo; not offered as an unusual effect, but found by id)
    for (category, kind) in [("cosmetic_unusual_effects", "hat"), ("taunt_unusual_effects", "taunt"), ("other_particles", "other")] {
        let entries = kv::find(particles, category).and_then(kv::Node::block).ok_or("Missing unusual category")?;
        for entry in entries {
            let Ok(id) = entry.key.parse::<u32>() else { continue; };
            let Some(system) = entry.block().and_then(|b| kv::find(b, "system")).and_then(kv::Node::as_str) else { continue; };
            let name = names.get(&format!("attrib_particle{id}")).cloned().unwrap_or_else(|| system.to_owned());
            let block = entry.block().unwrap();
            let value = |key| kv::find(block, key).and_then(kv::Node::as_str).unwrap_or("");
            result.push(UnusualEffectDto { id, name, system: system.to_owned(), kind: kind.to_owned(), file: files.get(system).cloned(),
                attachment: value("attachment").to_owned(), root_bone: value("attach_to_rootbone") == "1", refire: value("refire_time").parse().unwrap_or(0.0) });
        }
    }
    // the systems items attach by name (`visuals/attached_particlesystems`: the Earbuds' notes), as entries of their own, found by system
    let mut named = std::collections::BTreeSet::new();
    if let Some(items_block) = kv::find(root, "items").and_then(kv::Node::block) {
        for item in items_block.iter().filter_map(kv::Node::block) {
            let Some(systems) = kv::find(item, "visuals").and_then(kv::Node::block).and_then(|v| kv::find(v, "attached_particlesystems")).and_then(kv::Node::block) else { continue };
            for n in systems.iter().filter_map(kv::Node::block) {
                if let Some(system) = kv::find(n, "system").and_then(kv::Node::as_str) {
                    let attachment = kv::find(n, "attachment").and_then(kv::Node::as_str).unwrap_or("");
                    named.insert((system.to_owned(), attachment.to_owned()));
                }
            }
        }
    }
    // the systems the engine starts itself at an attachment of a model: the Spy's cigarette (`cig`), which no item names
    named.insert(("cig_smoke".to_owned(), "cig_smoke".to_owned()));
    named.insert(("cig_burn".to_owned(), "cig_smoke".to_owned()));
    for (i, (system, attachment)) in named.into_iter().enumerate() {
        if result.iter().any(|e| e.system == system) { continue; }
        result.push(UnusualEffectDto { id: 1_000_000 + i as u32, name: system.clone(), kind: "other".to_owned(), file: files.get(&system).cloned(), attachment, root_bone: false, refire: 0.0, system });
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.id.cmp(&b.id)));
    Ok(result)
}

/// TF2 BuildGibList reads repeated break blocks from the class .phy keyvalues.
pub fn gib_definitions(vpk:&VpkSet,path:&str)->Result<serde_json::Value,String> {
    let path=path.replace('\\',"/");
    if !path.starts_with("models/player/") || !path.ends_with(".mdl") || path.contains("..") {return Err("Invalid player model".into());}
    let nodes=physics_nodes(vpk,&path)?;
    let mut result=Vec::new();
    for node in nodes.iter().filter(|n|n.key.eq_ignore_ascii_case("break")) {
        let Some(block)=node.block() else {continue;};
        let value=|key:&str|source_formats::kv::find(block,key).and_then(source_formats::kv::Node::as_str).unwrap_or("");
        let model=if value("model").is_empty(){value("ragdoll")}else{value("model")}.replace('\\',"/");
        if model.is_empty(){continue;}
        let model=if model.starts_with("models/"){model}else{format!("models/{model}")};
        let model=if model.ends_with(".mdl"){model}else{format!("{model}.mdl")};
        let vector=|key:&str|{let mut out=[0f64;3];for (i,v) in value(key).split_whitespace().take(3).enumerate(){out[i]=v.parse().unwrap_or(0.);}out};
        result.push(serde_json::json!({"model":model,"bone":value("placementbone"),"attachment":value("placementattachment"),"offset":vector("offset"),"velocity":vector("velocity"),"burst":value("burst").parse::<f64>().unwrap_or(1.),"fadeTime":value("fadetime").parse::<f64>().unwrap_or(15.)}));
    }
    Ok(serde_json::Value::Array(result))
}

#[cfg(test)]
mod gib_tests {
    use super::*;
    #[test]
    #[ignore="requires installed TF2 VPK"]
    fn installed_class_gibs(){let vpk=VpkSet::open_folder(&source_formats::steam::find_tf2().unwrap()).unwrap();for cls in ["scout","soldier","pyro","demoman","heavy","engineer","medic","sniper","spy"] {
        let list=gib_definitions(&vpk,&format!("models/player/{}.mdl",if cls=="demoman" {"demo"} else {cls})).unwrap();let entries=list.as_array().unwrap();assert!(entries.len()>=5,"{cls}: break list");
        for (piece,entry) in entries.iter().enumerate() {let model=source_formats::model::load(&vpk,entry["model"].as_str().unwrap()).unwrap();
            let gib_physics=ragdoll_physics(&vpk,entry["model"].as_str().unwrap()).unwrap();
            assert!(!gib_physics["solids"].as_array().unwrap().is_empty());
            for solid in gib_physics["solids"].as_array().unwrap(){assert!(gib_physics["solids"].as_array().unwrap().len()==1 || model.bones.iter().any(|b|b.name.eq_ignore_ascii_case(solid["bone"].as_str().unwrap())),"gib physics bone mismatch {} {:?}: {}",entry["model"],model.bones.iter().map(|b|&b.name).collect::<Vec<_>>(),solid);}
            let folder=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/gib-fixtures");std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join(format!("{cls}.gib{piece}.physics.json")),serde_json::to_vec(&gib_physics).unwrap()).unwrap();
            std::fs::write(folder.join(format!("{cls}.gib{piece}.model")),crate::payload::encode(&model)).unwrap();
            for part in &model.body_parts {for sub in &part.models {for mesh in &sub.meshes {assert!(mesh.positions.iter().all(|v|v.is_finite()));assert!(mesh.indices.iter().all(|i|(*i as usize)<mesh.vertex_count()));}}}
        }
        let folder=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/gib-fixtures");std::fs::create_dir_all(&folder).unwrap();
        let path=entries[0]["model"].as_str().unwrap();std::fs::write(folder.join(format!("{cls}.mdl")),vpk.read(path).unwrap()).unwrap();
        std::fs::write(folder.join(format!("{cls}.model")),crate::payload::encode(&source_formats::model::load(&vpk,path).unwrap())).unwrap();
        let player_path=format!("models/player/{}.mdl",if cls=="demoman" {"demo"}else{cls});
        let physics=ragdoll_physics(&vpk,&player_path).unwrap();assert!(physics["joints"].as_array().unwrap().len()>10);
        std::fs::write(folder.join(format!("{cls}.physics.json")),serde_json::to_vec(&physics).unwrap()).unwrap();
        std::fs::write(folder.join(format!("{cls}.player.model")),crate::payload::encode(&source_formats::model::load(&vpk,&player_path).unwrap())).unwrap();
        eprintln!("{cls}: {} gibs, {} constraints",entries.len(),physics["joints"].as_array().unwrap().len());
    }}
}


pub fn physics_nodes(vpk:&VpkSet,path:&str)->Result<Vec<source_formats::kv::Node>,String>{
    let data=vpk.read(&path.replace(".mdl",".phy")).map_err(|e|e.to_string())?;
    let read=|offset:usize|->Result<usize,String>{let bytes=data.get(offset..offset+4).ok_or("Truncated PHY")?;Ok(u32::from_le_bytes(bytes.try_into().unwrap()) as usize)};
    let mut cursor=read(0)?;let solids=read(8)?;
    if cursor<16 || solids>1024 {return Err("Invalid PHY header".into());}
    for _ in 0..solids {cursor=cursor.checked_add(read(cursor)?).and_then(|v|v.checked_add(4)).ok_or("Invalid PHY size")?;}
    let text=std::str::from_utf8(data.get(cursor..).ok_or("Truncated PHY solids")?).map_err(|e|e.to_string())?.trim_end_matches('\0');
    source_formats::kv::parse(text).map_err(|e|e.to_string())
}
pub fn ragdoll_physics(vpk:&VpkSet,path:&str)->Result<serde_json::Value,String>{
    let nodes=physics_nodes(vpk,path)?;
    let mut solids=Vec::new();let mut joints=Vec::new();let mut pairs=Vec::new();let mut collision_rules=false;let mut self_collisions=true;
    for node in &nodes {let Some(block)=node.block() else {continue;};
        let text=|key:&str|source_formats::kv::find(block,key).and_then(source_formats::kv::Node::as_str).unwrap_or("");
        let number=|key:&str,default:f64|text(key).parse::<f64>().ok().filter(|v|v.is_finite()).unwrap_or(default);
        if node.key=="solid" {solids.push(serde_json::json!({"index":number("index",0.),"bone":text("name"),"mass":number("mass",1.)}));}
        if node.key=="ragdollconstraint" {joints.push(serde_json::json!({"parent":number("parent",0.),"child":number("child",0.),"min":[number("xmin",0.),number("ymin",0.),number("zmin",0.)],"max":[number("xmax",0.),number("ymax",0.),number("zmax",0.)],"friction":[number("xfriction",0.),number("yfriction",0.),number("zfriction",0.)]}));}
        if node.key=="collisionrules" {collision_rules=true;self_collisions=text("selfcollisions")!="0";for pair in block.iter().filter(|n|n.key=="collisionpair") {if let Some(value)=pair.as_str(){let values:Vec<u32>=value.split(',').filter_map(|v|v.trim().parse().ok()).collect();if values.len()==2 {pairs.push(values);}}}}
    }
    Ok(serde_json::json!({"solids":solids,"joints":joints,"collisionPairs":pairs,"collisionRules":collision_rules,"selfCollisions":self_collisions}))
}

/// The physics (ragdoll) description of a model, or an empty one when it has no .phy file.
pub fn model_physics(vpk: &VpkSet, path: &str) -> Result<serde_json::Value, String> {
    if !path.starts_with("models/") || !path.ends_with(".mdl") || path.contains("..") { return Err("Invalid physics model".into()); }
    if vpk.size_of(&path.replace(".mdl", ".phy")).is_none() { return Ok(serde_json::json!({"solids":[],"joints":[],"collisionPairs":[]})); }
    ragdoll_physics(vpk, path)
}

/// Particle definitions, texture sheets and model attachment metadata: only these kinds of files are served for the effect previews.
pub fn read_particle_asset(vpk: &VpkSet, path: &str) -> Result<Vec<u8>, String> {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    let allowed = (path.starts_with("particles/") && path.ends_with(".pcf"))
        || (path.starts_with("materials/") && (path.ends_with(".vtf") || path.ends_with(".vmt")))
        || (path.starts_with("models/") && path.ends_with(".mdl"));
    if !allowed || path.split('/').any(|part| part == "..") { return Err("Not a particle preview asset".into()); }
    vpk.read(&path).map_err(|e| e.to_string())
}

/// The fonts of the game that a camera overlay may use.
pub fn read_overlay_font(vpk: &VpkSet, path: &str) -> Result<Vec<u8>, String> {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    if !["resource/tf.ttf", "resource/tf2.ttf", "resource/tf2build.ttf", "resource/tf2secondary.ttf", "resource/tf2professor.ttf", "resource/tfd.ttf", "resource/ocra.ttf"].contains(&path.as_str()) {
        return Err("Not a supported TF2 overlay font".into());
    }
    vpk.read(&path).map_err(|e| e.to_string())
}
