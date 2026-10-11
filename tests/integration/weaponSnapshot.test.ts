import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WeaponEffects } from "../../src/viewer/particles/weapons";
import { NativeRenderNode } from "../../src/viewer/particles/native";
import { parseWeaponSnapshot } from "../../src/viewer/particles/weaponSnapshot";
import { parseScene } from "../../src/viewer/scene";
import { Actor } from "../../src/viewer/actor";

function fixture() {
  const actor=Object.create(Actor.prototype) as Actor;
  const root=new THREE.Group();Object.assign(actor,{modelGroup:root});
  const effect=new (WeaponEffects as any)(actor,null,"",{attachments:[],hitboxes:[]},0);
  const definition={name:"muzzle",attributes:{},functions:{renderers:[]},children:[]};
  const node=new NativeRenderNode(definition,2);
  node.apply({id:0,name:"muzzle",capacity:2,time:2,dt:1/60,particles:[[100,20,60,1,.5,.2,.8,12,.3,1.9,.5,3,.4,98,20,60,.1]]});
  effect.nodes.push({file:"particles/muzzle_flash.pcf",node});
  const shell=new THREE.Group();shell.position.set(30,20,4);shell.rotation.set(.2,.5,.7,"ZYX");
  effect.shellModel="models/weapons/shells/shell_shotgun.mdl";
  effect.shells.push({group:shell,velocity:new THREE.Vector3(100,0,0),angular:new THREE.Vector3(1,2,3),age:1,settled:false,fading:[]});
  effect.group.add(shell);return {actor,root,effect,node,shell};
}

test("exit snapshot freezes simulation, shell physics and sprite clock while keeping camera updates",()=>{
  const {root,effect,node,shell}=fixture();let disposed=0,updates=0;
  effect.sims.push({dispose:()=>disposed++,step:()=>{throw Error("Frozen simulation stepped");}});
  effect.draws.push({update:()=>updates++});effect.pendingShells.push(2);
  effect.freeze();const saved=effect.snapshot();
  for(let i=0;i<60;i++) effect.step(.1,new THREE.PerspectiveCamera());
  assert.equal(disposed,1);assert.equal(updates,60);assert.equal(node.time,2);assert.equal(effect.pendingShells.length,0);
  assert.deepEqual(effect.snapshot(),saved,"No particle ages, sheet frames or shell transforms advance");
  const world=shell.getWorldPosition(new THREE.Vector3());
  root.position.set(200,40,-90);root.rotation.y=1.2;effect.step(.1,new THREE.PerspectiveCamera());
  assert.ok(shell.getWorldPosition(new THREE.Vector3()).distanceTo(world)<1e-7,"Frozen particles remain at their world position when the character moves");
});

test("scene round trip preserves particle appearance/trails and shells in independently owned arrays",()=>{
  const {effect,node}=fixture();effect.freeze();const snapshot=effect.snapshot();
  const scene={app:"tf2-workbench",version:1,camera:{position:[1,2,3],target:[0,0,0]},entities:[{cls:"engineer",weaponParticles:snapshot}]};
  const restored=parseScene(JSON.stringify(scene)).entities[0].weaponParticles!;
  assert.deepEqual(restored,snapshot);
  restored.nodes[0].particles[0][0]=999;
  assert.equal(snapshot.nodes[0].particles[0][0],100);assert.equal(node.particles[0].position.x,100);
  const clone=parseWeaponSnapshot(snapshot)!;snapshot.shells[0].matrix[12]=888;
  assert.equal(clone.shells[0].matrix[12],30);
  assert.equal(parseScene(JSON.stringify({...scene,entities:[{cls:"engineer"}]})).entities[0].weaponParticles,undefined,"Older scenes remain valid");
});

test("malformed snapshots do not reach the renderer",()=>{
  const {effect}=fixture();const saved=effect.snapshot();
  assert.equal(parseWeaponSnapshot({...saved,nodes:[{...saved.nodes[0],file:"../escape.pcf"}]}),undefined);
  assert.equal(parseWeaponSnapshot({...saved,nodes:[{...saved.nodes[0],particles:[[1,2]]}]}),undefined);
  assert.equal(parseWeaponSnapshot({...saved,shells:[{matrix:[NaN],age:1}]}),undefined);
});

test("restoring a snapshot rebuilds render state without starting native emitters",async()=>{
  // Minimal PCF definition. Asset I/O is mocked; the actual restore path and native
  // render node conversion execute, including original casing-model retrieval.
  const word=(n:number,size:number)=>{const b=Buffer.alloc(size);size===2?b.writeUInt16LE(n):b.writeInt32LE(n);return b;};
  const text=(s:string)=>Buffer.from(s+"\0");
  const pcf=Buffer.concat([text("<!-- dmx encoding binary 2 format pcf 1 -->"),word(1,2),text("DmeParticleSystemDefinition"),
    word(1,4),word(0,2),text("muzzle"),Buffer.alloc(16),word(0,4)]);
  const savedWindow=Object.getOwnPropertyDescriptor(globalThis,"window");let assets=0,shells=0;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
    assert.equal(command,"load_particle_asset","Restoring must not launch or step a native helper");assets++;
    return pcf.buffer.slice(pcf.byteOffset,pcf.byteOffset+pcf.byteLength);
  }}}});
  try {
    const {effect,actor}=fixture();effect.freeze();const original=effect.snapshot();
    const restored=await WeaponEffects.restore(actor,original,async path=>{
      assert.equal(path,original.shellModel);shells++;
      return {model:{bones:[],bodyParts:[]} as any,materials:new Map()};
    },{} as any);
    assert.equal(restored.isFrozen,true);assert.equal(assets,1);assert.equal(shells,1);
    const result=restored.snapshot()!;
    assert.deepEqual(result.nodes,original.nodes);
    result.shells[0].matrix.forEach((n,i)=>assert.ok(Math.abs(n-original.shells[0].matrix[i])<1e-7));
    restored.step(5,new THREE.PerspectiveCamera());assert.deepEqual(restored.snapshot(),result);
    restored.dispose();
  } finally {if(savedWindow)Object.defineProperty(globalThis,"window",savedWindow);else Reflect.deleteProperty(globalThis,"window");}
});
