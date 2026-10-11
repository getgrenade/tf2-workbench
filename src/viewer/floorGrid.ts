import * as THREE from "three";

/** Distance between the thin lines, in model units; every fourth line is a little stronger. */
const CELL = 64;
const MAJOR_EVERY = 4;

/**
 * A subtle grid on the floor, fixed in the world (it only follows the group of characters in whole cells, so the lines never
 * slide), so a moving character can be told apart from a turning camera. Drawn as one quad with a procedural line shader that
 * fades out towards its edges.
 */
export class FloorGrid {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uHalf: { value: 500 }, uCell: { value: CELL }, uMajor: { value: MAJOR_EVERY }, uColor: { value: new THREE.Vector3(0.62, 0.62, 0.62) }, uOpacity: { value: 0.3 } },
      vertexShader: `varying vec2 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: `uniform float uHalf;
uniform float uCell;
uniform float uMajor;
uniform vec2 center;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vWorld;
float lines(vec2 p) {
  vec2 d = fwidth(p);
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(d, vec2(1e-5));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float minor = lines(vWorld / uCell);
  float major = lines(vWorld / (uCell * uMajor));
  float a = max(minor * 0.55, major) * uOpacity;
  float fade = 1.0 - smoothstep(0.25, 1.0, length(vWorld - center) / uHalf);
  gl_FragColor = vec4(uColor, a * fade);
}`,
      transparent: true,
      depthWrite: false,
    });
    this.material.uniforms.center = { value: new THREE.Vector2() };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material);
    this.mesh.renderOrder = -2; // after the ground plane (-3), so the lines lie over it, and before the ground shadow (-1), so the shadow lies over them
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Colour (linear) and opacity of the lines (of the stronger ones; the thin ones are about half of it). */
  setStyle(color: THREE.Vector3, opacity: number) {
    this.material.uniforms.uColor.value.copy(color);
    this.material.uniforms.uOpacity.value = opacity;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  /** Keeps the grid under the group of characters (snapped to whole cells, the lines are in world space anyway). */
  update(cx: number, cz: number, floorY: number, radius: number) {
    const half = Math.max(radius * 10, 300);
    const snap = CELL * MAJOR_EVERY;
    const x = Math.round(cx / snap) * snap;
    const z = Math.round(cz / snap) * snap;
    this.mesh.position.set(x, floorY + 0.02, z);
    this.mesh.scale.set(half * 2, 1, half * 2);
    this.material.uniforms.uHalf.value = half;
    (this.material.uniforms.center.value as THREE.Vector2).set(x, z);
  }
}
