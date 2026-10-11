import {readFileSync,existsSync} from "node:fs";
import {parseParticleModel} from "../../src/viewer/particles/assets";
import {parsePayload} from "../../src/viewer/payload";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {HitReactions,SkeletonRagdoll,segmentHit,gibVelocity} from "../../src/viewer/hitReactions";
import {SOURCE_TO_VIEWER} from "../../src/viewer/animator";
import {WeaponProjectiles,launchProjectile} from "../../src/viewer/particles/projectiles";
test("swept projectile and hitscan traces choose the first character without tunneling",()=>{
  const start=new THREE.Vector3(),end=new THREE.Vector3(1000,0,0),box=(x:number)=>new THREE.Box3(new THREE.Vector3(x,-10,-10),new THREE.Vector3(x+20,10,10));
  const hit=segmentHit(start,end,[box(800),box(200)])!;assert.equal(hit.index,1);assert.equal(hit.point.x,200);
  assert.equal(segmentHit(start,new THREE.Vector3(100,0,0),[box(200)]),null);
  assert.equal(segmentHit(new THREE.Vector3(210,0,0),end,[box(200)])!.point.x,210);
});
test("gib launch impulse matches Source's 400-unit cap and upward bias",()=>{
  for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,1),new THREE.Vector3()]){
    const velocity=gibVelocity(direction,()=>.5);assert.ok(Math.abs(velocity.length()-400)<1e-6);assert.ok(velocity.z>0);
  }
});
test("ragdoll preserves bone lengths, floor constraints and produces finite local poses at different FPS",()=>{
  const matrices=[new THREE.Matrix4().makeTranslation(0,0,70),new THREE.Matrix4().makeTranslation(0,0,50),new THREE.Matrix4().makeTranslation(20,0,30)];
  const create=()=>new SkeletonRagdoll(matrices,[-1,0,1],new THREE.Vector3(60,0,50),0);
  const a=create(),b=create();for(let i=0;i<240;i++)a.step(1/120);for(let i=0;i<60;i++)b.step(1/30);
  a.points.forEach((p,i)=>{assert.ok(p.z>=2);assert.ok(p.distanceTo(b.points[i])<1e-5);});
  assert.ok(Math.abs(a.points[0].distanceTo(a.points[1])-20)<.5);
  const pose=a.pose(new THREE.Matrix4());assert.equal(pose.pos.length,9);assert.equal(pose.quat.length,12);assert.ok([...pose.pos,...pose.quat].every(Number.isFinite));
});
function fixture(){
  const clip={frames:1,fps:1,numBones:2,pos:new Float32Array(6),quat:new Float32Array(8)},scene=new THREE.Scene();let hidden=false,posed=0;
  const actor:any={snapshotCustomPose:()=>null,particleTeam:0,particleModel:{path:"models/player/test.mdl",bones:[{name:"pelvis",parent:-1},{name:"head",parent:0}]},playback:{clip,time:2,playing:true},particleRootFrame:()=>SOURCE_TO_VIEWER.clone(),particleBoneFrame:(i:number)=>new THREE.Matrix4().makeTranslation(0,0,60+i*20),setLive:()=>posed++,endLive:()=>{},setClip:(c:any)=>actor.playback.clip=c,poseBones:()=>{},setReactionHidden:(v:boolean)=>hidden=v,computeBounds:(b:THREE.Box3)=>b.set(new THREE.Vector3(-10,0,-10),new THREE.Vector3(10,100,10))};
  const manager=new HitReactions(scene,()=>[actor],{} as any,()=>{const group=new THREE.Group();return {group,emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>group.removeFromParent()} as any;});return {manager,actor,clip,scene,hidden:()=>hidden,posed:()=>posed};
}
test("settings disable reactions and restore victim clip/time/play state; freeze stops motion",()=>{
  const f=fixture();f.manager.enabled=false;f.manager.ragdoll(f.actor,new THREE.Vector3(1,0,0),0);assert.equal(f.manager.has(f.actor),false);
  f.manager.enabled=true;f.manager.ragdoll(f.actor,new THREE.Vector3(1,0,0),0);assert.equal(f.manager.has(f.actor),true);assert.equal(f.actor.playback.playing,false);
  f.manager.step(1/60);assert.equal(f.posed(),1);f.manager.frozen=true;f.manager.step(1/60);assert.equal(f.posed(),1);
  f.manager.setEnabled(false);assert.equal(f.manager.has(f.actor),false);assert.equal(f.actor.playback.clip,f.clip);assert.equal(f.actor.playback.time,2);assert.equal(f.actor.playback.playing,true);
});
test("rocket direct hit, grenade fuse and sticky detonation trigger explosion callbacks once",()=>{
  const profile:any={kind:"rocket",speed:1100,gravity:0,lifetime:8,spin:false,team:0,damageRadius:146};let explosions=0;
  const manager=new (WeaponProjectiles as any)(profile,0,undefined,{hit:(a:THREE.Vector3,b:THREE.Vector3)=>b.x>=5?new THREE.Vector3(5,0,100):null,explosion:()=>explosions++});
  const slot={group:new THREE.Group(),matrix:new THREE.Matrix4(),motion:launchProjectile(profile,new THREE.Vector3(0,0,100),new THREE.Vector3(1,0,0)),action:0,stopped:0};manager.slots.push(slot);
  manager.step(1/60);assert.equal(explosions,1);assert.equal(slot.motion,null);manager.step(1/60);assert.equal(explosions,1);
  for(const kind of ["grenade","sticky"]){const p={...profile,kind,lifetime:kind==="grenade"?.01:3600,armTime:.8};const m=new (WeaponProjectiles as any)(p,0,undefined,{hit:()=>null,explosion:()=>explosions++});const motion=launchProjectile(p,new THREE.Vector3(0,0,100),new THREE.Vector3(1,0,0));motion.age=1;m.slots.push({...slot,motion});if(kind==="sticky")m.detonate(new THREE.Vector3(),new THREE.Vector3(1,0,0));else m.step(1/60);}
  assert.equal(explosions,3);
});

