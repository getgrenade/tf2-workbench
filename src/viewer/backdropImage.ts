/**
 * A picture of the user's own behind the scene of a camera (set in the overlay editor): it is drawn after the sky and before everything else,
 * so the sky shows around it and the characters, the ground and the fog are over it. It sits on the screen, not in the world: its place and
 * size are those of the camera's frame (the same fractions of it that the overlay elements use), so a shot has it where the editor has it.
 */
import * as THREE from "three";
import type { OverlayBackground } from "./overlayData";

/** A rectangle on the screen in device coordinates: -1..1 from the left, and from the bottom. */
interface NdcRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Where the picture is on the screen: its middle (device coordinates), the device size of one frame height along each axis, and its size
 * and turn in the frame. `frame` is the frame's rectangle and `frameAspect` its width over its height.
 */
export function backdropPlace(bg: Pick<OverlayBackground, "x" | "y" | "size" | "aspect" | "rotation">, frame: NdcRect, frameAspect: number) {
  const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
  return {
    // the frame's y runs down from its top, the screen's up from the bottom
    cx: frame.x0 + bg.x * w, cy: frame.y1 - bg.y * h,
    // one frame height is this far across the screen, along x (a frame is wider than it is tall) and along y
    ux: w / Math.max(0.01, frameAspect), uy: h,
    width: bg.size * bg.aspect, height: bg.size, rotation: (bg.rotation ?? 0) * Math.PI / 180,
  };
}

/** The place on the screen of a point of the picture, given as its offset from the middle in the picture's own widths and heights (-0.5..0.5). */
export function backdropCorner(bg: Pick<OverlayBackground, "x" | "y" | "size" | "aspect" | "rotation">, frame: NdcRect, frameAspect: number, ox: number, oy: number): [number, number] {
  const p = backdropPlace(bg, frame, frameAspect);
  // in a y-down frame, turning clockwise
  const lx = ox * p.width, ly = -oy * p.height, c = Math.cos(p.rotation), s = Math.sin(p.rotation);
  const rx = lx * c - ly * s, ry = lx * s + ly * c;
  return [p.cx + rx * p.ux, p.cy - ry * p.uy];
}

export class Backdrop {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private texture: THREE.Texture | null = null;
  private source = "";
  private token = 0;
  private current: OverlayBackground | undefined;
  private aspect = 16 / 9;
  private saved: { visible: boolean; center: THREE.Vector2; unit: THREE.Vector2; size: THREE.Vector2; turn: THREE.Vector2 } | null = null;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { tImage: { value: null }, uCenter: { value: new THREE.Vector2() }, uUnit: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) }, uTurn: { value: new THREE.Vector2(1, 0) }, uOpacity: { value: 1 } },
      // the corners of the picture are put on the screen directly (turned about its middle), and at the far end of the depth, so that whatever is drawn is over it
      vertexShader: `varying vec2 vUv; uniform vec2 uCenter; uniform vec2 uUnit; uniform vec2 uSize; uniform vec2 uTurn;
void main() {
  vUv = uv;
  vec2 l = vec2(position.x * uSize.x, -position.y * uSize.y);
  vec2 r = vec2(l.x * uTurn.x - l.y * uTurn.y, l.x * uTurn.y + l.y * uTurn.x);
  gl_Position = vec4(uCenter + vec2(r.x * uUnit.x, -r.y * uUnit.y), 0.99999, 1.0);
}`,
      fragmentShader: "uniform sampler2D tImage; uniform float uOpacity; varying vec2 vUv; void main() { vec4 c = texture2D(tImage, vUv); gl_FragColor = vec4(c.rgb, c.a * uOpacity); }",
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.material.userData.noShadow = true;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -10; // before the ground, its grid and the shadows
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Shows the picture of a camera in the frame (`frame` in pixels of a view that is `view` big), or nothing when there is none. */
  update(bg: OverlayBackground | undefined, frame: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }) {
    this.current = bg;
    if (!bg) { this.mesh.visible = false; return; }
    this.aspect = frame.w / Math.max(1, frame.h);
    this.load(bg.image);
    const ndc: NdcRect = { x0: frame.x / view.w * 2 - 1, x1: (frame.x + frame.w) / view.w * 2 - 1, y1: 1 - frame.y / view.h * 2, y0: 1 - (frame.y + frame.h) / view.h * 2 };
    this.place(bg, ndc, this.aspect);
  }

  hide() {
    this.current = undefined;
    this.mesh.visible = false;
  }

  /** A picture is being taken through the camera: the frame is the whole picture (`show` false: a picture that is not of the camera, with no backdrop). */
  beginCapture(show: boolean, aspect: number) {
    const u = this.material.uniforms;
    this.saved = { visible: this.mesh.visible, center: u.uCenter.value.clone(), unit: u.uUnit.value.clone(), size: u.uSize.value.clone(), turn: u.uTurn.value.clone() };
    if (show && this.current) this.place(this.current, { x0: -1, y0: -1, x1: 1, y1: 1 }, aspect);
    else this.mesh.visible = false;
  }

  endCapture() {
    if (!this.saved) return;
    this.mesh.visible = this.saved.visible;
    const u = this.material.uniforms;
    u.uCenter.value.copy(this.saved.center); u.uUnit.value.copy(this.saved.unit); u.uSize.value.copy(this.saved.size); u.uTurn.value.copy(this.saved.turn);
    this.saved = null;
  }

  private place(bg: OverlayBackground, frame: NdcRect, frameAspect: number) {
    const p = backdropPlace(bg, frame, frameAspect);
    const u = this.material.uniforms;
    u.uCenter.value.set(p.cx, p.cy); u.uUnit.value.set(p.ux, p.uy); u.uSize.value.set(p.width, p.height); u.uTurn.value.set(Math.cos(p.rotation), Math.sin(p.rotation));
    u.uOpacity.value = bg.opacity;
    this.mesh.visible = !!this.texture && bg.opacity > 0;
  }

  /** Makes the texture of a picture (a data URL); it shows as soon as it is decoded. */
  private load(image: string) {
    if (image === this.source) return;
    this.source = image;
    const token = ++this.token;
    const picture = new Image();
    picture.onload = () => {
      if (token !== this.token) return;
      const texture = new THREE.Texture(picture);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.texture?.dispose();
      this.texture = texture;
      this.material.uniforms.tImage.value = texture;
      if (this.current) this.mesh.visible = this.current.opacity > 0;
    };
    picture.onerror = () => { if (token === this.token) this.mesh.visible = false; };
    picture.src = image;
  }

  dispose() {
    this.token++;
    this.texture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
