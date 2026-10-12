import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Backdrop } from "./backdropImage";
import { cameraFrame, cameraProjection, cameraSize, parseCameras, type CameraCollection, type SceneCamera } from "./cameraData";
import { GizmoSet, gizmoKey } from "./gizmos";

/** Scene cameras support gizmo edits and explicitly enabled viewport navigation. */
export class CameraRig {
  cameras: SceneCamera[] = [];
  active: string | null = null;
  editing: string | null = null;
  overlayEditing: string | null = null;
  onChange = () => {};
  onEnter = () => {};
  readonly objects: THREE.Object3D[];
  private readonly pivot = new THREE.Object3D();
  private readonly gizmos: GizmoSet;
  parts = { move: true, rotate: false, scale: false, view: false };
  private navigation: { id: number; x: number; y: number } | null = null;
  private resettingOrbit = false;
  private inside = false;
  private pointer = { x: 0, y: 0 };
  private modal: { mode: "translate" | "rotate"; axis: "x" | "y" | "z" | null; position: THREE.Vector3; quaternion: THREE.Quaternion; pointer: { x: number; y: number }; plane: THREE.Plane; hit: THREE.Vector3 } | null = null;
  private readonly events = new AbortController();
  private readonly visuals = new THREE.Group();
  /** The user's picture behind the scene of the camera that is looked through. */
  readonly backdrop: Backdrop;
  private readonly frame: HTMLDivElement;
  private freeView: { camera: THREE.PerspectiveCamera; target: THREE.Vector3 } | null = null;
  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, private readonly orbit: OrbitControls, private readonly container: HTMLElement, dom: HTMLElement) {
    this.gizmos = new GizmoSet({ camera, dom, scene }, ["move", "rotate", "view", "viewMove"], { space: { move: "local", rotate: "local" } });
    this.objects = [this.visuals, ...this.gizmos.objects];
    scene.add(this.pivot, this.visuals);
    this.gizmos.on("dragging-changed", (_role, _control, e) => { orbit.enabled = !e.value && !this.active; });
    this.gizmos.on("objectChange", () => {
      const data = this.cameras.find(c => c.id === this.editing);
      if (!data) return;
      data.position = this.pivot.position.toArray(); data.quaternion = this.pivot.quaternion.toArray();
      const helper = this.visuals.children[this.cameras.indexOf(data)] as THREE.CameraHelper;
      if (helper) {
        helper.camera.position.copy(this.pivot.position); helper.camera.quaternion.copy(this.pivot.quaternion);
        helper.camera.updateMatrixWorld(true); helper.update();
      }
      this.onChange();
    });
    this.gizmos.exclusiveDrag(() => this.applyParts());
    this.backdrop = new Backdrop(scene);
    this.frame = document.createElement("div");
    this.frame.className = "cameraFrame"; this.frame.hidden = true;
    container.append(this.frame);
    this.installInput(dom);
    orbit.addEventListener("change", this.saveNavigation);
  }
  private get controls() { return this.gizmos.all; }
  get hot() { return !!this.overlayEditing || !!this.modal || this.controls.some(control => control.enabled && control.axis !== null); }
  setSpace(space: "local" | "world") { this.gizmos.setSpace(space); }
  setParts(parts: typeof this.parts) { this.parts = { ...parts, scale: false }; this.applyParts(); }
  private applyParts() {
    for (const [part, role] of [["move", "move"], ["rotate", "rotate"], ["view", "view"], ["view", "viewMove"]] as const) {
      const on = !!this.editing && this.parts[part] && !this.modal;
      this.gizmos.show(role, on, this.pivot);
    }
  }
  /** True while a mouse transform (Shift + W / E) is in progress: the next click belongs to it. */
  get inModal() { return this.modal !== null; }
  get activeCamera() { return this.cameras.find(c => c.id === this.active) ?? null; }
  get navigatingView() { return this.activeCamera?.navigateView === true; }
  /** The view is through a camera and cannot be turned or moved: the camera is fixed, only the zoom of the view works. */
  get locked() { return !!this.active && !this.navigatingView && !this.overlayEditing; }
  /** How much the view is zoomed into the shot of the active camera (only the view: the camera itself, and so every picture taken, stays as it is). */
  private viewZoom = 1;
  get zoom() { return this.viewZoom; }
  /** How far the view is moved off the shot, in pixels (the border of the shot moves with it). */
  private viewPan = { x: 0, y: 0 };
  get pan() { return this.viewPan; }
  /** Moves the view of the camera by a mouse movement in pixels: the camera is fixed, the shot (its border and what it shows) slides over the screen. */
  panView(dx: number, dy: number) {
    if (!this.active) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.viewPan = { x: Math.max(-2 * w, Math.min(2 * w, this.viewPan.x + dx)), y: Math.max(-2 * h, Math.min(2 * h, this.viewPan.y + dy)) };
    this.update();
  }
  /** Zooms the view of the camera by a factor (below 1 closer, above 1 further away). */
  zoomView(factor: number) {
    if (!this.active) return;
    this.viewZoom = Math.min(10, Math.max(0.1, this.viewZoom / factor));
    this.update();
  }
  prepareNavigation() { if (!this.overlayEditing && this.active && !this.navigatingView) this.leave(true); }
  editOverlay(id: string) {
    if (this.overlayEditing === id) { this.stopOverlayEditing(); return; }
    // the view stays as it is (zoomed and moved or not): only a camera that is not yet looked through is entered
    if (this.active !== id) this.view(id);
    else this.stopEditing();
    if (this.active !== id) return;
    this.overlayEditing = id; this.orbit.enabled = false; this.onChange();
  }
  stopOverlayEditing() { this.overlayEditing = null; this.orbit.enabled = !this.active || this.navigatingView; this.onChange(); }
  setCaptureBackground(id: string, enabled: boolean) {
    const data = this.cameras.find(c => c.id === id); if (!data) return;
    if (enabled) data.captureBackground = true; else delete data.captureBackground;
    this.onChange();
  }
  setNavigateView(id: string, enabled: boolean) {
    const data = this.cameras.find(c => c.id === id); if (!data) return;
    if (enabled) data.navigateView = true; else delete data.navigateView;
    if (this.active === id) { this.navigation = null; this.resetOrbitMotion(); this.update(true); }
    this.onChange();
  }
  /** The turn about its own view axis that the camera being navigated has: the orbit controls always hold the camera upright, so it is put back after them. */
  private navRoll = new THREE.Quaternion();
  /** The way the orbit controls hold a camera that looks along `quaternion`: upright, without any turn about the view axis. */
  private static upright(quaternion: THREE.Quaternion) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    if (Math.abs(forward.y) > 0.9999) return null;
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, new THREE.Vector3(0, 1, 0)));
  }
  private static rollOf(quaternion: THREE.Quaternion) {
    const upright = CameraRig.upright(quaternion);
    return upright ? upright.invert().multiply(quaternion) : new THREE.Quaternion();
  }
  /** Puts the turn back on the camera after the orbit controls have held it upright (it can be done any number of times). */
  private applyRoll() {
    const upright = CameraRig.upright(this.camera.quaternion);
    if (upright) this.camera.quaternion.copy(upright).multiply(this.navRoll);
  }
  private readonly saveNavigation = () => {
    const data = this.activeCamera;
    if (!data?.navigateView || this.resettingOrbit || this.overlayEditing) return;
    this.applyRoll();
    if (this.camera.position.equals(new THREE.Vector3().fromArray(data.position)) && this.camera.quaternion.equals(new THREE.Quaternion().fromArray(data.quaternion))) return;
    data.position = this.camera.position.toArray(); data.quaternion = this.camera.quaternion.toArray();
    const helper = this.visuals.children[this.cameras.indexOf(data)] as THREE.CameraHelper;
    if (helper) {
      helper.camera.position.copy(this.camera.position); helper.camera.quaternion.copy(this.camera.quaternion);
      helper.camera.updateMatrixWorld(true); helper.update();
    }
    this.onChange();
  };
  private resetOrbitMotion() {
    // Discard old damping deltas when entering a shot or explicitly editing it.
    this.resettingOrbit = true;
    const damping = this.orbit.enableDamping;
    this.orbit.enableDamping = false;
    try { this.orbit.update(); } finally { this.orbit.enableDamping = damping; this.resettingOrbit = false; }
  }
  editorView() {
    return { position: (this.freeView?.camera ?? this.camera).position.toArray() as [number, number, number], target: (this.freeView?.target ?? this.orbit.target).toArray() as [number, number, number] };
  }
  editorProjection() {
    const camera = (this.freeView?.camera ?? this.camera) as THREE.PerspectiveCamera & { isOrthographicCamera?: boolean; halfHeight?: number };
    return { orthographic: camera.isOrthographicCamera === true, halfHeight: camera.halfHeight ?? 1, zoom: camera.zoom };
  }
  snapshot(): CameraCollection { return parseCameras({ cameras: this.cameras, active: this.active }); }
  restore(data: unknown) {
    this.leave(); this.stopEditing();
    const parsed = parseCameras(data); this.cameras = parsed.cameras;
    this.rebuildVisuals();
    if (parsed.active) this.view(parsed.active);
    this.onChange();
  }
  fromView(): SceneCamera {
    const source = this.activeCamera ? cameraProjection(this.activeCamera) : this.camera;
    const rect = cameraFrame(Math.max(1, this.container.clientWidth), Math.max(1, this.container.clientHeight), 16 / 9);
    const fov = this.activeCamera ? source.fov : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(source.fov) / 2) * rect.h / Math.max(1, this.container.clientHeight)));
    const data: SceneCamera = { id: crypto.randomUUID(), name: `Camera ${this.cameras.length + 1}`, position: source.position.toArray(), quaternion: source.quaternion.toArray(), fov, ratio: this.activeCamera?.ratio ?? "16:9", height: this.activeCamera?.height ?? 1080 };
    this.cameras.push(data); this.rebuildVisuals(); this.view(data.id); return data;
  }
  view(id: string) {
    if (!this.cameras.some(c => c.id === id)) return;
    this.overlayEditing = null;
    this.onEnter(); this.stopEditing();
    if (!this.freeView) this.freeView = { camera: this.camera.clone(), target: this.orbit.target.clone() };
    this.resetOrbitMotion();
    const viewport = this.camera as THREE.PerspectiveCamera & { setOrthographic?: (enabled: boolean, distance: number) => void };
    viewport.setOrthographic?.(false, this.camera.position.distanceTo(this.orbit.target));
    this.camera.zoom = 1;
    this.viewZoom = 1; this.viewPan = { x: 0, y: 0 };
    this.active = id; this.orbit.enabled = false;
    this.update(true); this.onChange();
  }
  /** Whether leaving a camera's view (see `exit`) puts the viewport back where it was (the setting in Settings). */
  restoreViewOnExit = false;
  /** The user leaves the camera's view (the camera button, or the camera clicked again): to the viewport as it was before, or where the camera was. */
  exit() { this.leave(!this.restoreViewOnExit); }
  leave(keepView = false) {
    // the viewport that is left behind has the shot as it was made, not as the view was zoomed
    if (this.viewZoom !== 1 || this.viewPan.x || this.viewPan.y) { this.viewZoom = 1; this.viewPan = { x: 0, y: 0 }; this.update(); }
    this.overlayEditing = null;
    this.active = null; this.frame.hidden = true; this.viewZoom = 1; this.viewPan = { x: 0, y: 0 }; this.backdrop.hide();
    if (this.camera.view?.enabled) this.camera.clearViewOffset();
    if (this.freeView && !keepView) {
      this.camera.copy(this.freeView.camera); this.orbit.target.copy(this.freeView.target);
      const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect / aspect));
      this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
      this.freeView = null;
    }
    this.freeView = null; this.navigation = null;
    this.orbit.enabled = true; this.visuals.visible = true;
    this.onChange();
  }
  /** Makes a camera the one the gizmo edits. `focus` (the default) also brings the viewport to it; a click on the camera in the view passes false. */
  edit(id: string, mode: "translate" | "rotate" = "translate", focusView = true) {
    const data = this.cameras.find(c => c.id === id); if (!data) return;
    const focus = focusView && this.editing !== id;
    this.finishModal(false); this.leave(); this.onEnter(); this.editing = id;
    this.parts = { move: mode === "translate", rotate: mode === "rotate", scale: false, view: false };
    this.pivot.position.fromArray(data.position); this.pivot.quaternion.fromArray(data.quaternion);
    this.pivot.updateMatrixWorld(true);
    if (focus) {
      this.orbit.target.copy(this.pivot.position);
      this.camera.position.copy(this.pivot.position).add(new THREE.Vector3(80, 50, 100).applyQuaternion(this.pivot.quaternion));
      this.camera.near = .1; this.camera.far = 10000;
      this.camera.lookAt(this.orbit.target); this.camera.updateProjectionMatrix(); this.orbit.update();
    }
    this.applyParts(); this.rebuildVisuals(); this.onChange();
  }
  stopEditing() {
    this.finishModal(false); this.editing = null; this.applyParts();
    this.orbit.enabled = !this.active;
    this.onChange();
  }
  /** Adds a copy of a camera (a little to its right, so that it does not sit exactly in the first one) and returns it. */
  duplicate(id: string): SceneCamera | null {
    const source = this.cameras.find(c => c.id === id);
    if (!source) return null;
    const copy: SceneCamera = structuredClone({ ...source, id: crypto.randomUUID() });
    const base = `${source.name} copy`;
    copy.name = base;
    for (let i = 2; this.cameras.some(c => c.name === copy.name); i++) copy.name = `${base} ${i}`;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(source.quaternion)).multiplyScalar(10);
    copy.position = [source.position[0] + right.x, source.position[1] + right.y, source.position[2] + right.z];
    this.cameras.push(copy); this.rebuildVisuals(); this.onChange();
    return copy;
  }
  remove(id: string) {
    if (this.active === id) this.leave();
    if (this.editing === id) this.stopEditing();
    this.cameras = this.cameras.filter(c => c.id !== id); this.rebuildVisuals(); this.onChange();
  }
  setTransform(id: string, transform: { position?: [number, number, number]; rotation?: [number, number, number] }) {
    const data = this.cameras.find(c => c.id === id);
    if (!data || (transform.position && !transform.position.every(Number.isFinite)) || (transform.rotation && !transform.rotation.every(Number.isFinite))) return;
    if (transform.position) data.position = [...transform.position];
    if (transform.rotation) {
      const [x, y, z] = transform.rotation.map(THREE.MathUtils.degToRad);
      data.quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ")).toArray();
    }
    this.refresh();
  }
  refresh() {
    if (this.active) this.resetOrbitMotion();
    const data = this.cameras.find(c => c.id === this.editing);
    if (data) {
      this.pivot.position.fromArray(data.position); this.pivot.quaternion.fromArray(data.quaternion);
      this.pivot.updateMatrixWorld(true);
    }
    this.rebuildVisuals(); this.update(true); this.onChange();
  }
  update(resetTarget = false) {
    const data = this.activeCamera;
    this.visuals.visible = !data;
    if (!data) { this.backdrop.hide(); this.shotFrame = null; return; }
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    const size = cameraSize(data), rect = cameraFrame(width, height, size.w / size.h);
    this.camera.position.fromArray(data.position); this.camera.quaternion.fromArray(data.quaternion);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(data.fov) / 2) * height / rect.h / this.viewZoom));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true);
    // panned: the picture is drawn shifted over the screen (a window onto the same projection), so nothing about the camera changes
    if (this.viewPan.x || this.viewPan.y) this.camera.setViewOffset(width, height, -this.viewPan.x, -this.viewPan.y, width, height);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    if (resetTarget || !data.navigateView) {
      this.navRoll = CameraRig.rollOf(this.camera.quaternion);
      const direction = this.camera.getWorldDirection(new THREE.Vector3());
      this.orbit.target.copy(this.camera.position).addScaledVector(direction, 100);
    }
    this.orbit.enabled = !this.overlayEditing && (!!data.navigateView || !!this.navigation);
    // Apply damping and save the shot before particles and rendering.
    if (data.navigateView && !this.overlayEditing && !resetTarget) { this.orbit.update(); this.applyRoll(); this.camera.updateMatrixWorld(true); }
    this.frame.hidden = false;
    // the border of the shot is the size of the shot on the screen: it grows when the view zooms in and shrinks when it zooms out, with the world around it
    const z = this.viewZoom, w = rect.w * z, h = rect.h * z;
    const fx = (width - w) / 2 + this.viewPan.x, fy = (height - h) / 2 + this.viewPan.y;
    Object.assign(this.frame.style, { left: `${fx}px`, top: `${fy}px`, width: `${w}px`, height: `${h}px` });
    this.backdrop.update(data.overlay?.background, { x: fx, y: fy, w, h }, { w: width, h: height });
    this.shotFrame = { x: fx / width, y: 1 - (fy + h) / height, w: w / width, h: h / height, pixels: size };
  }
  /** While looking through a camera: where the picture is in the view (fractions, y up) and its size in pixels. */
  shotFrame: { x: number; y: number; w: number; h: number; pixels: { w: number; h: number } } | null = null;
  captureCamera() {
    const data = this.activeCamera;
    return data ? { camera: cameraProjection(data, this.camera.near, this.camera.far), size: cameraSize(data) } : null;
  }
  private clearVisuals() {
    for (const child of [...this.visuals.children]) {
      this.visuals.remove(child);
      const helper = child as THREE.CameraHelper; helper.dispose();
    }
  }
  private highlighted = new Set<string>();
  private highlightColour = new THREE.Color(0xe08a3c);
  /** Draws these cameras (ids) in the accent colour: they are selected. */
  setHighlight(ids: string[], colour: THREE.Color) {
    const next = new Set(ids);
    if (next.size === this.highlighted.size && ids.every((id) => this.highlighted.has(id)) && this.highlightColour.equals(colour)) return;
    this.highlighted = next;
    this.highlightColour = colour.clone();
    this.rebuildVisuals();
  }
  private rebuildVisuals() {
    this.clearVisuals();
    for (const data of this.cameras) {
      // A short frustum shows direction without spanning the whole scene.
      const camera = cameraProjection(data, 2, 28);
      const helper = new THREE.CameraHelper(camera);
      const white = new THREE.Color(0xffffff);
      helper.setColors(data.id === this.editing ? new THREE.Color(0xffaa55) : this.highlighted.has(data.id) ? this.highlightColour.clone() : white.clone(), this.highlighted.has(data.id) ? this.highlightColour.clone() : white, white, white, white);
      // They write no depth, so in the opaque pass the see-through ground (drawn after it) would cover them: draw them with the
      // see-through things, after the ground, the grid and the shadows (render orders -3 to -1).
      for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) { material.depthWrite = false; material.transparent = true; }
      helper.renderOrder = 5;
      this.visuals.add(helper);
    }
  }
  private installInput(dom: HTMLElement) {
    const signal = this.events.signal;
    dom.addEventListener("pointerenter", () => { this.inside = true; }, { signal });
    dom.addEventListener("pointerleave", () => { this.inside = false; }, { signal });
    dom.addEventListener("pointerdown", event => {
      if (this.modal) { event.preventDefault(); event.stopImmediatePropagation(); this.finishModal(event.button !== 2); return; }
    }, { capture: true, signal });
    // in a fixed camera a drag with the right or the middle button slides the view over the screen
    let panning: { id: number; x: number; y: number; moved: boolean } | null = null;
    dom.addEventListener("pointerdown", event => {
      if (this.modal || !this.locked || (event.button !== 1 && event.button !== 2)) return;
      panning = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      dom.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, signal });
    dom.addEventListener("contextmenu", event => { if (panning?.moved || this.locked) event.preventDefault(); }, { capture: true, signal });
    const stopPan = (event: PointerEvent) => { if (panning?.id === event.pointerId) { dom.releasePointerCapture?.(event.pointerId); setTimeout(() => { panning = null; }); } };
    dom.addEventListener("pointerup", stopPan, { capture: true, signal });
    dom.addEventListener("pointercancel", stopPan, { capture: true, signal });
    dom.addEventListener("pointermove", event => {
      if (panning?.id === event.pointerId) {
        const dx = event.clientX - panning.x, dy = event.clientY - panning.y;
        panning.x = event.clientX; panning.y = event.clientY;
        if (dx || dy) { panning.moved = true; this.panView(dx, dy); }
        event.stopImmediatePropagation();
        return;
      }
      this.pointer = { x: event.clientX, y: event.clientY };
      if (this.modal) this.updateModal(dom);
    }, { capture: true, signal });
    const end = () => { this.navigation = null; if (this.active) this.orbit.enabled = !this.overlayEditing && this.navigatingView; };
    dom.addEventListener("pointerup", end, { capture: true, signal });
    dom.addEventListener("pointercancel", end, { capture: true, signal });
    // in a fixed camera the wheel zooms the view; nothing else of the navigation works
    dom.addEventListener("wheel", event => {
      if (!this.locked) return;
      event.stopImmediatePropagation();
      this.zoomView(Math.exp(event.deltaY * 0.001));
    }, { capture: true, passive: true, signal });
    window.addEventListener("keydown", event => {
      const target = event.target as HTMLElement | null;
      if (!this.inside || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!this.editing || this.controls.some(control => control.dragging)) return;
      const key = event.key.toLowerCase();
      if (this.modal) {
        if (key === "escape" || key === "enter") this.finishModal(key === "enter");
        else if (key === "x" || key === "y" || key === "z") { this.modal.axis = this.modal.axis === key ? null : key; this.updateModal(dom); }
        else return;
      } else if (!event.repeat && event.shiftKey && (gizmoKey(event) === "move" || gizmoKey(event) === "rotate")) {
        const position = this.pivot.position.clone();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), position);
        this.modal = { mode: gizmoKey(event) === "move" ? "translate" : "rotate", axis: null, position, quaternion: this.pivot.quaternion.clone(), pointer: { ...this.pointer }, plane, hit: this.rayHit(dom, plane) ?? position.clone() };
        this.orbit.enabled = false; this.applyParts();
      } else return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { signal });
  }
  private rayHit(dom: HTMLElement, plane: THREE.Plane) {
    const rect = dom.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((this.pointer.x - rect.left) / rect.width * 2 - 1, 1 - (this.pointer.y - rect.top) / rect.height * 2), this.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }
  private updateModal(dom: HTMLElement) {
    const modal = this.modal, data = this.cameras.find(c => c.id === this.editing); if (!modal || !data) return;
    const axis = modal.axis ? new THREE.Vector3(modal.axis === "x" ? 1 : 0, modal.axis === "y" ? 1 : 0, modal.axis === "z" ? 1 : 0).applyQuaternion(modal.quaternion) : this.camera.getWorldDirection(new THREE.Vector3());
    if (modal.mode === "translate") {
      const hit = this.rayHit(dom, modal.plane); if (!hit) return;
      const delta = hit.sub(modal.hit); if (modal.axis) { const amount = delta.dot(axis); delta.copy(axis).multiplyScalar(amount); }
      data.position = modal.position.clone().add(delta).toArray();
    } else {
      const angle = ((this.pointer.x - modal.pointer.x) - (this.pointer.y - modal.pointer.y)) * .005;
      data.quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(modal.quaternion).toArray();
    }
    this.refresh();
  }
  private finishModal(confirm: boolean) {
    const modal = this.modal; if (!modal) return;
    this.modal = null;
    const data = this.cameras.find(c => c.id === this.editing);
    if (data && !confirm) { data.position = modal.position.toArray(); data.quaternion = modal.quaternion.toArray(); }
    this.orbit.enabled = !this.active; this.applyParts(); this.refresh();
  }
  dispose() { this.backdrop.dispose(); this.orbit.removeEventListener("change", this.saveNavigation); this.events.abort(); this.stopEditing(); this.leave(); this.clearVisuals(); this.gizmos.dispose(); this.scene.remove(this.pivot, this.visuals); this.frame.remove(); }
}
