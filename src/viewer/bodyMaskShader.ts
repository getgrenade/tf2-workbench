/** Packed UV membership is shared by the visible material and its ground-shadow silhouette. */
export const bodyMaskDeclarations = /* glsl */ `
uniform sampler2D tBodyMask;
uniform float uBodyHideBits;
varying vec2 vBodyUv;
`;
export const bodyMaskDiscard = /* glsl */ `
  if (uBodyHideBits > 0.0) {
    vec2 bytes = floor(texture2D(tBodyMask, vBodyUv).rg * 255.0 + 0.5);
    float membership = bytes.r + bytes.g * 256.0;
    for (int bit = 0; bit < 16; bit++) {
      float power = exp2(float(bit));
      if (mod(floor(membership / power), 2.0) > 0.5 && mod(floor(uBodyHideBits / power), 2.0) > 0.5) discard;
    }
  }
`;