test("original custom pose remains available for scene saving during a ragdoll preview",()=>{
  const f=fixture();const original={pos:new Float32Array(6),quat:new Float32Array(8)};f.actor.snapshotCustomPose=()=>original;
  f.manager.ragdoll(f.actor,new THREE.Vector3(1,0,0),0);f.manager.step(1/60);
  assert.equal(f.manager.original(f.actor)!.pose,original);assert.equal(f.manager.original(f.actor)!.time,2);assert.equal(f.manager.original(f.actor)!.playing,true);
});
test("on-demand gib models use VPK definitions and reset removes every spawned wrapper",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"window");const f=fixture();let calls=0;
  // Minimal valid MDL attachment metadata; the mesh loader is mocked independently.
  const mdl=new ArrayBuffer(400);new DataView(mdl).setInt32(0,0x54534449,true);new DataView(mdl).setInt32(4,44,true);new DataView(mdl).setInt32(172,0,true);
  Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
    if(command==="player_gibs"){calls++;return [{model:"models/player/gibs/test.mdl",bone:"head",attachment:"",offset:[0,0,0],velocity:[0,0,0],burst:1,fadeTime:15}];}
    if(command==="model_physics")return {solids:[],joints:[],collisionPairs:[]};
    if(command==="load_particle_asset")return mdl;
    throw Error(command);
  }}}});
  try {
    await (f.manager as any).gib(f.actor,new THREE.Vector3(1,0,0),0,async()=>({model:{bones:[],bodyParts:[]},materials:new Map()}));
    assert.equal(calls,1);assert.equal(f.hidden(),true);assert.equal(f.scene.children.length,2,"Gib wrapper and blood group");
    const group=f.scene.children.find(g=>g.children.length)!.children[0];assert.equal(group.position.z,80,"Authored placementbone follows the posed character");
    f.manager.reset();assert.equal(f.scene.children.length,0);assert.equal(f.hidden(),false);assert.equal(f.actor.playback.playing,true);
  }finally{if(descriptor)Object.defineProperty(globalThis,"window",descriptor);else Reflect.deleteProperty(globalThis,"window");}
});

