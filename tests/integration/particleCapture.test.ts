import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { resolveCaptureEmission } from "../../src/viewer/captureAlpha";
import { ParticleDraw } from "../../src/viewer/particles/render";
import { ParticleRopeDraw } from "../../src/viewer/particles/rope";
import { NativeRenderNode } from "../../src/viewer/particles/native";
import { GroundShadow } from "../../src/viewer/groundShadow";
import { DEFAULT_SHADOW } from "../../src/viewer/shadowMath";

test("PNG glow coverage retains light on black and has no dark card on white", () => {
  const pixels = new Uint8Array([0,0,0,0, 180,90,0,0, 2,1,0,0, 80,40,0,10]);
  const original = pixels.slice();
  resolveCaptureEmission(pixels);
  assert.deepEqual([...pixels.slice(0,4)], [0,0,0,0]);
  for (let i=4; i<pixels.length; i+=4) {
    const a = pixels[i+3]/255;
    assert.equal(pixels[i],255); // golden glow has no black edge in its brightest channel
    for (let c=0; c<3; c++) {
      assert.ok(Math.abs(pixels[i+c]*a-original[i+c]) <= .5);
      assert.ok(pixels[i+c]*a+255*(1-a) >= 255*(1-a));
    }
  }
});

test("opaque surfaces and soft black ground shadows keep their alpha", () => {
  const pixels = new Uint8Array([110,50,20,255, 0,0,0,83]);
  const original = pixels.slice();
  resolveCaptureEmission(pixels);
  assert.deepEqual(pixels, original);
});

function draws(additive: boolean) {
  const texture = new THREE.DataTexture(new Uint8Array([255,200,0,255]),1,1);
  const source = {texture, sheet:new Map(), additive};
  const definition = {name:"test",attributes:{},children:[],functions:{renderers:[{attributes:{functionName:"render_rope"}}]}} as any;
  const sim = new NativeRenderNode(definition,2);
  return [new ParticleDraw(sim,source),new ParticleRopeDraw(sim,source)];
}

test("sprite and rope RGB blending stays additive while alpha preserves surface coverage", () => {
  const effects = draws(true);
  for (const [index, effect] of effects.entries()) {
    const material = effect.mesh.material as THREE.ShaderMaterial;
    assert.equal(material.blending,THREE.CustomBlending);
    assert.equal(material.blendSrc,index===0 ? THREE.OneFactor : THREE.SrcAlphaFactor);
    assert.equal(material.blendDst,THREE.OneFactor);
    assert.equal(material.blendSrcAlpha,THREE.ZeroFactor);
    assert.equal(material.blendDstAlpha,THREE.OneFactor);
    effect.dispose();
  }
});

test("ground shadow pass excludes additive and normal particle sprites and ropes, restoring visibility", () => {
  const scene = new THREE.Scene();
  const body = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  const effects = [...draws(true),...draws(false)];
  scene.add(body,...effects.map(effect=>effect.mesh));
  let renders=0;
  const renderer = {
    getRenderTarget:()=>null, getClearColor:(color:THREE.Color)=>color.set(0),getClearAlpha:()=>1,
    setClearColor:()=>{},setRenderTarget:()=>{},clear:()=>{},
    render:(drawScene:THREE.Scene)=>{
      if (drawScene!==scene) return;
      renders++;
      assert.ok(body.visible);
      for (const effect of effects) assert.equal(effect.mesh.visible,false);
    },
  } as unknown as THREE.WebGLRenderer;
  const shadow = new GroundShadow(renderer,scene);
  shadow.update({...DEFAULT_SHADOW,enabled:true,blur:0},0,0,40,0,[]);
  assert.equal(renders,1);
  for (const effect of effects) {assert.ok(effect.mesh.visible);effect.dispose();}
  shadow.dispose();body.geometry.dispose();(body.material as THREE.Material).dispose();
});
