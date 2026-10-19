//! Dumps a class model's body triangles (positions and UVs) and its body texture, for authoring body masks:
//! `cargo run -p source-formats --example dump_pyro -- <out dir> [class]`.
use std::io::Write;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = Path::new(&args[1]);
    let class = args.get(2).map(String::as_str).unwrap_or("pyro");
    let tf = source_formats::steam::find_tf2().expect("tf2 folder");
    let vpk = source_formats::VpkSet::open_folder(&tf).expect("vpks");
    let model = source_formats::model::load(&vpk, &format!("models/player/{class}.mdl")).expect("model");
    let mut f = std::fs::File::create(out.join("tris.txt")).unwrap();
    for bp in &model.body_parts {
        for (mi, m) in bp.models.iter().enumerate() {
            for mesh in &m.meshes {
                let mat = mesh.material.to_ascii_lowercase();
                for t in mesh.indices.chunks(3) {
                    let mut line = format!("{} {} {} ", bp.name, mi, mat.rsplit('/').next().unwrap_or(""));
                    for &i in t {
                        let i = i as usize;
                        line += &format!("{} {} {} {} {} ", mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2], mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]);
                    }
                    writeln!(f, "{line}").unwrap();
                }
            }
        }
    }
    let tex = format!("materials/models/player/{class}/{class}_red.vtf");
    let data = vpk.read(&tex).expect("texture");
    let img = source_formats::vtf::decode(&data, 0).expect("decode");
    std::fs::write(out.join("tex.rgba"), &img.rgba).unwrap();
    std::fs::write(out.join("tex.txt"), format!("{} {}", img.width, img.height)).unwrap();
    println!("{} body parts, texture {}x{}", model.body_parts.len(), img.width, img.height);
}
