import * as THREE from "three";

/** Emission adds light, not opaque coverage. Preserve destination alpha. */
export function particleBlending(additive: boolean, premultiplied = false): Partial<THREE.ShaderMaterialParameters> {
  return additive ? {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: premultiplied ? THREE.OneFactor : THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  } : { blending: THREE.NormalBlending };
}