test("characters bursting into the same gibs share one load, one geometry set and one physics query",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"window");const calls:Record<string,number>={};
  const mdl=new ArrayBuffer(400);new DataView(mdl).setInt32(0,0x54534449,true);new DataView(mdl).setInt32(4,44,true);new DataView(mdl).setInt32(172,0,true);
  Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
    calls[command]=(calls[command]??0)+1;
    if(command==="player_gibs")return [{model:"models/player/gibs/a.mdl",bone:"head",attachment:"",offset:[0,0,0],velocity:[0,0,0],burst:1,fadeTime:15},{model:"models/player/gibs/b.mdl",bone:"head",attachment:"",offset:[0,0,0],velocity:[0,0,0],burst:1,fadeTime:15}];
    if(command==="model_physics")return {solids:[],joints:[],collisionPairs:[]};
    if(command==="load_particle_asset")return mdl;
    throw Error(command);
  }}}});
  try {
    const mesh={materials:[],material:"m",positions:new Float32Array(9),normals:new Float32Array(9),uvs:new Float32Array(6),tangents:new Float32Array(12),skinIndices:new Uint16Array(12),skinWeights:new Float32Array(12),indices:new Uint32Array([0,1,2]),flexes:[]};
    let loads=0;const load=async()=>{loads++;return {model:{bones:[{name:"root",parent:-1,poseToBone:[1,0,0,0,0,1,0,0,0,0,1,0]}],bodyParts:[{name:"x",models:[{meshes:[mesh]}]}]},materials:new Map()} as any;};
    const mk=()=>{const f=fixture();return f.actor;};
    const a=mk(),b=mk(),scene=new THREE.Scene(),manager=new HitReactions(scene,()=>[a,b],{material:()=>({})} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any);
    await Promise.all([(manager as any).gib(a,new THREE.Vector3(1,0,0),0,load),(manager as any).gib(b,new THREE.Vector3(0,1,0),0,load)]);
    assert.equal(loads,2,"two gib models loaded once each for both victims");
    assert.equal(calls.player_gibs,1);assert.equal(calls.model_physics,2,"one physics query per gib model");
    const geometries=new Set<unknown>();scene.traverse(o=>{if((o as THREE.Mesh).isMesh)geometries.add((o as THREE.Mesh).geometry);});
    assert.equal(geometries.size,2,"both victims draw the same two geometries");
    manager.dispose();
  }finally{if(descriptor)Object.defineProperty(globalThis,"window",descriptor);else Reflect.deleteProperty(globalThis,"window");}
});
test("energy rings do not trigger explosive gib damage",()=>{
  let explosions=0;const p:any={kind:"energy",speed:1200,gravity:0,lifetime:.01,spin:false,team:0};const manager=new (WeaponProjectiles as any)(p,0,undefined,{hit:()=>null,explosion:()=>explosions++});manager.slots.push({group:new THREE.Group(),matrix:new THREE.Matrix4(),motion:launchProjectile(p,new THREE.Vector3(0,0,100),new THREE.Vector3(1,0,0)),action:0,stopped:0});manager.step(1/60);assert.equal(explosions,0);
});

