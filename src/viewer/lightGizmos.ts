import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { defaultLightRange, spotLightRotation, type RigLight, worldDirection } from "./lighting";
import { GizmoSet, gizmoKey } from "./gizmos";
import { keyboardScaleFactor } from "./scaleGizmo";

/** Advanced light controls use the same viewport toolbar and modal keys as characters. */
export class LightGizmos {
  parts = { move: true, rotate: false, scale: false, view: false };
  readonly objects: THREE.Object3D[];
  private readonly pivot = new THREE.Object3D();
  private readonly marker = new THREE.Group();
  /** Small bulbs for the other lights that have a position: they can be clicked to make one the light the gizmo edits. */
  private readonly others = new THREE.Group();
  private readonly otherBulbs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial());
  /** The reach of a point light: one ring turned to face the viewer (the outline of its sphere), instead of a whole sphere. */
  private readonly sphere = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 48), Math.sin(i * Math.PI / 48), 0))), new THREE.LineBasicMaterial({ transparent: true, opacity: .6, depthWrite: false }));
  private readonly cone = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: .5, depthWrite: false }));
  /** The line from where a directional light turns to the bulb it comes from (local space: the way to the light is -Z). */
  private readonly ray = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: .6, depthWrite: false }));
  private rayLength = -1;
  /** An area light's panel: its outline (local X by local Y) and the way it shines. */
  private readonly panel = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: .8, depthWrite: false }));
  private panelSize = "";
  /** Where a directional light's gizmo sits unless it was moved, and how far its bulb is from there: the viewer says (the middle of the scene). */
  anchor: () => THREE.Vector3 = () => new THREE.Vector3();
  reach: () => number = () => 100;
  private readonly gizmos: GizmoSet;
  private readonly controls: TransformControls[];
  private readonly events = new AbortController();
  private pointer = { x: 0, y: 0, inside: false };
  private before: RigLight | null = null;
  private orbitEnabled = true;
  private coneAngle = -1;
  private modal: { light: RigLight; before: RigLight; mode: "translate" | "rotate" | "scale"; axis: "x" | "y" | "z" | null; pointer: { x: number; y: number }; plane: THREE.Plane; hit: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, private readonly orbit: OrbitControls, private readonly dom: HTMLElement, private readonly selected: () => RigLight | null, private readonly available: () => boolean, private readonly changed: () => void, private readonly all: () => RigLight[] = () => [], private readonly indicators: () => boolean = () => false) {
    this.gizmos = new GizmoSet({ camera, dom, scene }, ["move", "rotate", "scale", "view"], { space: { move: "local", rotate: "local" }, worldScale: true });
    this.controls = this.gizmos.all;
    this.gizmos.on("mouseDown", () => { const light = selected(); this.before = light ? structuredClone(light) : null; this.orbitEnabled = orbit.enabled; orbit.enabled = false; });
    this.gizmos.on("objectChange", (role) => {
      const light = selected(); if (!light || !this.before) return;
      if (role === "move") { if (light.type === "directional") light.pivot = this.pivot.position.toArray(); else light.position = this.pivot.position.toArray(); }
      else if (role === "rotate" || role === "view") this.turnTo(light, this.pivot.quaternion);
      else {
        const factor = this.pivot.scale.toArray().reduce((a, b) => Math.abs(b - 1) > Math.abs(a - 1) ? b : a, 1);
        light.range = THREE.MathUtils.clamp(this.before.range * factor, 1, 5000);
      }
      this.changed();
    });
    this.gizmos.on("mouseUp", () => { this.before = null; orbit.enabled = this.orbitEnabled; this.sync(); });
    this.gizmos.exclusiveDrag(() => this.sync());
    this.marker.add(this.bulb, this.sphere, this.cone, this.ray, this.panel);
    this.objects = [this.marker, this.others, ...this.gizmos.objects];
    scene.add(this.pivot, this.marker, this.others);
    this.marker.visible = false;
    this.installInput();
  }
  get active() { const l = this.selected(); return this.available() && !!l?.enabled; }
  get rotatable() { const type = this.selected()?.type; return type === "spot" || type === "directional" || type === "area"; }
  /** Where the gizmo of a light sits: at the light; for a directional one (which has no place) where it was put, or else in the middle of the scene. */
  private placeOf(light: RigLight) { return light.type === "directional" ? (light.pivot ? new THREE.Vector3().fromArray(light.pivot) : this.anchor().clone()) : new THREE.Vector3().fromArray(light.position); }
  /** The turn that points the gizmo's +Z the way a directional light shines (its direction is relative to the view when the light follows the camera). */
  private directionalRotation(light: RigLight) {
    const toLight = worldDirection(light, this.camera.quaternion);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toLight.negate());
  }
  /** Turns a light to the gizmo's orientation (a directional light stores the way to it relative to the view). */
  private turnTo(light: RigLight, quaternion: THREE.Quaternion) {
    if (light.type !== "directional") { this.setDirection(light, quaternion); return; }
    const toLight = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).negate().normalize();
    if (light.followCamera) toLight.applyQuaternion(this.camera.quaternion.clone().invert());
    light.azimuth = (THREE.MathUtils.radToDeg(Math.atan2(toLight.x, toLight.z)) + 360) % 360;
    light.elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(toLight.y, -1, 1)));
  }
  get hot() { return !!this.modal || this.controls.some(c => c.enabled && c.axis !== null); }
  setSpace(space: "local" | "world") { this.gizmos.setSpace(space); }
  /** The id of the light whose marker is under a client position (within a few pixels), or null. */
  pick(clientX: number, clientY: number): string | null {
    if (!this.indicators()) return null;
    const rect = this.dom.getBoundingClientRect();
    let best: string | null = null, bestDistance = 14;
    for (const light of this.all()) {
      if (!light.enabled || light.type === "directional") continue;
      const p = new THREE.Vector3().fromArray(light.position).project(this.camera);
      if (p.z > 1) continue;
      const distance = Math.hypot(rect.left + (p.x + 1) * rect.width / 2 - clientX, rect.top + (1 - p.y) * rect.height / 2 - clientY);
      if (distance < bestDistance) { bestDistance = distance; best = light.id; }
    }
    return best;
  }
  private halos: THREE.Mesh[] = [];
  private highlighted: string[] = [];
  private highlightColour = new THREE.Color(0xe08a3c);
  /** Puts an outline (a halo around the bulb) on these lights (ids): they are selected. */
  setHighlight(ids: string[], colour: THREE.Color) {
    if (ids.join() === this.highlighted.join() && this.highlightColour.equals(colour)) return;
    this.highlighted = [...ids];
    this.highlightColour = colour.clone();
    this.seen = ""; // drawn again by the next poll
  }
  private syncHalos() {
    const lights = this.indicators() ? this.all().filter((x) => x.enabled && x.type !== "directional" && this.highlighted.includes(x.id)) : [];
    while (this.halos.length < lights.length) {
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: .95, depthWrite: false, depthTest: false }));
      halo.renderOrder = 5;
      this.halos.push(halo);
      this.others.add(halo);
    }
    this.halos.forEach((halo, i) => {
      const light = lights[i];
      halo.visible = !!light;
      if (!light) return;
      halo.position.fromArray(light.position);
      halo.scale.setScalar(1.5);
      (halo.material as THREE.MeshBasicMaterial).color.copy(this.highlightColour);
    });
  }
  private syncOthers() {
    const chosen = this.selected()?.id, show = this.indicators();
    this.syncHalos();
    const lights = show ? this.all().filter(l => l.enabled && l.type !== "directional" && l.id !== chosen) : [];
    while (this.otherBulbs.length < lights.length) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: .6, depthWrite: false }));
      this.otherBulbs.push(bulb); this.others.add(bulb);
    }
    this.otherBulbs.forEach((bulb, i) => {
      const light = lights[i];
      bulb.visible = !!light;
      if (!light) return;
      bulb.position.fromArray(light.position); bulb.scale.setScalar(.8); bulb.material.color.set(light.color);
    });
  }
  /** True while a mouse transform (Shift + W / E / R) is in progress: the next click belongs to it. */
  get inModal() { return this.modal !== null; }
  private seen = "";
  /** Syncs again when what decides what shows has changed somewhere else (a character or a camera took the gizmo, posing started, a light was disabled). Cheap: called every frame. */
  poll() {
    // the marker of a point light is not turned, so the camera's own turn makes the ring face the viewer
    if (this.marker.visible) this.sphere.quaternion.copy(this.camera.quaternion);
    const light = this.selected();
    const key = [this.available(), this.indicators(), light?.id, light?.enabled, light?.type, light?.azimuth, light?.elevation, light?.width, light?.height, light?.rotation?.join(), light?.type === "directional" ? this.camera.quaternion.toArray().join(",") + this.anchor().toArray().join(",") : "", this.highlighted.join(), this.all().map((x) => x.position.join(",")).join(";")].join("|");
    if (key === this.seen) return;
    this.seen = key;
    this.sync();
  }
  setParts(parts: typeof this.parts) { this.parts = { ...parts }; this.sync(); }
  sync() {
    const light = this.selected(), active = this.active;
    this.syncOthers();
    if (this.modal && (!active || light !== this.modal.light)) this.finish(false);
    // the selected light shows its marker (bulb, reach) whenever indicators are on, and while it has the gizmo
    const directional = light?.type === "directional";
    // the toggle hides the marker even while the light has the gizmo (which stays)
    const marked = !!light && light.enabled && this.indicators() && (directional ? active : true);
    this.marker.visible = marked;
    if (light && (marked || active)) {
      const quaternion = light.type === "spot" || light.type === "area" ? spotLightRotation(light) : directional ? this.directionalRotation(light) : new THREE.Quaternion();
      const place = this.placeOf(light);
      if (!this.modal && !this.controls.some(c => c.dragging)) {
        this.pivot.position.copy(place); this.pivot.quaternion.copy(quaternion); this.pivot.scale.setScalar(1);
      }
      this.marker.position.copy(place); this.marker.quaternion.copy(quaternion);
      this.bulb.scale.setScalar(directional ? 1.6 : 1);
      // a directional light is drawn as a bulb out on the way it comes from, joined to where it turns by a line
      const reach = this.reach();
      this.bulb.position.set(0, 0, directional ? -reach : 0);
      this.ray.visible = directional;
      if (directional && this.rayLength !== reach) {
        this.rayLength = reach;
        this.ray.geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -reach], 3));
        this.ray.geometry.computeBoundingSphere();
      }
      this.ray.material.color.set(light.color);
      this.bulb.material.color.set(light.color); this.sphere.material.color.set(light.color); this.cone.material.color.set(light.color);
      this.sphere.visible = light.type === "point"; this.sphere.scale.setScalar(light.range);
      this.panel.visible = light.type === "area"; this.panel.material.color.set(light.color);
      if (light.type === "area") {
        const w = (light.width ?? 80) / 2, h = (light.height ?? 20) / 2, size = `${w},${h}`;
        if (this.panelSize !== size) {
          this.panelSize = size;
          // the outline, its diagonals, and a line out of the middle the way it shines
          const v = [-w, -h, 0, w, -h, 0, w, -h, 0, w, h, 0, w, h, 0, -w, h, 0, -w, h, 0, -w, -h, 0, -w, -h, 0, w, h, 0, -w, h, 0, w, -h, 0, 0, 0, 0, 0, 0, Math.max(w, h) * .6];
          this.panel.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
          this.panel.geometry.computeBoundingSphere();
        }
      }
      this.cone.visible = light.type === "spot"; this.cone.scale.setScalar(light.range);
      if (light.type === "spot" && this.coneAngle !== light.cone) {
        this.coneAngle = light.cone;
        const theta = THREE.MathUtils.degToRad(light.cone), radius = Math.sin(theta), z = Math.cos(theta), vertices: number[] = [];
        for (let i = 0; i < 64; i++) {
          const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32;
          vertices.push(radius * Math.cos(a), radius * Math.sin(a), z, radius * Math.cos(b), radius * Math.sin(b), z);
          if (i % 16 === 0) vertices.push(0, 0, 0, radius * Math.cos(a), radius * Math.sin(a), z);
        }
        vertices.push(0, 0, 0, 0, 0, 1);
        this.cone.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); this.cone.geometry.computeBoundingSphere();
      }
    }
    const dragging = this.controls.find(c => c.dragging);
    (["move", "rotate", "scale", "view"] as const).forEach((role, i) => {
      const control = this.controls[i];
      // a directional light turns (always) and its gizmo can be moved about; it has no reach to scale
      const allowed = light?.type === "directional" ? role === "rotate" || (role === "move" && this.parts.move) : this.parts[role] && (i === 0 || i === 2 || this.rotatable);
      const on = active && allowed && !this.modal && (!dragging || dragging === control);
      if (!control.dragging) this.gizmos.show(role, on, this.pivot);
    });
  }
  private setDirection(light: RigLight, quaternion: THREE.Quaternion) {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    light.azimuth = (THREE.MathUtils.radToDeg(Math.atan2(direction.x, direction.z)) + 360) % 360;
    light.elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)));
    light.rotation = quaternion.clone().normalize().toArray();
  }
  private rayHit(plane: THREE.Plane) {
    const rect = this.dom.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((this.pointer.x - rect.left) / rect.width * 2 - 1, 1 - (this.pointer.y - rect.top) / rect.height * 2), this.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }
  private installInput() {
    const options = { signal: this.events.signal };
    this.dom.addEventListener("pointerenter", () => { this.pointer.inside = true; }, options);
    this.dom.addEventListener("pointerleave", () => { this.pointer.inside = false; }, options);
    this.dom.addEventListener("pointermove", e => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; if (this.modal) this.updateModal(); }, options);
    this.dom.addEventListener("pointerdown", e => { if (!this.modal) return; e.preventDefault(); e.stopImmediatePropagation(); this.finish(e.button !== 2); }, { ...options, capture: true });
    this.dom.addEventListener("contextmenu", e => { if (this.active) e.preventDefault(); }, options);
    window.addEventListener("keydown", e => {
      const target = e.target as HTMLElement | null;
      if (!this.active || (!this.modal && !this.pointer.inside) || e.ctrlKey || e.metaKey || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const key = e.key.toLowerCase(), light = this.selected()!;
      if (this.modal) {
        if (key === "escape" || key === "enter") this.finish(key === "enter");
        else if (key === "x" || key === "y" || key === "z") { this.modal.axis = this.modal.axis === key ? null : key; this.updateModal(); }
        else return;
      } else {
        const tool = gizmoKey(e);
        if (e.repeat || this.controls.some(c => c.dragging) || !tool || !(e.altKey || e.shiftKey) || (tool === "rotate" && !this.rotatable) || (light.type === "directional" && tool === "scale")) return;
        if (e.altKey) {
          if (tool === "move") { if (light.type === "directional") delete light.pivot; else light.position = [60, 100, 100]; }
          else if (tool === "rotate") { light.azimuth = 0; light.elevation = 20; delete light.rotation; }
          else light.range = defaultLightRange(light.type);
          this.changed();
        } else {
          const position = this.placeOf(light), plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), position);
          this.modal = { light, before: structuredClone(light), mode: tool === "move" ? "translate" : tool, axis: null, pointer: { ...this.pointer }, plane, hit: this.rayHit(plane) ?? position, quaternion: this.pivot.quaternion.clone() };
          this.orbitEnabled = this.orbit.enabled; this.orbit.enabled = false; this.sync();
        }
      }
      e.preventDefault(); e.stopImmediatePropagation();
    }, options);
  }
  private updateModal() {
    const m = this.modal; if (!m) return;
    const dx = this.pointer.x - m.pointer.x, dy = this.pointer.y - m.pointer.y;
    if (m.mode === "translate") {
      const delta = (this.rayHit(m.plane) ?? m.hit).clone().sub(m.hit);
      if (m.axis) for (const key of ["x", "y", "z"] as const) if (key !== m.axis) delta[key] = 0;
      const moved = (m.light.type === "directional" ? this.placeOf(m.before) : new THREE.Vector3().fromArray(m.before.position)).add(delta).toArray();
      if (m.light.type === "directional") m.light.pivot = moved; else m.light.position = moved;
    } else if (m.mode === "scale") m.light.range = THREE.MathUtils.clamp(m.before.range * keyboardScaleFactor(dx, dy), 1, 5000);
    else {
      const view = this.camera.getWorldDirection(new THREE.Vector3());
      const axis = m.axis ? new THREE.Vector3(m.axis === "x" ? 1 : 0, m.axis === "y" ? 1 : 0, m.axis === "z" ? 1 : 0).applyQuaternion(m.quaternion) : view;
      const rect = this.dom.getBoundingClientRect(), screen = this.placeOf(m.before).project(this.camera);
      const x = rect.left + (screen.x + 1) * rect.width / 2, y = rect.top + (1 - screen.y) * rect.height / 2;
      const angle = Math.atan2(this.pointer.y - y, this.pointer.x - x) - Math.atan2(m.pointer.y - y, m.pointer.x - x);
      // Match pose rotation: follow the pointer around the pivot, reversing the
      // local-axis angle when that axis faces the viewer instead of away.
      const turn = new THREE.Quaternion().setFromAxisAngle(axis, axis.dot(view) < 0 ? -angle : angle);
      this.turnTo(m.light, m.quaternion.clone().premultiply(turn));
    }
    this.changed();
  }
  private finish(confirm: boolean) {
    const m = this.modal; if (!m) return;
    this.modal = null;
    if (!confirm) { Object.assign(m.light, m.before); if (!m.before.rotation) delete m.light.rotation; if (!m.before.pivot) delete m.light.pivot; }
    this.orbit.enabled = this.orbitEnabled; this.changed();
  }
  dispose() {
    this.finish(false); this.events.abort(); this.gizmos.dispose();
    this.scene.remove(this.pivot, this.marker, this.others);
    for (const bulb of this.otherBulbs) { bulb.geometry.dispose(); bulb.material.dispose(); }
    for (const visual of [this.bulb, this.sphere, this.cone, this.ray, this.panel]) { visual.geometry.dispose(); visual.material.dispose(); }
  }
}
