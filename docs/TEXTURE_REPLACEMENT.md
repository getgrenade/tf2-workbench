# Replacing textures

The Textures panel lists the selected character and every cosmetic it wears. For each one it shows the materials, and for each material
every map it has:

- Diffuse, Normal, Exp mask
- Env mask, Self-illum, Detail, AO
- Light warp, Phong warp, Texture 2, Cornea

**Replace…** puts an image of your own in place of the map shown. It takes a .png, .jpg, .tga or .vtf. The backend decodes a .vtf (its
largest mip, the first frame) with `read_texture_file`; the interface decodes the rest.

The image is drawn everywhere that material is drawn, on every character, at once. It does this by changing the pixels of the texture
(`SourceMaterials.replaceTexture`) without rebuilding a material.

The image is scaled to the size of the map it replaces, which keeps the texture the GPU already holds. A normal map is scaled as normals,
and the map's wrap flags are kept.

Replaced maps are marked:

- a dot on the map's tab;
- "(edited)" after the material and after the character or cosmetic in the panel's lists;
- the file it came from at the bottom of the panel.

**Reset** puts the game's own map back. **Reset all** puts back every replaced map of every material.

`TextureOverrides` (`src/viewer/textureOverrides.ts`) keeps the game's pixels of each replaced map, so a map replaced twice still goes back
to the game's.

## Not done

- Replacements last for the session only. They are not saved with the scene.
- A material can only have the maps it already has replaced: an empty slot cannot be given a new map, because that would need a different
  shader.
- An animated texture's other frames (`base_f<N>`) are not replaced.