for(const cls of ["scout","soldier","pyro","demoman","heavy","engineer","medic","sniper","spy"])test(`installed ${cls} gib metadata and geometry load with original MDL version`,{skip:!existsSync(`target/gib-fixtures/${cls}.mdl`)},()=>{
  const read=(extension:string)=>{const b=readFileSync(`target/gib-fixtures/${cls}.${extension}`);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  const metadata=parseParticleModel(read("mdl")),model=parsePayload(read("model"));assert.ok(model.bones.length);assert.ok(model.bodyParts.length);
  for(const attachment of metadata.attachments){assert.ok(attachment.bone>=0 && attachment.bone<model.bones.length);assert.ok(attachment.local.elements.every(Number.isFinite));}
});
test("Source posed hitboxes ignore empty space inside a character's bounding box",()=>{
  const f=fixture();(f.manager as any).collisionModels.set(f.actor.particleModel.path,{hitboxes:[{bone:0,min:new THREE.Vector3(-10,10,-10),max:new THREE.Vector3(10,20,10)}]});
  const owner={} as any,start=new THREE.Vector3(-100,0,60),end=new THREE.Vector3(100,0,60);
  assert.equal(f.manager.trace(owner,start,end),null);
  const hit=f.manager.trace(owner,new THREE.Vector3(-100,15,60),new THREE.Vector3(100,15,60));assert.equal(hit!.point.x,-10);assert.equal(hit!.actor,f.actor);
});
test("an explosion reaches a character when the Source player hull is within its radius, without skinning the mesh",()=>{
  const make=(x:number)=>{const f=fixture();f.actor.particleRootFrame=()=>SOURCE_TO_VIEWER.clone().multiply(new THREE.Matrix4().makeTranslation(x,0,0));f.actor.computeBounds=()=>{throw Error("the blast must not skin the mesh");};return f.actor;};
  const near=make(100),far=make(250),owner=make(0);
  const scene=new THREE.Scene(),manager=new HitReactions(scene,()=>[owner,near,far],{} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any);
  const burst:THREE.Object3D[]=[];(manager as any).gib=(actor:unknown)=>{burst.push(actor as THREE.Object3D);return Promise.resolve();};
  manager.explosion(owner,new THREE.Vector3(0,0,40),146,0,async()=>({model:{bones:[],bodyParts:[]},materials:new Map()} as any));
  assert.deepEqual(burst,[near],"hull edge at 76 is inside 146; at 226 it is outside; the shooter is never hit");
  const hull=manager.blastHull(near);assert.deepEqual([hull.min.x,hull.max.x,hull.min.z,hull.max.z],[76,124,0,82]);
});
test("the allocation-free trace finds exactly what the straightforward one does",()=>{
  let seed=11;const random=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
  const bones=Array.from({length:6},(_,i)=>new THREE.Matrix4().compose(new THREE.Vector3(random()*60-30,random()*60-30,i*14),new THREE.Quaternion().setFromEuler(new THREE.Euler(random(),random(),random())),new THREE.Vector3(1,1,1)));
  const hitboxes=bones.map((_,bone)=>({bone,min:new THREE.Vector3(-4-random()*4,-4-random()*4,-3),max:new THREE.Vector3(4+random()*4,4+random()*4,10+random()*6)}));
  const make=(x:number)=>({particleModel:{path:`models/player/${x}.mdl`},particleRootFrame:(out=new THREE.Matrix4())=>out.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(x,0,0)),particleBoneFrame:(i:number)=>bones[i]??null}) as any;
  const owner=make(-500),a=make(0),b=make(70),c=make(140);
  const manager=new HitReactions(new THREE.Scene(),()=>[owner,a,b,c],{} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any);
  for(const x of [-500,0,70,140])(manager as any).collisionModels.set(`models/player/${x}.mdl`,{attachments:[],hitboxes});
  const TO=SOURCE_TO_VIEWER.clone().invert();
  const reference=(start:THREE.Vector3,end:THREE.Vector3,hull:number)=>{
    let nearest=start.distanceTo(end)+1e-6,result:{point:THREE.Vector3;actor:unknown}|null=null;
    for(const actor of [a,b,c]){const root=TO.clone().multiply(actor.particleRootFrame()),points:THREE.Vector3[]=[];
      for(const box of hitboxes){const matrix=root.clone().multiply(actor.particleBoneFrame(box.bone)),inverse=matrix.clone().invert(),bounds=new THREE.Box3(box.min.clone(),box.max.clone());
        if(hull){const m=inverse.elements,extent=new THREE.Vector3(Math.abs(m[0])+Math.abs(m[4])+Math.abs(m[8]),Math.abs(m[1])+Math.abs(m[5])+Math.abs(m[9]),Math.abs(m[2])+Math.abs(m[6])+Math.abs(m[10])).multiplyScalar(hull);bounds.min.sub(extent);bounds.max.add(extent);}
        const hit=segmentHit(start.clone().applyMatrix4(inverse),end.clone().applyMatrix4(inverse),[bounds]);if(hit)points.push(hit.point.applyMatrix4(matrix));}
      for(const point of points){const distance=point.distanceTo(start);if(distance<nearest){nearest=distance;result={point,actor};}}}
    return result;
  };
  let hits=0,misses=0;
  for(let i=0;i<1500;i++){
    const start=new THREE.Vector3(random()*300-80,random()*80-40,random()*70),end=start.clone().add(new THREE.Vector3(random()*300-100,random()*80-40,random()*60-30)),hull=i%2?18:0;
    const want=reference(start,end,hull),got=manager.trace(owner,start.clone(),end.clone(),hull);
    if(!want){assert.equal(got,null);misses++;continue;}
    assert.ok(got,`segment ${i} must hit`);assert.equal(got!.actor,want.actor);assert.ok(got!.point.distanceTo(want.point)<1e-9);hits++;
  }
  assert.ok(hits>100&&misses>100,`both outcomes are exercised (${hits} hits, ${misses} misses)`);
});
test("reactions report motion while a ragdoll is awake so shadows are redrawn",()=>{
  const f=fixture();assert.equal(f.manager.animating,false);
  f.manager.ragdoll(f.actor,new THREE.Vector3(1,0,0),0);assert.equal(f.manager.animating,true);
  for(let i=0;i<4000 && f.manager.animating;i++)f.manager.step(1/30);assert.equal(f.manager.animating,false,"a settled ragdoll sleeps");
});
test("gibs whose model asks for blood splat the floor where they land, and others do not",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"window");
  const mdlWith=(marker:boolean)=>{const mdl=new ArrayBuffer(400);new DataView(mdl).setInt32(0,0x54534449,true);new DataView(mdl).setInt32(4,44,true);new DataView(mdl).setInt32(172,0,true);if(marker)new Uint8Array(mdl).set(new TextEncoder().encode("bloodsplat"),300);return mdl;};
  const run=async(marker:boolean)=>{
    Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
      if(command==="player_gibs")return [{model:marker?"models/player/gibs/splat.mdl":"models/player/gibs/plain.mdl",bone:"head",attachment:"",offset:[0,0,0],velocity:[0,0,0],burst:1,fadeTime:15}];
      if(command==="model_physics")return {solids:[{index:0,bone:"root",mass:5}],joints:[],collisionPairs:[]};
      if(command==="load_particle_asset")return mdlWith(marker);
      throw Error(command);
    }}}});
    const f=fixture(),adds:{point:THREE.Vector3;normal:THREE.Vector3}[]=[];
    const mesh={materials:[],material:"m",positions:new Float32Array([-3,-3,-3,3,3,3,3,-3,3]),normals:new Float32Array(9),uvs:new Float32Array(6),tangents:new Float32Array(12),skinIndices:new Uint16Array(12),skinWeights:new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),indices:new Uint32Array([0,1,2]),flexes:[]};
    const decals={group:new THREE.Group(),add:(point:THREE.Vector3,normal:THREE.Vector3)=>{adds.push({point:point.clone(),normal:normal.clone()});},dispose:()=>{}};
    const manager=new HitReactions(f.scene,()=>[f.actor],{material:()=>({})} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any,()=>decals);
    await (manager as any).gib(f.actor,new THREE.Vector3(1,0,0),0,async()=>({model:{bones:[{name:"root",parent:-1,poseToBone:[1,0,0,0,0,1,0,0,0,0,1,0]}],bodyParts:[{name:"x",models:[{meshes:[mesh]}]}]},materials:new Map()} as any));
    for(let i=0;i<360;i++)manager.step(1/60);
    manager.dispose();
    return adds;
  };
  try {
    const marked=await run(true);
    assert.ok(marked.length>=1,"a gib that asks for blood leaves some");
    assert.ok(marked.every(a=>Math.abs(a.point.z)<.5 && a.normal.equals(new THREE.Vector3(0,0,1))),"on the floor, facing up");
    assert.equal((await run(false)).length,0,"a gib without the marker leaves none");
  } finally {if(descriptor)Object.defineProperty(globalThis,"window",descriptor);else Reflect.deleteProperty(globalThis,"window");}
});
test("a flame goes through the first character and reaches the one behind it, in order, once each", () => {
  const bones=[new THREE.Matrix4()];
  const make=(x:number)=>({particleModel:{path:`models/player/flame${x}.mdl`},particleRootFrame:(out=new THREE.Matrix4())=>out.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(x,0,0)),particleBoneFrame:()=>bones[0]}) as any;
  const owner=make(-60),front=make(100),back=make(220),off=make(160);
  off.particleRootFrame=(out=new THREE.Matrix4())=>out.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(160,900,0));
  const manager=new HitReactions(new THREE.Scene(),()=>[owner,back,front,off],{} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any);
  for(const a of [owner,front,back,off])(manager as any).collisionModels.set(a.particleModel.path,{attachments:[],hitboxes:[{bone:0,min:new THREE.Vector3(-12,-12,0),max:new THREE.Vector3(12,12,72)}]});
  const start=new THREE.Vector3(0,0,50),end=new THREE.Vector3(350,0,50),out:any[]=[];
  assert.equal((manager.trace(owner,start,end,12) as any).actor,front,"a bullet stops at the first");
  assert.deepEqual(manager.traceAll(owner,start,end,12,out),[front,back],"the stream goes on to the second, nearest first; the shooter and what is off to the side are not in it");
  assert.equal(manager.traceAll(owner,start,start.clone().setX(60),12,out).length,0,"short of both");
  assert.deepEqual(manager.traceAll(owner,start,new THREE.Vector3(150,0,50),12,out),[front],"range ends the stream");
  assert.equal(out.length,1,"the array it is given is the one it fills");
});
test("a crowd's gib pieces are capped: the oldest characters' pieces go, the characters stay gone", () => {
  const manager=new HitReactions(new THREE.Scene(),()=>[],{} as any,()=>({group:new THREE.Group(),emit:()=>{},step:()=>{},freeze:()=>{},dispose:()=>{}}) as any);
  const entries=(manager as any).entries as Map<unknown,any>;
  const make=(n:number)=>({pieces:Array.from({length:n},()=>{const group=new THREE.Group(),wrapper=new THREE.Group();wrapper.add(group);group.userData.wrapper=wrapper;return {group,simulation:null,skeleton:null};}),hidden:true});
  const victims=Array.from({length:40},()=>({})),made=victims.map(()=>make(12));
  victims.forEach((v,i)=>entries.set(v,made[i]));
  (manager as any).trimGibs();
  const left=made.reduce((n,e)=>n+e.pieces.length,0);
  assert.ok(left<=HitReactions.MAX_GIB_PIECES&&left>HitReactions.MAX_GIB_PIECES-12,`kept ${left}`);
  assert.equal(made[0].pieces.length,0,"the first to burst is the first to go");
  assert.equal(made[39].pieces.length,12,"the newest keeps its pieces");
  assert.equal(entries.size,40,"the characters are still gibbed (their entries stay, so they do not come back whole)");
  (manager as any).trimGibs();
  assert.equal(made.reduce((n,e)=>n+e.pieces.length,0),left,"nothing more goes while under the cap");
});
