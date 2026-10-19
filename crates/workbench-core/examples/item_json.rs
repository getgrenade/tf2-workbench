//! Prints an item's record as the interface gets it: `cargo run -p workbench-core --example item_json -- Earbuds`.
fn main() {
    let word = std::env::args().nth(1).unwrap_or_default().to_lowercase();
    let tf = source_formats::steam::find_tf2().expect("tf2 folder");
    let vpk = source_formats::VpkSet::open_folder(&tf).expect("vpks");
    let db = source_formats::items::load(&vpk).expect("items");
    let json: serde_json::Value = serde_json::from_slice(&workbench_core::payload::encode_items(&db)).unwrap();
    for item in json["items"].as_array().unwrap() {
        if item["displayName"].as_str().unwrap_or("").to_lowercase().contains(&word) { println!("{}", serde_json::to_string(item).unwrap()); }
    }
}
