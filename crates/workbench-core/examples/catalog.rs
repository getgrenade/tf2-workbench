//! Prints the entries of the unusual effect catalog whose system or name holds a word: `cargo run -p workbench-core --example catalog -- notes`.
fn main() {
    let word = std::env::args().nth(1).unwrap_or_default().to_lowercase();
    let tf = source_formats::steam::find_tf2().expect("tf2 folder");
    let vpk = source_formats::VpkSet::open_folder(&tf).expect("vpks");
    for e in workbench_core::game::unusual_effects(&vpk).expect("catalog") {
        if e.system.to_lowercase().contains(&word) || e.name.to_lowercase().contains(&word) {
            println!("{} {:?} {} kind={} file={:?} attachment={:?} root_bone={}", e.id, e.name, e.system, e.kind, e.file, e.attachment, e.root_bone);
        }
    }
}
