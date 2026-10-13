/**
 * Small pictures of the prop models for the browser: each is drawn once, on demand, by a renderer of its own (a flat-lit view of the model's
 * first level of detail with its first skin's diffuse texture), and kept as an image for the rest of the session. They are not the viewer's
 * pictures of a prop (no material effects, no lighting of the scene): they only have to tell props apart in a list.
 */
import * as THREE from "three";
import { loadMaterial, loadModel } from "../api";
import { SOURCE_TO_VIEWER } from "../viewer/animator";
import { keepPicture, keptPicture } from "../thumbCache";
import { parseMaterial, parsePayload, type MeshData } from "../viewer/payload";

const SIZE = 160;

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

function stage() {
  if (renderer) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/** The diffuse texture of a material of the game (and whether it cuts or blends by its alpha), or none. */
async function diffuse(path: string): Promise<{ texture: THREE.DataTexture | null; alphaTest: boolean; blend: boolean }> {
  try {
    const m = parseMaterial(await loadMaterial(path));
    const base = m.textures.base;
    if (!base) return { texture: null, alphaTest: false, blend: false };
    const texture = new THREE.DataTexture(new Uint8Array(base.rgba), base.width, base.height, THREE.RGBAFormat);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const flag = (k: string) => Number(m.params[k] ?? 0) !== 0;
    return { texture, alphaTest: flag("$alphatest"), blend: flag("$translucent") };
  } catch {
    return { texture: null, alphaTest: false, blend: false };
  }
}

async function draw(path: string): Promise<string | null> {
  // the picture of an earlier launch, if the game has not changed since
  const kept = await keptPicture("prop", path);
  if (kept) return kept;
  const data = parsePayload(await loadModel(path));
  const meshes: MeshData[] = [];
  for (const part of data.bodyParts) for (const mesh of part.models[0]?.meshes ?? []) if (mesh.indices.length) meshes.push(mesh);
  if (!meshes.length) return null;
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    // a prop's geometry is in Source's frame, Z up: it is stood up for the view
    geometry.applyMatrix4(SOURCE_TO_VIEWER);
    const tex = await diffuse(mesh.materials[0] ?? mesh.material);
    const material = new THREE.MeshLambertMaterial({ map: tex.texture, color: tex.texture ? 0xffffff : 0x9a9a9a, side: THREE.DoubleSide, alphaTest: tex.alphaTest ? 0.5 : 0, transparent: tex.blend });
    scene.add(new THREE.Mesh(geometry, material));
    disposables.push(geometry, material, ...(tex.texture ? [tex.texture] : []));
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
  }
  if (box.isEmpty()) return null;
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-1, 2, 1.5);
  scene.add(sun);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(32, 1, Math.max(0.01, sphere.radius * 0.05), sphere.radius * 20);
  const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.75, 1.15).normalize().multiplyScalar(distance));
  camera.lookAt(sphere.center);
  const r = stage();
  r.render(scene, camera);
  keepPicture("prop", path, r.domElement);
  const url = r.domElement.toDataURL("image/png");
  for (const d of disposables) d.dispose();
  return url;
}

/** Forgets the picture of a model (it was built again). */
export function forgetThumbnail(path: string) {
  cache.delete(path);
}

/** The picture of a prop model (`models/props_c17/barrel001.mdl`) as a data URL; null when it has no geometry or could not be drawn. */
export function propThumbnail(path: string, wanted: () => boolean = () => true): Promise<string | null> {
  let made = cache.get(path);
  if (!made) {
    // one at a time: each loads a model and its textures, and the pictures are not worth slowing the rest of the program for;
    // one that is no longer wanted when its turn comes (scrolled away, filtered out) is skipped and may be asked for again
    made = new Promise<string | null>((resolve) => {
      chain = chain.then(() => {
        if (!wanted()) { cache.delete(path); resolve(null); return; }
        return draw(path).then(resolve, () => resolve(null));
      });
    });
    cache.set(path, made);
  }
  return made;
}
