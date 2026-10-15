//! Parsers for Source engine file formats. Pure Rust, no UI/Tauri dependency.

pub mod anim;
pub mod binary;
pub mod itemcompile;
pub mod propcompile;
pub mod items;
pub mod kv;
pub mod map_cubemaps;
pub mod material;
pub mod mdl;
pub mod model;
pub mod steam;
pub mod tga;
pub mod vmt;
pub mod vpk;
pub mod vtf;
pub mod vtf_write;
pub mod vtx;
pub mod vvd;
pub mod zipfs;
pub mod zipw;
pub mod workshop;
pub mod weapon;

pub use material::Material;
pub use model::{BodyPart, Mesh, Model, ModelError, SubModel};
pub use vpk::{ArchiveStats, DirListing, FileItem, IndexStats, VpkError, VpkSet};
