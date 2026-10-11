import * as THREE from "three";
import { loadMaterial } from "../../api";
import { SOURCE_TO_VIEWER } from "../animator";
import { parseMaterial, type TextureData } from "../payload";

/**
 * The blood the game leaves on the ground where a gib lands. A gib model that asks for it (`world_interactions { onworldimpact
 * bloodsplat }` in its keyvalues) calls UTIL_BloodDecalTrace when it touches the world (physpropclientside.cpp HitSurface), which
 * shoots the "Blood" decal group of scripts/decals_subrect.txt: one of six sub-rectangles of the decals_mod2x atlas, each a "Subrect"
 * material with a position, a size and a $decalscale. The atlas is a modulate-2x decal: it multiplies the surface by twice its colour,
 * so mid grey leaves it alone and the blood darkens and reddens it.
 */
export const BLOOD_DECAL_MATERIALS = [1, 2, 3, 4, 5, 6].map((n) => `decals/blood${n}_subrect`);
export const DECAL_ATLAS = "decals/decals_mod2x";
/** Decals kept at once; the oldest is reused after that. */
export const MAX_DECALS = 100;
/** How far above the surface a decal lies, against flicker. */
const LIFT = 0.15;

export interface DecalRect {
  /** The sub-rectangle in atlas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** World units per pixel ($decalscale). */
  scale: number;
}

/** A "Subrect" material's `$pos`, `$size` and `$decalscale` (lowercase keys, as the loader gives them), or null when it has none. */
export function parseSubrect(params: Record<string, string>): DecalRect | null {
  const pair = (text: string | undefined) => {
    const parts = (text ?? "").trim().replace(/[\[\]]/g, "").split(/\s+/).map(Number);
    return parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite) ? [parts[0], parts[1]] : null;
  };
  const pos = pair(params["$pos"]), size = pair(params["$size"]);
  if (!pos || !size || size[0] <= 0 || size[1] <= 0) return null;
  const scale = Number(params["$decalscale"] ?? 1);
  return { x: pos[0], y: pos[1], w: size[0], h: size[1], scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

/** What a decal needs from the game: the atlas and the sub-rectangles of its variants. */
export interface DecalAssets {
  atlas: TextureData;
  variants: DecalRect[];
}

export async function loadBloodDecalAssets(): Promise<DecalAssets> {
  const atlas = parseMaterial(await loadMaterial(`materials/${DECAL_ATLAS}.vmt`)).textures.base;
  if (!atlas) throw new Error("The decal atlas has no texture");
  const variants: DecalRect[] = [];
  for (const name of BLOOD_DECAL_MATERIALS) {
    const rect = parseSubrect(parseMaterial(await loadMaterial(`materials/${name}.vmt`)).params);
    if (rect) variants.push(rect);
  }
  if (!variants.length) throw new Error("No blood decal variants");
  return { atlas, variants };
}

/** What the hit reactions need from a decal layer (the real one below, or a stand-in in tests). */
export interface DecalSink {
  readonly group: THREE.Group;
  /** Shoots a decal at a point of a surface (Source space) facing along `normal`. */
  add(position: THREE.Vector3, normal?: THREE.Vector3): void;
  dispose(): void;
}

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec4 rect;
varying vec2 vUv;
void main() {
  vec3 tex = texture2D(map, mix(rect.xy, rect.zw, vec2(vUv.x, 1.0 - vUv.y))).rgb;
  // The game modulates in gamma space (2 * surface * decal); the scene here is linear, so the decal is linearised and 2^2.2 / 2 scales it.
  gl_FragColor = vec4(pow(tex, vec3(2.2)) * 2.2974, 1.0);
}`;

/** The blood decals of a scene, in Source space (the group carries the conversion to the viewer's). */
export class BloodDecals implements DecalSink {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private materials: THREE.ShaderMaterial[] = [];
  private variants: DecalRect[] = [];
  private texture: THREE.DataTexture | null = null;
  private readonly meshes: THREE.Mesh[] = [];
  private next = 0;
  private pending: { position: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  private disposed = false;
  /** Resolves when the atlas is loaded (decals asked for before that appear then). */
  readonly ready: Promise<void>;

  constructor(load: () => Promise<DecalAssets> = loadBloodDecalAssets, private readonly random: () => number = Math.random, private readonly max = MAX_DECALS) {
    this.group.name = "Blood decals";
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(SOURCE_TO_VIEWER);
    this.ready = load().then((assets) => this.build(assets)).catch((error) => {
      if (!this.disposed) console.error("Blood decals unavailable", error);
    });
  }

  private build({ atlas, variants }: DecalAssets) {
    if (this.disposed) return;
    const texture = new THREE.DataTexture(atlas.rgba, atlas.width, atlas.height, THREE.RGBAFormat);
    texture.flipY = false; // pixel rows run top to bottom, like the UVs
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false; // no bleeding between neighbouring sub-rectangles
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.texture = texture;
    this.variants = variants;
    this.materials = variants.map((v) => new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, rect: { value: new THREE.Vector4(v.x / atlas.width, v.y / atlas.height, (v.x + v.w) / atlas.width, (v.y + v.h) / atlas.height) } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
      // modulate 2x: destination * source + source * destination
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      userData: { noShadow: true },
    }));
    const queued = this.pending;
    this.pending = [];
    for (const d of queued) this.add(d.position, d.normal);
  }

  /** The quaternion that lays a decal (a unit square facing +Z) on a surface with this normal, turned by `angle` about it. */
  static orientation(normal: THREE.Vector3, angle: number, out = new THREE.Quaternion()) {
    out.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    return out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle));
  }

  get count() { return this.meshes.length; }

  add(position: THREE.Vector3, normal = new THREE.Vector3(0, 0, 1)) {
    if (this.disposed) return;
    if (!this.materials.length) { if (this.pending.length < this.max) this.pending.push({ position: position.clone(), normal: normal.clone() }); return; }
    const index = Math.min(this.variants.length - 1, Math.floor(this.random() * this.variants.length));
    const rect = this.variants[index];
    let mesh: THREE.Mesh;
    if (this.meshes.length < this.max) {
      mesh = new THREE.Mesh(this.geometry, this.materials[index]);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1; // under the shadow and the particles
      this.meshes.push(mesh);
      this.group.add(mesh);
    } else {
      mesh = this.meshes[this.next++ % this.max]; // the oldest
      mesh.material = this.materials[index];
    }
    const n = normal.clone().normalize();
    BloodDecals.orientation(n, this.random() * Math.PI * 2, mesh.quaternion);
    mesh.position.copy(position).addScaledVector(n, LIFT);
    mesh.scale.set(rect.w * rect.scale, rect.h * rect.scale, 1);
    mesh.updateMatrix();
  }

  dispose() {
    this.disposed = true;
    this.pending = [];
    for (const mesh of this.meshes) mesh.removeFromParent();
    this.meshes.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.geometry.dispose();
    this.texture?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
