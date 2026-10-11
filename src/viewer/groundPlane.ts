/**
 * A plane at the height of the floor, in a colour and with an opacity of its own, that fades out with the distance from the scene: so that a
 * sky behind the scene has something below the horizon to stand on, and the bottom of the skybox is not all there is to see.
 */
import * as THREE from "three";

export interface GroundState {
  enabled: boolean;
  /** Colour as shown in the picker (`#rrggbb`). */
  color: string;
  opacity: number;
  /** How far from the middle of the scene the plane has faded out, in character heights. */
  distance: number;
  /** How much of that distance the fade takes up, 0 (an edge) to 1 (from the middle). */
  softness: number;
}

export const DEFAULT_GROUND: GroundState = { enabled: false, color: "#6b6b6b", opacity: 1, distance: 12, softness: 0.6 };

export function parseGround(raw: unknown): GroundState | undefined {
  const v = raw as Partial<GroundState> | null;
  if (!v || typeof v !== "object") return undefined;
  const n = (x: unknown, fallback: number, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
  return {
    enabled: v.enabled === true,
    color: typeof v.color === "string" && /^#[\da-f]{6}$/i.test(v.color) ? v.color : DEFAULT_GROUND.color,
    opacity: n(v.opacity, DEFAULT_GROUND.opacity, 0, 1),
    distance: n(v.distance, DEFAULT_GROUND.distance, 1, 100),
    softness: n(v.softness, DEFAULT_GROUND.softness, 0, 1),
  };
}

/** Where the fade starts and ends, in world units from the middle of the scene. */
export function groundFade(state: GroundState, unit: number): { start: number; end: number } {
  const end = state.distance * unit;
  return { start: end * (1 - state.softness), end };
}

export class GroundPlane {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uCenter: { value: new THREE.Vector2() }, uFade: { value: new THREE.Vector2(0, 1) } },
      vertexShader: "varying vec2 vXZ; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "uniform vec3 uColor; uniform float uOpacity; uniform vec2 uCenter; uniform vec2 uFade; varying vec2 vXZ; void main() { float d = length(vXZ - uCenter); gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(uFade.x, uFade.y, d))); }",
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.material.userData.noShadow = true; // it does not cast a shadow, on the ground or from the lights
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    // The see-through things under the characters all draw without writing depth, so their order is the render order alone (equal
    // orders would be sorted by their distance from the camera, which changes as it moves): the ground, then the grid (-2), then the shadows (-1).
    this.mesh.renderOrder = -3;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `unit` is the length of a character, `cx` and `cz` the middle of the scene and `floorY` the height of the floor. */
  update(state: GroundState, cx: number, cz: number, floorY: number, unit: number) {
    this.mesh.visible = state.enabled && state.opacity > 0;
    if (!this.mesh.visible) return;
    const { start, end } = groundFade(state, unit);
    this.material.uniforms.uColor.value.set(state.color);
    this.material.uniforms.uOpacity.value = state.opacity;
    this.material.uniforms.uCenter.value.set(cx, cz);
    this.material.uniforms.uFade.value.set(start, end);
    this.mesh.position.set(cx, floorY - 0.03, cz);
    this.mesh.scale.set(end, 1, end); // as wide as the fade reaches
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
