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

# Editing a material's VMT

Under the maps, the Textures panel shows the VMT of the material that is selected, as the game has it, and lets you edit it.

**Live drawing.** What you type is drawn on the model a moment after you stop typing (`material_from_text` parses it with
`material::from_text`), on every character and cosmetic that uses the material (`Actor.replaceMaterial`).

- A `patch` VMT still reads the material it includes from the game.
- Paint, conditions and replaced maps carry over to the new material.
- Text that does not parse is not drawn: the panel shows the error and the last good text stays on the model.
- A texture the text names but the game does not have is reported under the text, and the material is drawn without it.

**Marking and reset.** An edited material is marked "edited" in the editor's header, and "(edited)" in the panel's lists. **Reset VMT**
puts the game's material and its text back. `VmtEdits` (`src/viewer/vmtEdits.ts`) keeps the game's material and text for that.

**Not done.** Edits last for the session only, like replaced maps. Eyes (`eyerefract`) keep the material they were made with.
