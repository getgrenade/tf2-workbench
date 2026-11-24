import * as THREE from "three";
import { loadModel } from "../api";
import { SOURCE_TO_VIEWER } from "./animator";
import { parsePayload } from "./payload";

/**
 * The see-through preview of what is being dragged into the view (a character, a buildable, a prop): its model in its reference pose,
 * drawn flat and faint where it will be put when it is dropped.
 */
export class PlacementGhost {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.38, depthWrite: false });
  private readonly cache = new Map<string, Promise<{ group: THREE.Group; minY: number } | null>>();
  private shown: string | null = null;
  private token = 0;

  constructor() {
    // (it casts no shadow)
    this.material.userData.noShadow = true;
    this.group.name = "placementGhost";
    this.group.visible = false;
    this.group.renderOrder = 10;
  }

  private build(path: string) {
    let p = this.cache.get(path);
    if (!p) {
      p = loadModel(path)
        .then((buf) => {
          const data = parsePayload(buf);
          const group = new THREE.Group();
          const inner = new THREE.Group();
          inner.matrixAutoUpdate = false;
          inner.matrix.copy(SOURCE_TO_VIEWER);
          group.add(inner);
          let minY = Infinity;
          for (const part of data.bodyParts) {
            for (const md of part.models[0]?.meshes ?? []) {
              const geo = new THREE.BufferGeometry();
              geo.setAttribute("position", new THREE.BufferAttribute(md.positions, 3));
              geo.setIndex(new THREE.BufferAttribute(md.indices, 1));
              geo.computeBoundingSphere();
              const mesh = new THREE.Mesh(geo, this.material);
              mesh.renderOrder = 10;
              inner.add(mesh);
              // (Source's z is the view's y)
              for (let i = 2; i < md.positions.length; i += 3) minY = Math.min(minY, md.positions[i]);
            }
          }
          return { group, minY: Number.isFinite(minY) ? minY : 0 };
        })
        .catch(() => null);
      this.cache.set(path, p);
    }
    return p;
  }

  /**
   * Shows the model of `path` at `point` (null: hides it). With `onLowest` it stands on its lowest point (a prop), else on its origin
   * (a character or a buildable); `scale` is the size it is added at (a giant's).
   */
  async show(path: string | null, point: THREE.Vector3 | null, onLowest = false, scale = 1) {
    if (!path || !point) {
      this.group.visible = false;
      return;
    }
    const token = ++this.token;
    const built = await this.build(path);
    if (token !== this.token) return;
    if (!built) {
      this.group.visible = false;
      return;
    }
    if (this.shown !== path) {
      this.group.clear();
      this.group.add(built.group);
      this.shown = path;
    }
    this.group.scale.setScalar(scale);
    this.group.position.set(point.x, point.y - (onLowest ? built.minY * scale : 0), point.z);
    this.group.visible = true;
  }

  hide() {
    this.token++;
    this.group.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.material.dispose();
  }
}
