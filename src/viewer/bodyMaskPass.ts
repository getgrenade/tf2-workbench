import * as THREE from "three";
import { bodyMaskDeclarations, bodyMaskDiscard } from "./bodyMaskShader";

/** Makes a shared picking/wireframe/shadow override respect the mask of each mesh it draws. */
export function bodyMaskPass(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  material.uniforms.tBodyMask = { value: null };
  material.uniforms.uBodyHideBits = { value: 0 };
  material.vertexShader = "varying vec2 vBodyUv;\n" + material.vertexShader.replace("void main() {", "void main() { vBodyUv = uv;");
  material.fragmentShader = bodyMaskDeclarations + material.fragmentShader.replace("void main() {", `void main() { ${bodyMaskDiscard}`);
  material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
    const mask = object.userData.bodyMask;
    material.uniforms.tBodyMask.value = mask?.texture ?? null;
    material.uniforms.uBodyHideBits.value = mask?.bits ?? 0;
    material.uniformsNeedUpdate = true;
  };
  return material;
}
