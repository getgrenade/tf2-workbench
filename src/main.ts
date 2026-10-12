import { open } from "@tauri-apps/plugin-dialog";
import "./tokens.css";
import { accordify } from "./accordion";
import { createDocks } from "./dock/dock";
import { PANEL_DEFS, defaultLayout } from "./dock/defaultLayout";
import { openMenu } from "./viewer/popMenu";
import "./style.css";
import { findTf2, indexTf2 } from "./api";
import { createViewTab } from "./viewer/tab";
import { createSettingsUi } from "./settingsUi";
import { createPoseHud } from "./viewer/poseHud";
import { openOverlaySettings } from "./viewer/overlaySettings";
import { loadSettings, onSettingsChange } from "./settingsStore";
import { startUiScale } from "./uiScale";
import { codeName, binding, hotkeyMatches } from "./hotkeys";
import { applyTheme } from "./theme";
import { installSliderWheel } from "./sliderWheel";
import { installNoNativeMenu } from "./noNativeMenu";

// the web build (see vite.config.ts) is the same app without what needs the desktop: the style sheet hides those controls under this class
if (__WEB__) document.documentElement.classList.add("web");
const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <button id="sceneMenu" hidden class="barBtn" title="Scene: save or load a scene file" aria-label="Scene menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <button id="layoutMenu" hidden class="barBtn" title="Layout: show or hide the panels, put the layout back as it was" aria-label="Layout menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.500"/><path d="M9 4v16M9 12h12"/></svg></button>
    <nav>
      <button id="tabView" class="on">Viewer</button>
      <button id="tabCompiler">Compiler</button>
      <button id="tabSettings">Settings</button>
    </nav>
    <span id="barSep" hidden></span>
    <div id="sceneBar" hidden><div id="sceneTabs"></div><span id="shotStatus" class="dim"></span></div>
    <div class="headerInfo"><span class="stat" id="status">Looking for TF2…</span><div id="viewerStats" hidden></div></div>
    <span style="flex:1"></span>
    <button id="pick">Choose TF2 folder…</button>
  </header>
  <div id="settings" hidden></div>
  <div id="view" hidden>
    <aside id="dockLeft" class="panel dock" data-dock="left">
      <section id="panelOutliner" class="dockSection">
      <h3 class="first">Outliner</h3>
      <div id="entList" class="entList"><button id="entAdd" data-hier-bar aria-haspopup="menu" title="Add a character, a buildable, a light, a camera or a folder">+ Add</button></div>
      </section>
      <section id="panelProperties" class="dockSection">
      <h3 class="propsHead">Properties</h3>
      <div id="propTransform" class="propTransform"></div>
      <div id="propEmpty" class="propEmpty dim" hidden>Nothing is selected. Click something in the view or in the outliner.</div>
      <div id="propChar">
      <div id="buildPanel" class="buildPanel" hidden></div>
      <div id="classBlock"><label>Class</label>
      <div id="cls" class="classes"></div></div>
      <div class="teams"><button id="teamRed" class="team red">RED</button><button id="teamBlu" class="team blu">BLU</button></div>
      <label hidden><input type="checkbox" id="wire" /> Wireframe</label>
      <div id="bodyBlock">
      <h3 class="bgHead">Bodygroups <button id="bodyReset" title="Back to what the cosmetics set (or the default)">Reset</button></h3>
      <div id="bodyGroups" class="bodyGroups"></div>
      <div id="lodBar" class="lodBar" hidden></div>
      </div>
      <div id="effectsBlock">
      <h3 class="bgHead">Effects <button id="condReset" title="Clear every effect on the selected character">Clear</button></h3>
      <div id="conditions" class="conditions"></div>
      </div>
      <div id="info"></div>
      </div>
      <div id="propLight" class="lightPane lightProps" hidden></div>
      <div id="propCamera" class="propCamera" hidden></div>
      <div id="overlayProps" class="overlayProps" hidden></div>
      <div id="propEffect" class="lightPane lightProps propEffect" hidden>
        <section class="lightCol" data-effect="shadow" hidden>
          <h3>Ground shadows <button id="shadowReset" title="Reset the shadow settings">Reset</button></h3>
          <div class="checks"><label><input type="checkbox" id="shadowOn" checked /> Ground shadow</label></div>
          <label class="slider">Direction <output></output><input type="range" id="shadowAz" min="0" max="360" step="1" value="32" /></label>
          <label class="slider">Length <output></output><input type="range" id="shadowLen" min="0" max="4" step="0.05" value="0.8" /></label>
          <label class="slider">Blur <output></output><input type="range" id="shadowBlur" min="0" max="30" step="0.5" value="0.5" /></label>
          <label class="slider">Opacity <output></output><input type="range" id="shadowOpacity" min="0" max="1" step="0.01" value="0.8" /></label>
        </section>
        <section class="lightCol" data-effect="fog" hidden>
          <h3>Fog <button id="fogReset" title="Reset the fog settings">Reset</button></h3>
          <div class="checks"><label title="A fog in the scene, measured from the floor in character heights: it keeps its place when the camera moves or zooms, and shows in screenshots"><input type="checkbox" id="fogOn" /> Gradient fog</label></div>
          <div class="checks"><label title="Off: the fog lies in the world, measured from the floor. On: it lies over the picture, from its bottom edge to its top edge, and stays put as the camera moves"><input type="checkbox" id="fogView" /> Follow the view</label></div>
          <label class="colorRow">Colour <input type="color" id="fogColor" value="#bdbdbd" /></label>
          <label class="slider">Floor density <output></output><input type="range" id="fogBottom" min="0" max="1" step="0.01" value="0.28" /></label>
          <label class="slider">High density <output></output><input type="range" id="fogTop" min="0" max="1" step="0.01" value="0" /></label>
          <label class="slider">Height <output></output><input type="range" id="fogMid" min="0" max="2" step="0.01" value="0" /></label>
          <label class="slider">Softness <output></output><input type="range" id="fogSoft" min="0.02" max="1" step="0.01" value="0.76" /></label>
          <div class="dim hint">The fog button on a character's row in the list keeps it clear of the fog.</div>
        </section>
        <section class="lightCol" data-effect="ao" hidden>
          <h3>Ambient occlusion <button id="aoReset" title="Reset the occlusion settings">Reset</button></h3>
          <div class="checks"><label title="Darkens creases and contact points from the depth of the picture, after the shading, so the materials stay as they are; screenshots include it"><input type="checkbox" id="aoOn" /> Ambient occlusion</label></div>
          <label class="slider">Strength <output></output><input type="range" id="aoStrength" min="0" max="1" step="0.01" value="0.8" /></label>
          <label class="slider">Radius <output></output><input type="range" id="aoRadius" min="0.01" max="0.5" step="0.01" value="0.12" /></label>
          <label class="slider">Contrast <output></output><input type="range" id="aoPower" min="0.5" max="4" step="0.05" value="1.5" /></label>
          <div class="dim hint">Radius is in character heights.</div>
        </section>
        <section class="lightCol" data-effect="rim" hidden>
          <h3>Fresnel rim light <button id="rimReset" title="Reset rim light settings">Reset</button></h3>
          <div class="checks"><label><input type="checkbox" id="rimOn" /> Rim light</label><label><input type="checkbox" id="rimAll" /> All around</label><label title="Turn the soft Fresnel falloff into a solid painted band"><input type="checkbox" id="rimPainted" /> Painted rim</label></div>
          <label class="colorRow">Colour <input type="color" id="rimColor" value="#ffffff" /></label>
          <label class="slider">Strength <output></output><input type="range" id="rimStrength" min="0" max="8" step=".05" value="3" /></label>
          <label class="slider">Edge width <output></output><input type="range" id="rimWidth" min=".02" max="1" step=".01" value=".3" /></label>
          <label class="slider" title="Direction in the camera view: 0° right, 90° top, ±180° left"><span>Direction</span><output></output><input type="range" id="rimDirection" min="-180" max="180" step="1" value="0" /></label>
          <label class="slider">Spread <output></output><input type="range" id="rimSoftness" min="0" max="1" step=".01" value=".65" /></label>
          <label class="slider" title="Higher cutoff gives a thinner painted band">Line cutoff <output></output><input type="range" id="rimCutoff" min=".01" max=".99" step=".01" value=".25" /></label>
          <label class="slider" title="Zero gives a crisp edge with pixel antialiasing">Edge softness <output></output><input type="range" id="rimEdgeSoftness" min="0" max=".5" step=".01" value="0" /></label>
          <div class="dim hint">Follows the viewport or active camera. 0° right, 90° top, ±180° left. Included in screenshots.</div>
        </section>
      </div>
      <div id="camerasPane" class="camerasPane" hidden></div>
      </section>
      <section id="panelTextures" class="dockSection">
      <h3 class="first">Textures</h3>
      <div id="texturesPane">
      <div id="texView" class="texView"></div>
      <div id="cosmeticStats" class="cosStats"></div>
      </div>
      </section>
      <section id="compilerPane" class="dockSection compilerPane" hidden></section>
    </aside>
    <div id="viewMain">
    <div id="canvasWrap">
      <div id="compilerFlyout" class="panel compilerPane"></div>
      <button id="flyoutToggle" title="Hide / show the materials" aria-label="Hide or show the materials"></button>
      <div id="flyoutGrip" title="Drag to change the width of the panel (double-click: the usual width)" role="separator" aria-orientation="vertical"></div>
      <div id="iconFrame" hidden>
        <i class="iconCut" style="top:0;height:17.7734%"></i><i class="iconCut" style="top:82.0313%;bottom:0"></i>
        <i id="iconFadeBand"></i>
        <i class="iconLine" style="top:17.7734%"></i><i class="iconLine" style="top:82.0313%"></i><span class="iconTag">512 × 512</span>
      </div>
      <div id="iconFade" hidden>
        <label class="iconFadeSwitch" title="Eases the bottom of the picture out inside the safe zone, so the cut at the lower line is not a hard edge"><input type="checkbox" id="iconFadeOn" /> Fade the bottom</label>
        <label class="iconFadeRow" title="How many rows (of 512) the fade takes, up from the lower line">Height <input type="range" class="ui-range" id="iconFadeHeight" min="0" max="200" step="1" /><input type="number" id="iconFadeHeightNumber" min="0" max="329" step="1" /></label>
        <label class="iconFadeRow" title="1 is a straight ramp; more keeps the picture solid longer and drops faster at the end, less drops early">Curve <input type="range" class="ui-range" id="iconFadeCurve" min="0.3" max="4" step="0.1" /><input type="number" id="iconFadeCurveNumber" min="0.1" max="8" step="0.1" /></label>
        <div class="dim">Outside the lines the picture is cut away.</div>
      </div>
      <div id="iconBar" hidden><span class="dim">Keep the item between the lines</span><button id="iconCreate">Create backpack icon</button><span id="iconStatus" class="dim"></span></div>
      <div id="viewHeader">
      <div id="viewModes">
        <button id="hudGrid" title="Show / hide the floor grid" aria-label="Floor grid"></button>
        <button id="hudOutline" title="Show / hide the outline around what is selected" aria-label="Selection outline"></button>
        <button id="hudLights" title="Show / hide the light indicators (click one to edit that light)" aria-label="Light indicators"></button>
        <button id="modeWire" title="Wireframe: the edges drawn over the view" aria-label="Wireframe"></button>
        <button id="viewOverlaysMore" class="moreBtn" aria-haspopup="true" aria-expanded="false" title="Settings of the wireframe, the floor grid and the selection outline" aria-label="Overlay settings"><svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="sep"></span>
        <button id="modeShaded" title="Shaded: the materials as lit in the game" aria-label="Shaded"></button>
        <button id="modeDiffuse" title="Diffuse: just the base texture colour, unlit" aria-label="Diffuse"></button>
        <button id="modeGray" title="Grayscale: the lit picture without colour, to read the values" aria-label="Grayscale"></button>
      </div>
      </div>
      <div id="viewActions" hidden></div>
      <div id="viewPlayHint" role="status" hidden><kbd aria-label="Escape key">Esc</kbd><span>TO EXIT PLAY MODE</span></div>
      <div id="viewTools">
      </div>
      <div id="viewToolbar">
      <div id="viewSelect"><button id="boxSelect" title="Box select: stays on until you switch it off. The Q key does one box and switches itself off. Drag in the view to select what the box covers. Shift adds, Ctrl takes away. Alt + drag still orbits" aria-label="Box select" aria-pressed="false"></button></div>
      <div id="gizmoParts"><button id="gizMove" title="Move gizmo (W); edit by mouse (Shift+W); reset position (Alt+W)" aria-label="Move gizmo"></button><button id="gizRotate" title="Rotation gizmo (E); edit by mouse (Shift+E); reset rotation (Alt+E)" aria-label="Rotation gizmo"></button><button id="gizScale" title="Scale gizmo (R); edit by mouse (Shift+R); reset scale (Alt+R)" aria-label="Scale gizmo"></button><button id="gizView" title="View Rotation Gizmo: a ring that turns the control about your line of sight, with a dot in the middle to drag the control around in the view plane" aria-label="View Rotation Gizmo"></button><button id="gizOrient" title="" aria-label="Gizmo orientation"></button></div>
      <div id="viewFocus"><button id="focusFace" title="Focus on the selected character's face" aria-label="Focus face"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path fill="currentColor" stroke="none" d="M12 6.5c2.7 0 4 2.1 4 4.8 0 3.2-1.7 5.7-4 5.7s-4-2.5-4-5.7c0-2.7 1.3-4.8 4-4.8z"/></svg></button><button id="focusBody" title="Frame the selected character" aria-label="Frame character"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path fill="currentColor" stroke="none" d="M12 6a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 12 6zM7 18l.5-4.3c.2-1.7 1.8-2.9 4.5-2.9s4.3 1.2 4.5 2.9L17 18h-2.5v-3.5L14 18h-4l-.5-3.5V18z"/></svg></button><button id="focusAll" title="Frame all characters" aria-label="Frame all characters"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path d="m8.5 17 3.5-9.5 3.5 9.5M9.8 13.8h4.4"/></svg></button></div>
      <div id="viewCapture"><button id="shot" title="Screenshot: saves a PNG of the view (size and transparency are in Settings)" aria-label="Screenshot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.500-2.500h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.500"/></svg></button><button id="shotPsd" title="Layered PSD: saves a Photoshop file with the post-processing effects on layers of their own, with the blend modes that put them back (size is in Settings)" aria-label="Layered PSD"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-9 5 9 5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg></button><button id="shotVideo" title="Video: records the view or a turntable round the character as MP4, WebM or an optimized GIF (never larger than the view)" aria-label="Video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10.500 5-3v9l-5-3"/></svg></button><button id="paintChart" title="Paint chart: one picture of the inspected cosmetic per paint, laid out in an editor (open a paintable cosmetic with Inspect first)" aria-label="Paint chart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></svg></button></div>
      </div>
      <div id="dockFolds">
        <button id="foldL" class="foldBtn" title="Fold the left panel" aria-label="Fold the left panel"></button>
        <button id="foldR" class="foldBtn" title="Fold the right panel" aria-label="Fold the right panel"></button>
        <button id="foldB" class="foldBtn" title="Fold the bottom panel" aria-label="Fold the bottom panel"></button>
      </div>
      <div id="viewHud">
        <button id="hudPlay" title="Play / pause the animation of the selected character (Space)" aria-label="Play or pause"></button>
        <button id="hudPose" title="Enter / exit pose mode: freezes the current frame into an editable pose" aria-label="Pose mode"></button>
        <button id="hudGame" title="Play mode: steer the character like in the game" aria-label="Play mode"></button>
      </div>
    </div>
    </div>
    <aside id="dockRight" class="panel dock" data-dock="right">
      <section id="cosmeticsPane" class="dockSection">
      <h3 class="first">Cosmetics</h3>
      <div class="row2"><input id="itemSearch" class="text" placeholder="Search cosmetics…" spellcheck="false" /><button id="itemsClear" title="Remove all cosmetics">Clear</button></div>
      <div id="itemScopes" class="slotBtns"><button data-scope="solo" class="on" title="Items made for this class only">Class</button><button data-scope="shared" title="Items several classes (or all) can wear">All-class</button><button data-scope="workshop" title="Your own cosmetics from the workshop importer (tf/workshop/import_source), for this class">Workshop</button></div>
      <div id="itemRegions" class="regionBtns"></div>
      <div id="itemTools" class="row2"><button id="itemSelectAll" title="Select every equipped cosmetic, then pick one paint for all of them">Select all</button></div>
      <div id="itemEquipped" class="chips"></div>
      <div id="itemList" class="itemlist"></div>
      <div class="itemFoot" id="itemFoot"><button id="itemMedals" class="iconBtn" title="Show medals &amp; badges" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M6.500 2h4l1.500 6.500-3 1.500zM17.500 2h-4L12 8.500l3 1.500z"/><circle cx="12" cy="15.500" r="6"/></svg></button><button id="itemWorkshopRefresh" class="iconBtn" title="Reload the workshop cosmetics from tf/workshop/import_source (this also happens when you come back to this window and the zips changed)" aria-label="Reload workshop cosmetics"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.5-5.800M20 4v5h-5"/></svg></button><span id="itemCount" class="dim hint"></span></div>
      </section>
      <section id="weaponsPane" class="dockSection">
        <h3 class="first">Weapons</h3>
        <div class="row2"><input id="weaponSearch" class="text" placeholder="Search weapons…" spellcheck="false" /><button id="weaponsClear" title="Put the weapon away">Clear</button></div>
        <div id="weaponSlots" class="slotBtns"><button data-slot="taunt" title="Taunts with a prop; picking one plays the taunt">Taunt</button><button data-slot="primary" class="on">Primary</button><button data-slot="secondary">Secondary</button><button data-slot="melee">Melee</button><button data-slot="utility" title="PDAs, sappers, toolbox, disguise kit">Utility</button></div>
        <div id="weaponList" class="itemlist"></div>
        <div class="itemFoot" id="weaponFoot"><span id="weaponCount" class="dim hint"></span></div>
      </section>
    </aside>
    <aside id="dockBottom" class="panel dock" data-dock="bottom">
      <section id="lightSetupsPane" class="lightPane lightSetupsPane" hidden><section id="lightSetupsBody" class="lightCol lightSetups"></section></section>
      <div id="particlesPane" class="particlesPane" hidden>
        <div id="unusualBar" class="particleFind"><input id="unusualSearch" class="text" placeholder="Filter unusual effects by name or ID…" aria-label="Filter unusual effects" /></div>
        <div class="particlePickers">
          <div><label for="unusualHat">Hat effect</label><div class="particlePickerRow"><select id="unusualHat" aria-label="Hat unusual effect"><option value="">None</option><option value="silver">Silver Serenade</option></select><button id="unusualHatClear" title="Remove hat effect" aria-label="Remove hat effect" disabled>×</button></div></div>
          <div><label for="unusualTaunt">Taunt effect</label><div class="particlePickerRow"><select id="unusualTaunt" aria-label="Taunt unusual effect"><option value="">None</option><option value="arctic">Arctic Delight</option></select><button id="unusualTauntClear" title="Remove taunt effect" aria-label="Remove taunt effect" disabled>×</button></div></div>
        </div>
        <div class="row2"><button id="unusualLoadZip" title="Adds an effect from a .zip (a folder tree with particles/*.pcf and the materials it uses). It is kept by the app and shows up in both pickers under Custom effects.">Load custom effect (.zip)…</button></div>
        <div id="unusualCustom" class="particleCustom"></div>
        <div id="unusualCatalog" class="dim hint">Loading the installed unusual catalog…</div>
      <div class="dim hint">Effects load from installed TF2. New previews use Source simulation; game lighting and world collisions may differ.</div>
        <div class="row2"><button id="unusualRestart">Restart effects</button></div>
        <div id="unusualStatus" class="dim hint" role="status"></div>
      </div>
      <div id="animPane" class="animPane">
      <div class="animCol">
        <div class="seqFilter"><input id="seqSearch" class="text" placeholder="Filter sequences (e.g. stand, run, attack)" spellcheck="false" /><label class="inline-check seqJunk" title="Leaves out the sequences that are of no use for showing a character: aim matrices, gestures, reloads, ragdoll, hand and arm poses, swimming"><input type="checkbox" id="hideJunk" checked /> Hide junk</label></div>
        <select id="seqList" size="6"></select>
      </div>
      <div class="animCol">
        <div class="row2"><button id="play">Pause</button> <button id="rewind" title="Back to frame 0 (Ctrl+click: every character)" aria-label="Back to frame 0">⏮</button> <select id="speed"><option value="0.1">0.1x</option><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select> <label class="inline"><input type="checkbox" id="loopAll" checked /> Loop</label> <label class="inline" title="Play taunts over the weapon pose, as the game does, so they blend in and out. Off: the animation exactly as its file holds it."><input type="checkbox" id="blendTaunts" checked /> Blend taunts</label><div id="frameLabel" class="dim hint"></div></div>
        <input type="range" id="scrub" min="0" max="1" step="0.01" value="0" />
        <h3>Pose parameters <span><button id="paramsReset" title="Engine defaults: zero state where the range spans zero, else the middle">Defaults</button> <button id="paramsZero" title="All parameters at the low end of their range, which is how hlmv starts">hlmv 0</button></span></h3>
        <div id="poseParams"></div>
      </div>
      </div>
      <div id="posePane" class="posePane" hidden>
        <div class="poseLibBar">
          <input id="poseName" class="text" placeholder="Name (optional)" spellcheck="false" />
          <button id="poseSave" title="Save the whole pose of the selected character, with a thumbnail">Capture pose</button>
          <button id="poseSaveHand" title="Select a hand in pose mode to save its fingers" disabled>Capture hand pose</button>
          <span class="grow"></span>
          <button id="poseFolder" title="Open the poses folder: copy poses in or out of it to share them">Open folder</button>
        </div>
        <div class="poseFindBar">
          <input id="poseSearch" class="text" placeholder="Search poses…" spellcheck="false" />
          <div id="poseFilter" class="slotBtns"><button data-f="" class="on">All</button><button data-f="pose">Poses</button><button data-f="hand">Hands</button></div>
        </div>
        <div id="poseStatus" class="dim hint"></div>
        <div id="poseLibrary" class="itemlist poseList"></div>
        <div class="itemFoot" id="poseFoot"><span id="poseCount" class="dim hint"></span></div>
      </div>
      <div id="lightPane" class="lightPane" hidden>
        <section class="lightCol worldView" id="worldView">
          <h3>Scene</h3>
          <label class="colorRow" title="The colour behind the scene; a skybox covers it"><span>Background</span> <input type="color" id="bgColor" value="#404040" /></label>
          <label class="slider" title="How far apart the characters stand">Spacing <output></output><input type="range" id="entSpacing" min="30" max="200" step="1" value="72" /></label>
          <label class="slider" title="Horizontal field of view in degrees, as a camera's own setting">Field of view <output></output><input type="range" id="fov" min="10" max="100" step="1" value="30" /></label>
          <div class="checks"><label title="The hair, scarves and other loose parts of the characters swing with their movement"><input type="checkbox" id="jiggle" checked /> Jiggle bones</label></div>
        </section>
        <section class="lightCol" hidden>
          <h3>Light <button id="lightReset" title="Reset light">Reset</button></h3>
          <label class="slider">Azimuth <output></output><input type="range" id="azimuth" min="0" max="360" step="1" value="0" /></label>
          <label class="slider">Elevation <output></output><input type="range" id="elevation" min="-89" max="89" step="1" value="0" /></label>
          <label class="slider">Intensity <output></output><input type="range" id="intensity" min="0" max="3" step="0.05" value="1" /></label>
          <label class="colorRow">Colour <input type="color" id="lightColor" value="#ffffff" /></label>
          <label class="slider">Ambient <output></output><input type="range" id="ambient" min="0" max="1" step="0.01" value="0.3" /></label>
          <label class="colorRow">Ambient colour <input type="color" id="ambientColor" value="#ffffff" /></label>
          <div class="checks">
            <label title="The light turns with the camera, as in hlmv"><input type="checkbox" id="follow" checked /> Follows camera</label>
            <label><input type="checkbox" id="gizmo" /> Show marker</label>
          </div>
          <div class="dim hint">Shift + drag in the view aims the light.</div>
        </section>
        <section class="lightCol" hidden>
          <h3>Point light <button id="pointReset" title="Reset the point light">Reset</button></h3>
          <div class="checks">
            <label><input type="checkbox" id="pointOn" /> Enabled</label>
            <label title="Drag its arrows in the view to move the light (Ctrl + drag also works)"><input type="checkbox" id="pointMarker" checked /> Marker &amp; gizmo</label>
          </div>
          <label class="slider">Azimuth <output></output><input type="range" id="pointAz" min="0" max="360" step="1" value="45" /></label>
          <label class="slider">Elevation <output></output><input type="range" id="pointEl" min="-89" max="89" step="1" value="20" /></label>
          <label class="slider">Distance <output></output><input type="range" id="pointDist" min="0.2" max="4" step="0.05" value="1.2" /></label>
          <label class="slider">Radius <output></output><input type="range" id="pointRange" min="0.2" max="8" step="0.05" value="2.5" /></label>
          <label class="slider">Falloff <output></output><input type="range" id="pointFalloff" min="0.2" max="6" step="0.1" value="1.5" /></label>
          <label class="slider">Intensity <output></output><input type="range" id="pointInt" min="0" max="6" step="0.05" value="1.5" /></label>
          <label class="colorRow">Colour <input type="color" id="pointColor" value="#ffffff" /></label>
          <div class="dim hint">Distance and radius are in model sizes.</div>
        </section>
      </div>
      <div id="overlayPane" class="postPane overlayPane" hidden>
        <div class="postHead"><span class="dim">Overlay of the camera</span><span class="overlayButtons"><button id="overlayEdit" disabled>Edit</button> <button id="overlayAdd" aria-haspopup="menu" title="Add a border, a picture, an icon or a text to the overlay" disabled>+ Add</button></span></div>
        <div id="overlayList" class="entList hier postList"></div>
        <div id="overlayHint" class="dim hint overlayHint"></div>
        <div id="overlayGrid" class="overlayGrid" hidden></div>
      </div>
      <div id="postPane" class="postPane" hidden>
        <div class="postHead"><span class="dim">Effects in the scene</span><button id="postAdd" aria-haspopup="menu" title="Add an effect to the scene">+ Add</button></div>
        <div id="postList" class="entList hier postList"></div>
      </div>
      <div id="flexPane" class="flexPane" hidden>
        <div id="flexList" class="flexList"></div>
        <div class="flexFooter"><button id="flexReset" title="Every controller back to 0 (double-click a slider to reset just that one)">Reset</button></div>
      </div>
    </aside>
  </div>
