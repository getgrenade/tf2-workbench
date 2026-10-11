import * as THREE from "three";

/** Stable camera identity keeps OrbitControls, picking and all gizmos on the same viewport camera. */
export class ViewportCamera extends THREE.PerspectiveCamera {
  isOrthographicCamera = false;
  halfHeight = 1;
  left = -1;
  right = 1;
  top = 1;
  bottom = -1;
  setOrthographic(enabled: boolean, distance: number) {
    if (enabled && !this.isOrthographicCamera) this.halfHeight = Math.max(.001, distance * Math.tan(THREE.MathUtils.degToRad(this.fov) / 2));
    this.isOrthographicCamera = enabled;
    (this as unknown as { isPerspectiveCamera: boolean }).isPerspectiveCamera = !enabled;
    this.updateProjectionMatrix();
  }
  override updateProjectionMatrix() {
    if (!this.isOrthographicCamera) { super.updateProjectionMatrix(); return; }
    this.top = this.halfHeight; this.bottom = -this.halfHeight;
    this.left = -this.halfHeight * this.aspect; this.right = -this.left;
    THREE.OrthographicCamera.prototype.updateProjectionMatrix.call(this as unknown as THREE.OrthographicCamera);
  }
  override copy(source: THREE.PerspectiveCamera, recursive?: boolean): this {
    super.copy(source, recursive);
    const camera = source as Partial<ViewportCamera>;
    this.isOrthographicCamera = camera.isOrthographicCamera === true;
    (this as unknown as { isPerspectiveCamera: boolean }).isPerspectiveCamera = !this.isOrthographicCamera;
    this.halfHeight = camera.halfHeight ?? 1;
    this.left = camera.left ?? -1; this.right = camera.right ?? 1; this.top = camera.top ?? 1; this.bottom = camera.bottom ?? -1;
    return this;
  }
}
