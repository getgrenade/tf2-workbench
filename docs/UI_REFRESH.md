# Interface refresh

Where the interface stands, the layout it should move to, the tokens that carry the look, and the first panel done in it (Face sliders).

## 1. What is there

`main.ts` builds one `#app`: a `<header>` (title, Files / Viewer / Compiler / Settings, status, folder button) and the pages under it. The Viewer page is a grid: `#dockLeft` (290px, characters, class, bodygroups, effects, textures/cameras), `#viewMain` (`#sceneBar` with the scene tabs, then `#canvasWrap` with the floating view-mode buttons, tools, gizmo buttons and the play HUD), `#dockRight` (424px, cosmetics / weapons / compiler) and `#dockBottom` (250px, animation / face / lighting / particles tabs). Most panels are `.panel` blocks of `h3` + loose controls, each with its own row CSS.

What makes it feel unrefined, in order of effect: the accent colour is on tabs, borders, sliders, chips, cards and headings at once; every panel lays its own rows out; sections cannot be folded; the scene tabs sit inside the viewport column.

## 2. Target layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ header: app · Files Viewer Compiler Settings │ Scene 1 | Scene 2 | + │ stats │
├───────────┬───────────────────────────────────────────────┬───────────────┤
│ left dock │                 3D viewport                   │ right dock    │
│ (fold ◂)  │  (view modes, gizmos, play HUD: translucent   │ (fold ▸)      │
│           │   overlays, full opacity on hover)            │               │
│ sections  ├───────────────────────────────────────────────┤ cosmetics /   │
│ as        │ bottom dock: Animation · Face · Light · FX    │ weapons /     │
│ accordions│ (fold ▾)                                      │ compiler      │
└───────────┴───────────────────────────────────────────────┴───────────────┘
```

Modules (each is a small `create…Ui` like the ones already in `src/viewer`):

| Piece | Today | Change |
| --- | --- | --- |
| Header | `<header>` in `main.ts` | takes the scene tabs from `#sceneBar` (the `sceneTabs.ts` strip mounts into the header instead) |
| Docks | fixed grid columns, `--dockH` for the bottom | each dock gets a fold handle; the grid columns/rows read `--dockL`, `--dockR`, `--dockH`, and a folded dock is 0 / 28px |
| Viewport overlays | opaque buttons over the canvas | `opacity: .55` at rest, 1 on hover/focus of the group; the play HUD stays as it is |
| Sections | `h3` + controls | `.ui-acc` (header + body) from `tokens.css`; open state remembered per section in `localStorage` |
| Rows | one-off CSS per panel | `.ui-prop` (key column + control) for every property |
| Tags | `.chip` in several sizes | `.ui-chip` |
| Cards | `.tile`, `.equip`, weapon tiles | `.ui-card` in a `.ui-grid` |

Status: tokens, rows, accordions (`src/accordion.ts`, used by the left dock, the lighting/post sections, the pose parameters and the compiler), cards, scene tabs in the header, foldable docks (handles on the view edges, remembered) and translucent view overlays are done. The cosmetics/weapons sections of the right dock are not foldable yet. The order the work was done in: tokens (done) → rows (Face done; Lighting, Animation, Compiler next) → accordions for the left dock → cards → header scene tabs → dock folding → overlay opacity.

## 3. Tokens

`src/tokens.css`, imported before `style.css`. Neutral scale `--ui-canvas #1a1a1e`, `--ui-panel #222226`, `--ui-raised #27272c`, `--ui-input #2a2a30`, `--ui-hover #32323a`; lines are `rgba(255,255,255,.07)`; text `#d9dbe0` / `#9096a2`; one accent `#e08a3c` with a soft (16%) and a line (70%) variant; spacing on a 4px grid (`--ui-1`…`--ui-7`, row gap 6px, row height 22px, label column 96px, value column 44px); radii 3/4/6; Inter / Segoe UI for text and JetBrains Mono / Consolas for numbers with tabular figures.

The old `--bg --panel --line --fg --dim --accent` names are now aliases of these, so the whole interface already takes the new palette; the accent is what is left to thin out as each panel is moved to the shared classes (borders and headings that are `var(--accent)` today become `--ui-text-dim` or `--ui-line-strong`; only the active tab, the selected card, focus and the thing being dragged keep it).

## 4. The first panel: Face sliders

`flexUi.ts` builds each controller as

```html
<div class="ui-prop">
  <span class="ui-key">brow_up</span>
  <div class="ui-val"><input type="range" class="ui-range"><input type="number" class="ui-num"></div>
</div>
```

The key column is a fixed width and ellipsised (the full name is the tooltip), the slider takes the rest, the number box is a fixed monospaced column so the values line up down the page, and rows are 22px tall with 6px between them. The list is a grid of 300px columns, so a wide bottom dock gets two or three columns and a narrow one gets one. The same three classes serve any property: a select or toggle goes in `.ui-val.single`.

## 5. The bottom dock is fixed at 312px

The drag handle is gone; `--dockH` in `style.css` is the height (312px: 255px of content under the tab strip). It was picked by measuring each tab in the headless browser at dock widths 652 / 886 / 1206 px (1366 / 1600 / 1920 px windows):

| Tab | Natural content | At 312px |
| --- | --- | --- |
| Animation | transport on one row (play, speed, loop, frame), scrub bar, pose parameters in two columns: ten parameters take 5 rows | fits from 886 px wide; one column (and scrolling) below |
| Flex, Pose Library | lists that scroll (controllers in 250px columns, pose grid) | fill the dock |
| Lighting (simple or advanced) | 222 to 320 px | fits from 886 px wide, scrolls a little below |
| Particles | 185 px | fits |
| Post-processing | tallest column (Fresnel rim light: a colour and seven sliders) 251 px with four columns across | fits from 1206 px wide; at 886 px it is four columns with about 40px of scroll; below that it wraps to two rows and scrolls |

Less than 312 makes Post-processing scroll on a 1080p screen; more takes view height for nothing. The next saving is in Post-processing itself (the rim section is the one that sets the height).
