//! The cubemaps of the maps (taken from the maps' own cubemap files), kept in the program: they are in no game archive, and light a scene
//! like the game's cubemaps do. A name is `maps/<map>`.

macro_rules! maps {
    ($($name:literal),* $(,)?) => {
        /// The maps that have a cubemap here.
        pub const MAPS: &[&str] = &[$($name),*];
        /// The VTF of the cubemap of a map.
        pub fn get(map: &str) -> Option<&'static [u8]> {
            match map {
                $($name => Some(include_bytes!(concat!("../assets/map_cubemaps/", $name, ".vtf")) as &[u8]),)*
                _ => None,
            }
        }
    };
}

maps!(
    "2fort",
);