`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function showIndex() {
  status.textContent = "";
  indexed = true;
  if (!$("view").hidden) void viewTab.onIndexed();
}

let indexed = false;
const poseHud = createPoseHud($("canvasWrap"));
const viewTab = createViewTab({
  wrap: $("canvasWrap"),
  classes: $("cls"),
  wire: $<HTMLInputElement>("wire"),
  jiggle: $<HTMLInputElement>("jiggle"),
  fov: $<HTMLInputElement>("fov"),
  info: $("info"),
  azimuth: $<HTMLInputElement>("azimuth"),
  elevation: $<HTMLInputElement>("elevation"),
  intensity: $<HTMLInputElement>("intensity"),
  lightColor: $<HTMLInputElement>("lightColor"),
  ambient: $<HTMLInputElement>("ambient"),
  ambientColor: $<HTMLInputElement>("ambientColor"),
  follow: $<HTMLInputElement>("follow"),
  gizmo: $<HTMLInputElement>("gizmo"),
  ao: {
    on: $<HTMLInputElement>("aoOn"),
    strength: $<HTMLInputElement>("aoStrength"),
    radius: $<HTMLInputElement>("aoRadius"),
    power: $<HTMLInputElement>("aoPower"),
    reset: $<HTMLButtonElement>("aoReset"),
  },
  rimLight: {
    on: $<HTMLInputElement>("rimOn"), allAround: $<HTMLInputElement>("rimAll"), color: $<HTMLInputElement>("rimColor"),
    strength: $<HTMLInputElement>("rimStrength"), width: $<HTMLInputElement>("rimWidth"), direction: $<HTMLInputElement>("rimDirection"), softness: $<HTMLInputElement>("rimSoftness"), reset: $<HTMLButtonElement>("rimReset"),
    painted: $<HTMLInputElement>("rimPainted"), cutoff: $<HTMLInputElement>("rimCutoff"), edgeSoftness: $<HTMLInputElement>("rimEdgeSoftness"),
  },
  fog: {
    on: $<HTMLInputElement>("fogOn"),
    color: $<HTMLInputElement>("fogColor"),
    top: $<HTMLInputElement>("fogTop"),
    bottom: $<HTMLInputElement>("fogBottom"),
    middle: $<HTMLInputElement>("fogMid"),
    softness: $<HTMLInputElement>("fogSoft"),
    view: $<HTMLInputElement>("fogView"),
    reset: $<HTMLButtonElement>("fogReset"),
  },
  shadow: {
    on: $<HTMLInputElement>("shadowOn"),
    azimuth: $<HTMLInputElement>("shadowAz"),
    length: $<HTMLInputElement>("shadowLen"),
    blur: $<HTMLInputElement>("shadowBlur"),
    opacity: $<HTMLInputElement>("shadowOpacity"),
    reset: $<HTMLButtonElement>("shadowReset"),
  },
  lightReset: $<HTMLButtonElement>("lightReset"),
  point: {
    on: $<HTMLInputElement>("pointOn"),
    azimuth: $<HTMLInputElement>("pointAz"),
    elevation: $<HTMLInputElement>("pointEl"),
    distance: $<HTMLInputElement>("pointDist"),
    range: $<HTMLInputElement>("pointRange"),
    falloff: $<HTMLInputElement>("pointFalloff"),
    intensity: $<HTMLInputElement>("pointInt"),
    color: $<HTMLInputElement>("pointColor"),
    marker: $<HTMLInputElement>("pointMarker"),
    reset: $<HTMLButtonElement>("pointReset"),
  },
  pose: {
    hud: poseHud,
    status: $("poseStatus"),
    name: $<HTMLInputElement>("poseName"),
    save: $<HTMLButtonElement>("poseSave"),
    saveHand: $<HTMLButtonElement>("poseSaveHand"),
    filter: $("poseFilter"),
    folder: $<HTMLButtonElement>("poseFolder"),
    library: $("poseLibrary"),
    search: $<HTMLInputElement>("poseSearch"),
    foot: $("poseFoot"),
    count: $("poseCount"),
  },
  capture: {
    shot: $<HTMLButtonElement>("shot"),
    psd: $<HTMLButtonElement>("shotPsd"),
    video: $<HTMLButtonElement>("shotVideo"),
    status: $("shotStatus"),
    menu: $<HTMLButtonElement>("sceneMenu"),
    paintChart: $<HTMLButtonElement>("paintChart"),
  },
  entities: {
    list: $("entList"),
    add: $<HTMLButtonElement>("entAdd"),
    buildPanel: $("buildPanel"),
    spacing: $<HTMLInputElement>("entSpacing"),
  },
  items: {
    search: $<HTMLInputElement>("itemSearch"),
    scopes: $("itemScopes"),
    regions: $("itemRegions"),
    medals: $<HTMLButtonElement>("itemMedals"),
    selectAll: $<HTMLButtonElement>("itemSelectAll"),
    refresh: $<HTMLButtonElement>("itemWorkshopRefresh"),
    list: $("itemList"),
    equipped: $("itemEquipped"),
    count: $("itemCount"),
    foot: $("itemFoot"),
    clear: $<HTMLButtonElement>("itemsClear"),
  },
  anim: {
    search: $<HTMLInputElement>("seqSearch"),
    junk: $<HTMLInputElement>("hideJunk"),
    list: $<HTMLSelectElement>("seqList"),
    play: $<HTMLButtonElement>("play"),
    rewind: $<HTMLButtonElement>("rewind"),
    speed: $<HTMLSelectElement>("speed"),
    loop: $<HTMLInputElement>("loopAll"),
    blend: $<HTMLInputElement>("blendTaunts"),
    scrub: $<HTMLInputElement>("scrub"),
    frameLabel: $("frameLabel"),
    params: $("poseParams"),
    paramsReset: $<HTMLButtonElement>("paramsReset"),
    paramsZero: $<HTMLButtonElement>("paramsZero"),
  },
  flex: { list: $("flexList"), reset: $<HTMLButtonElement>("flexReset") },
  teams: [$<HTMLButtonElement>("teamRed"), $<HTMLButtonElement>("teamBlu")],
  weapons: {
    search: $<HTMLInputElement>("weaponSearch"),
    slots: $("weaponSlots"),
    list: $("weaponList"),
    count: $("weaponCount"),
    foot: $("weaponFoot"),
    clear: $<HTMLButtonElement>("weaponsClear"),
  },
  focusFace: $<HTMLButtonElement>("focusFace"),
  focusBody: $<HTMLButtonElement>("focusBody"),
  focusAll: $<HTMLButtonElement>("focusAll"),
  unusual: { hat: $<HTMLSelectElement>("unusualHat"), taunt: $<HTMLSelectElement>("unusualTaunt"), hatClear: $<HTMLButtonElement>("unusualHatClear"), tauntClear: $<HTMLButtonElement>("unusualTauntClear"), restart: $<HTMLButtonElement>("unusualRestart"), status: $("unusualStatus"), search: $<HTMLInputElement>("unusualSearch"), catalog: $("unusualCatalog"), bar: $("unusualBar"), loadZip: $<HTMLButtonElement>("unusualLoadZip"), custom: $("unusualCustom") },
  isIndexed: () => indexed,
  reveal: (id) => docks.reveal(id),
});

// The sections of the side panels fold, and so do the panels themselves (the handles at the edges of the 3D view).
document.querySelectorAll<HTMLElement>("#lightPane .lightCol, #lightSetupsPane .lightCol").forEach((section) => accordify(section, "light"));
accordify(document.querySelector<HTMLElement>(".animCol:last-child")!, "anim");

// The panels (outliner, properties, the browsers, the animation and lighting tabs ...) sit in three docks that are always there; they can be
// dragged from one dock to another, split off into groups and tabbed together, hidden and brought back from the Layout menu.
const docks = createDocks({
  view: $("view"),
  docks: { left: $("dockLeft"), right: $("dockRight"), bottom: $("dockBottom") },
  folds: { left: $("foldL"), right: $("foldR"), bottom: $("foldB") },
  panels: PANEL_DEFS.map((d) => ({ id: d.id, title: d.title, el: $(d.element) })),
  defaults: defaultLayout(),
  storageKey: "tf2workbench.layout",
});
poseHud.library.onclick = () => docks.reveal("poses"); // the library icon in the pose toolbar
$("viewOverlaysMore").onclick = () => openOverlaySettings($("viewOverlaysMore"));
$("layoutMenu").onclick = () => {
  openMenu($("layoutMenu"), [
    ...docks.panels().map((p) => ({ label: p.title, checked: p.visible, keepOpen: true, run: () => docks.togglePanel(p.id) })),
    { label: "Reset layout", separator: true, run: () => docks.reset() },
  ]);
};


{
  // the materials panel can be put away to see the whole view; remembered
  const wrap = $("canvasWrap");
  try { wrap.classList.toggle("flyoutCollapsed", localStorage.getItem("tf2workbench.flyoutCollapsed") === "1"); } catch { /* open */ }
  $("flyoutToggle").onclick = () => {
    const collapsed = wrap.classList.toggle("flyoutCollapsed");
    try { localStorage.setItem("tf2workbench.flyoutCollapsed", collapsed ? "1" : "0"); } catch { /* not remembered */ }
  };
  // ... and made wider or narrower by its edge; remembered
  const WIDTH_KEY = "tf2workbench.flyoutWidth", DEFAULT_WIDTH = 480, MIN_WIDTH = 300;
  const setWidth = (px: number) => wrap.style.setProperty("--flyoutW", `${px}px`);
  const widest = () => Math.max(MIN_WIDTH, wrap.clientWidth - 60);
  try { const saved = Number(localStorage.getItem(WIDTH_KEY)); if (Number.isFinite(saved) && saved >= MIN_WIDTH) setWidth(Math.min(saved, widest())); } catch { /* the usual width */ }
  const grip = $("flyoutGrip");
  grip.onpointerdown = (down) => {
    down.preventDefault();
    grip.setPointerCapture(down.pointerId);
    const left = wrap.getBoundingClientRect().left;
    let width = 0;
    const move = (e: PointerEvent) => { width = Math.round(Math.min(widest(), Math.max(MIN_WIDTH, e.clientX - left))); setWidth(width); };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      if (width) try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* not remembered */ }
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
    wrap.classList.add("resizingFlyout");
    grip.addEventListener("pointerup", () => wrap.classList.remove("resizingFlyout"), { once: true });
  };
  grip.ondblclick = () => { setWidth(DEFAULT_WIDTH); try { localStorage.removeItem(WIDTH_KEY); } catch { /* ok */ } };
}

function showTab(which: "view" | "compiler" | "settings") {
  const inView = which === "view" || which === "compiler";
  $("view").hidden = !inView;
  $("viewerStats").hidden = !inView;
  $("sceneBar").hidden = !inView;
  $("sceneMenu").hidden = !inView;
  $("layoutMenu").hidden = !inView;
  $("barSep").hidden = !inView;
  $("settings").hidden = which !== "settings";
  $("tabView").classList.toggle("on", which === "view");
  $("tabCompiler").classList.toggle("on", which === "compiler");
  $("tabSettings").classList.toggle("on", which === "settings");
  // the compiler is the viewer with the item being built where the cosmetics browser is
  // the compiler takes the left panel (the panel keeps its width, so the 3D view and its camera stay as they are); the cosmetics and weapons
  // browsers stay on the right, so other items can be put on the character
  $("compilerPane").hidden = which !== "compiler";
  $("dockLeft").classList.toggle("compiling", which === "compiler");
  // the materials slide out over the 3D view from the left panel; the view underneath keeps its size
  $("canvasWrap").classList.toggle("compiling", which === "compiler");
  viewTab.setCompiler(which === "compiler");
  if (inView) void viewTab.onShown();
  else setFullscreen(false);
}

/** Tab: hide the header and all docks so the render fills the window; Tab again to come back. */
function setFullscreen(on: boolean) {
  $("app").classList.toggle("fullview", on);
}
window.addEventListener("keydown", (e) => {
  if (!hotkeyMatches("view.fullscreen", e) || $("view").hidden) return;
  const t = e.target as HTMLElement;
  if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === "text" || t.type === "search"))) return;
  e.preventDefault();
  if (e.repeat) return;
  setFullscreen(!$("app").classList.contains("fullview"));
  (document.activeElement as HTMLElement | null)?.blur();
});
/** The tooltips that name a key follow the bindings of the Settings. */
function refreshHotkeyTitles() {
  const key = (id: Parameters<typeof binding>[0]) => codeName(binding(id).split("+").pop() ?? "") || "unbound";
  for (const [button, name, id, reset] of [["gizMove", "Move", "tool.move", "position"], ["gizRotate", "Rotation", "tool.rotate", "rotation"], ["gizScale", "Scale", "tool.scale", "scale"]] as const) {
    const k = key(id);
    $(button).title = binding(id) ? `${name} gizmo (${k}); edit by mouse (Shift+${k}); reset ${reset} (Alt+${k})` : `${name} gizmo (no key)`;
  }
  $("hudPlay").title = `Play / pause the animation of the selected character (${key("play.toggle")})`;
}
onSettingsChange(refreshHotkeyTitles);
$("tabView").onclick = () => showTab("view");
$("tabCompiler").onclick = () => showTab("compiler");
$("tabSettings").onclick = () => showTab("settings");
installSliderWheel();
installNoNativeMenu();
void createSettingsUi($("settings"));
void loadSettings().then((s) => { applyTheme(s.uiBase, s.uiAccent); refreshHotkeyTitles(); startUiScale(); });
showTab("view");

async function load(dir: string) {
  status.textContent = "Indexing VPKs…";
  try {
    await indexTf2(dir);
    showIndex();
  } catch (e) {
    status.innerHTML = `<span class="err">${esc(String(e))} Use “Choose TF2 folder…” and select the <code>tf</code> folder inside Team Fortress 2.</span>`;
  }
}

$("pick").onclick = async () => {
  const dir = await open({ directory: true, title: "Select the TF2 'tf' folder" });
  if (typeof dir === "string") await load(dir);
};

void (async () => {
  const dir = await findTf2();
  if (dir) await load(dir);
  else {
    status.innerHTML = `<span class="err">TF2 not found automatically. Click “Choose TF2 folder…”.</span>`;
  }
})();
