//! Prints a file of the installed game's VPKs: `cargo run -p source-formats --example cat_vpk -- <path in the vpks>`;
//! `-- search:<prefix> <needle>` prints the paths under the prefix whose bytes hold the needle.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let tf = source_formats::steam::find_tf2().expect("tf2 folder");
    let vpk = source_formats::VpkSet::open_folder(&tf).expect("vpks");
    if let Some(prefix) = args[1].strip_prefix("search:") {
        let needle = args[2].as_bytes();
        for path in vpk.search(prefix, usize::MAX) {
            if let Ok(data) = vpk.read(path) {
                if data.windows(needle.len()).any(|w| w == needle) { println!("{path}"); }
            }
        }
        return;
    }
    let data = vpk.read(&args[1]).expect("file");
    use std::io::Write;
    std::io::stdout().write_all(&data).unwrap();
}
