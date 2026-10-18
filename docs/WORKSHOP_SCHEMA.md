# The workshop schema file

A workshop zip (the importer's output in `tf/workshop/import_source`) gives the catalog an item's name, its model and the
importer's manifest. Everything the game's own schema would add is missing: the item has no styles of its own, no particle
effect, no paint, no equip region beyond what the manifest guessed.

A file beside the zips fills that in, in items_game's own words:

- `tf/workshop/import_source/items_game.txt` (or `workbench_items.txt`, if the name could confuse the importer)

It is read on every workshop rescan (the refresh button, a drop, a change to the zips). One block per zip, keyed by the zip's
import name (its file name without `.zip`, case does not matter). Each part the block has replaces what the zip gave; the rest
stays. Blocks can sit at the top of the file, under `items`, or under `items_game` / `items` as the game's file has them.

```
"items"
{
    "cighat"
    {
        "item_name"     "The Cigarette Hat"
        "equip_region"  "hat"
        "capabilities"  { "paintable" "1" }
        "attributes"
        {
            "attach particle effect static" { "attribute_class" "set_attached_particle_static" "value" "28" }
        }
        "visuals"
        {
            "player_bodygroups" { "hat" "1" }
            "styles"
            {
                "0" { "name" "Lit" }
                "1" { "name" "Unlit" "model_player" "models/workshop/player/items/pyro/cighat_style/cighat_style.mdl" }
            }
            "attached_particlesystems"
            {
                "0" { "system" "headphone_notes" "attachment" "ear_L" }
            }
        }
    }
}
```

What is read:

- `item_name`: the title (a localization token of the game's, or the title itself).
- `item_slot`, `used_by_classes`, `model_player`, `model_player_per_class`, `image_inventory`.
- `equip_region` / `equip_regions`.
- `capabilities` / `paintable`.
- `visuals` / `player_bodygroups` and `additional_hidden_bodygroups`: the class bodygroups the item hides.
- `visuals` / `styles`: the item's styles. A style's model is a path inside a mounted zip, so a style that the importer made as a
  zip of its own is referenced here rather than guessed from its name. A zip the schema makes a style of another leaves the
  catalog, as the `_style` naming rule does.
- `attributes` / `static_attrs`: `attach particle effect static` and `attach particle effect` (an id of the game's table of
  attached particles: 28 is a pipe's smoke, 5 the Cheater's Lament's halo, any unusual effect id works too), and
  `player_skin_override`.
- `visuals` / `attached_particlesystems`: particle systems by name at an attachment of the item's model (the Earbuds' notes are
  `headphone_notes` at `ear_L` and `ear_R`).
- `visuals` / `player_poseparam`, and the extra models the game's items use.
- A `prefabs` block of the file's own adds to the game's prefabs; a block's `prefab` key resolves against both.
