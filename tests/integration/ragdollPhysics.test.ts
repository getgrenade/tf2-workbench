import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import * as T from "three";
import {ArticulatedRagdoll} from "../../src/viewer/ragdollPhysics";
import {parsePayload,type ModelData} from "../../src/viewer/payload";
import {Rig} from "../../src/viewer/animator";
const read=(path:string)=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
for(const cls of ["scout","soldier","pyro","demoman","heavy","engineer","medic","sniper","spy"])test(`${cls} authored physics retains connected joints and finite poses`,{skip:!existsSync(`target/gib-fixtures/${cls}.player.model`)},()=>{
  const model=parsePayload(read(`target/gib-fixtures/${cls}.player.model`)),rig=new Rig(model.bones),physics=JSON.parse(readFileSync(`target/gib-fixtures/${cls}.physics.json`,"utf8"));
  const sim=new ArticulatedRagdoll(model,rig.bindWorld,physics,new T.Vector3(160,0,70),0);
  assert.ok(sim.joints.length>10);for(let i=0;i<360;i++)sim.step(1/120);
  const world=sim.worlds();assert.ok(world.every(m=>m.elements.every(Number.isFinite)));
  for(const j of sim.joints){const a=j.anchorA.clone().applyQuaternion(j.a.q).add(j.a.p),b=j.anchorB.clone().applyQuaternion(j.b.q).add(j.b.p);assert.ok(a.distanceTo(b)<2,`detached joint ${j.a.bone}->${j.b.bone}: ${a.distanceTo(b)}`);}
  for(const j of sim.joints){const e=new T.Euler().setFromQuaternion(j.rest.clone().invert().multiply(j.a.q.clone().invert().multiply(j.b.q)),"XYZ");for(const [axis,angle] of [e.x,e.y,e.z].entries())assert.ok(angle>=j.min[axis]-.1 && angle<=j.max[axis]+.1,`joint angle outside limits ${angle} [${j.min[axis]},${j.max[axis]}]`);}
  for(const b of sim.bodies)for(const c of b.corners)assert.ok(b.p.z+c.clone().applyQuaternion(b.q).z>=-.15,"visible body below floor");
  const pose=sim.pose(new T.Matrix4());assert.ok([...pose.pos,...pose.quat].every(Number.isFinite));
});
test("gib with geometry far from its origin rests on geometry, not its origin; fixed step is independent of render FPS",()=>{
  const model={bones:[{name:"root",parent:-1,poseToBone:[1,0,0,0,0,1,0,0,0,0,1,0]}],bodyParts:[{models:[{meshes:[{positions:new Float32Array([-2,-2,50,2,2,60]),skinIndices:new Uint16Array(8),skinWeights:new Float32Array([1,0,0,0,1,0,0,0])}]}]}]} as unknown as ModelData;
  const physics={solids:[{index:0,bone:"root",mass:1}],joints:[],collisionPairs:[]};
  const create=()=>new ArticulatedRagdoll(model,[new T.Matrix4()],physics,new T.Vector3(50,0,50),0,new T.Vector3(1,2,0));
  const a=create(),b=create();for(let i=0;i<720;i++)a.step(1/120);for(let i=0;i<180;i++)b.step(1/30);
  assert.ok(a.bodies[0].p.distanceTo(b.bodies[0].p)<1e-5);
  const bottom=Math.min(...a.bodies[0].support.map(c=>a.bodies[0].p.z+c.clone().applyQuaternion(a.bodies[0].q).z));assert.ok(bottom>=-.01&&bottom<.3,`bottom ${bottom}`);
  assert.ok(new T.Vector3(0,0,55).applyMatrix4(a.worlds()[0]).z<10,"gib geometry must fall to the floor");
});
import {PlayController,type PlayHost} from "../../src/viewer/play";
import {Viewer} from "../../src/viewer/viewer";
import {SOURCE_TO_VIEWER} from "../../src/viewer/animator";
test("melee traces from the shoot position, then uses the Source hull; setting disables reaction",()=>{
  let hits=0;const calls:number[]=[];const actor:any={particleRootFrame:()=>SOURCE_TO_VIEWER.clone(),eyeFrame:()=>new T.Matrix4().makeTranslation(0,0,68)};
  const viewer=Object.create(Viewer.prototype);const target={};viewer.hitReactionsEnabled=true;viewer.reactionSystem=()=>({trace:(_:unknown,start:T.Vector3,end:T.Vector3,hull=0)=>{assert.equal(start.z,68);assert.equal(end.x,48);calls.push(hull);return hull?{actor:target}:null;},ragdoll:()=>hits++});
  viewer.meleeWeapon(actor,new T.Vector3(1,0,0),{melee:{range:48,hull:18,delay:.2}} as any);assert.deepEqual(calls,[0,18]);assert.equal(hits,1);
  viewer.hitReactionsEnabled=false;viewer.meleeWeapon(actor,new T.Vector3(1,0,0),{melee:{range:48,hull:18,delay:.2}} as any);assert.equal(hits,1);
});
for(const [cls,count] of [["scout",10],["soldier",10],["pyro",9],["demoman",7],["heavy",16],["engineer",8],["medic",9],["sniper",8],["spy",8]] as const)test(`${cls} all gib pieces fall with usable physics bodies`,{skip:!existsSync(`target/gib-fixtures/${cls}.gib0.model`)},()=>{
  for(let piece=0;piece<count;piece++){
    const model=parsePayload(read(`target/gib-fixtures/${cls}.gib${piece}.model`)),physics=JSON.parse(readFileSync(`target/gib-fixtures/${cls}.gib${piece}.physics.json`,"utf8")),rig=new Rig(model.bones);
    const sim=new ArticulatedRagdoll(model,rig.bindWorld.map(m=>new T.Matrix4().makeTranslation(0,0,100).multiply(m)),physics,new T.Vector3(200,0,200),0,new T.Vector3(1,1,0));assert.ok(sim.bodies.length>0);
    const height=sim.bodies[0].p.z;for(let i=0;i<600;i++)sim.step(1/120);
    assert.ok(sim.worlds().every(m=>m.elements.every(Number.isFinite)));assert.ok(sim.bodies[0].p.z<height,`${cls} gib ${piece} stuck`);
    for(const b of sim.bodies)for(const c of b.support)assert.ok(b.p.z+c.clone().applyQuaternion(b.q).z>=-.15,"gib below floor");
  }
});
function debrisModel(round=false){
  const positions:number[]=[];
  if(round){for(let latitude=0;latitude<=12;latitude++)for(let longitude=0;longitude<24;longitude++){const phi=Math.PI*latitude/12,theta=Math.PI*longitude/12;positions.push(5*Math.sin(phi)*Math.cos(theta),5*Math.sin(phi)*Math.sin(theta),5*Math.cos(phi));}}
  else for(const x of [-3,3])for(const y of [-4,4])for(const z of [-5,5])positions.push(x,y,z);
  const weights=new Float32Array(positions.length/3*4);for(let i=0;i<weights.length;i+=4)weights[i]=1;
  return {bones:[{name:"root",parent:-1,poseToBone:[1,0,0,0,0,1,0,0,0,0,1,0]}],bodyParts:[{models:[{meshes:[{positions:new Float32Array(positions),skinIndices:new Uint16Array(weights.length),skinWeights:weights}]}]}]} as unknown as ModelData;
}
const debrisPhysics={solids:[{index:0,bone:"root",mass:5}],joints:[],collisionPairs:[]};
test("debris retains its launch spin in flight instead of losing it every tick",()=>{
  const sim=new ArticulatedRagdoll(debrisModel(),[new T.Matrix4().makeTranslation(0,0,500)],debrisPhysics,new T.Vector3(),0,new T.Vector3(1,2,0));
  for(let i=0;i<60;i++)sim.step(1/120);
  assert.ok(sim.bodies[0].w.length()>2,"launch angular momentum survives half a second in air");
});
test("floor impact and friction produce spin without initial angular velocity, then continue rolling",()=>{
  const sim=new ArticulatedRagdoll(debrisModel(true),[new T.Matrix4().makeTranslation(0,0,20)],debrisPhysics,new T.Vector3(100,0,-150),0);
  let contacted=false,travel=0,rotation=0;
  for(let i=0;i<180;i++){
    const b=sim.bodies[0],q=b.q.clone(),x=b.p.x;sim.step(1/120);
    if(b.p.z<6)contacted=true;
    if(contacted){travel+=Math.abs(b.p.x-x);rotation+=q.angleTo(b.q);}
  }
  assert.ok(contacted);assert.ok(travel>20,`ground travel ${travel}`);assert.ok(rotation>1,`ground rotation ${rotation}`);
  assert.ok(sim.bodies[0].w.length()>.2,"ground contact must not erase spin");
});
test("flat debris settles and sleeps rather than jittering indefinitely",()=>{
  const sim=new ArticulatedRagdoll(debrisModel(),[new T.Matrix4().makeTranslation(0,0,5)],debrisPhysics,new T.Vector3(),0);
  for(let i=0;i<240;i++)sim.step(1/120);assert.equal(sim.sleeping,true);assert.ok(Math.abs(sim.bodies[0].p.z-5)<.01);
});
test("a long frame runs a bounded number of fixed steps instead of spiralling",()=>{
  const sim=new ArticulatedRagdoll(debrisModel(),[new T.Matrix4().makeTranslation(0,0,200)],debrisPhysics,new T.Vector3(),0);
  const before=sim.bodies[0].p.z;sim.step(1);
  // four 1/120 s steps of free fall (800 * (1+2+3+4) / 120^2), not the 120 that one second would be
  assert.ok(Math.abs(before-sim.bodies[0].p.z-800*10/14400)<2e-3,`fell ${before-sim.bodies[0].p.z}`);
});
test("the size of a model's solids is measured once and shared by every ragdoll of it",()=>{
  let reads=0;const base=debrisModel() as any;const mesh=base.bodyParts[0].models[0].meshes[0];
  const weights=mesh.skinWeights;mesh.skinWeights=new Proxy(weights,{get(target,key,receiver){if(typeof key==="string" && /^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
  const make=(x:number)=>new ArticulatedRagdoll(base,[new T.Matrix4().makeTranslation(x,0,50)],debrisPhysics,new T.Vector3(),0);
  const first=make(0),afterFirst=reads,second=make(100);
  assert.ok(afterFirst>0);assert.equal(reads,afterFirst,"the second ragdoll reads no vertices");
  assert.deepEqual(second.bodies[0].half.toArray(),first.bodies[0].half.toArray());
  second.bodies[0].support[0].set(9,9,9);assert.notDeepEqual(make(200).bodies[0].support[0].toArray(),[9,9,9],"a ragdoll cannot change what the next one measures");
});
test("fewer solver iterations still keep joints connected",()=>{
  const files=["target/gib-fixtures/soldier.player.model","target/gib-fixtures/soldier.physics.json"];if(!files.every(existsSync))return;
  const model=parsePayload(read(files[0])),rig=new Rig(model.bones),physics=JSON.parse(readFileSync(files[1],"utf8"));
  const sim=new ArticulatedRagdoll(model,rig.bindWorld,physics,new T.Vector3(160,0,70),0);for(let i=0;i<360;i++)sim.step(1/120,10);
  assert.ok(sim.worlds().every(m=>m.elements.every(Number.isFinite)));
  for(const j of sim.joints){const a=j.anchorA.clone().applyQuaternion(j.a.q).add(j.a.p),b=j.anchorB.clone().applyQuaternion(j.b.q).add(j.b.p);assert.ok(a.distanceTo(b)<3,`detached joint at 10 passes: ${a.distanceTo(b)}`);}
});
test("debris reports where it lands on the floor, once per landing and no more often than every tenth of a second", () => {
  const sim=new ArticulatedRagdoll(debrisModel(true),[new T.Matrix4().makeTranslation(30,-10,120)],debrisPhysics,new T.Vector3(40,0,80),0,new T.Vector3(1,1,0));
  const hits:{point:T.Vector3;time:number}[]=[];let time=0;
  sim.onImpact=point=>hits.push({point,time});
  for(let i=0;i<600;i++){time+=1/120;sim.step(1/120);}
  assert.ok(hits.length>=1,"it lands at least once");
  assert.ok(Math.abs(hits[0].point.z)<.3,`the first point is on the floor (z ${hits[0].point.z})`);
  assert.ok(hits[0].point.x>30,"it landed downrange of where it was thrown");
  for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=.1-1e-9,"throttled");
  const quiet=new ArticulatedRagdoll(debrisModel(true),[new T.Matrix4().makeTranslation(0,0,120)],debrisPhysics,new T.Vector3(),0);
  for(let i=0;i<600;i++)quiet.step(1/120);
  assert.equal(quiet.onImpact,null,"no listener, no problem");
});
test("a ragdoll with joints reports its first touch of the floor too",()=>{
  const files=["target/gib-fixtures/soldier.player.model","target/gib-fixtures/soldier.physics.json"];if(!files.every(existsSync))return;
  const model=parsePayload(read(files[0])),rig=new Rig(model.bones),physics=JSON.parse(readFileSync(files[1],"utf8"));
  const sim=new ArticulatedRagdoll(model,rig.bindWorld.map(m=>new T.Matrix4().makeTranslation(0,0,60).multiply(m)),physics,new T.Vector3(160,0,70),0);
  const hits:T.Vector3[]=[];sim.onImpact=point=>hits.push(point);
  for(let i=0;i<360;i++)sim.step(1/120);
  assert.ok(hits.length>=1);assert.ok(hits.every(p=>Math.abs(p.z)<4),"the points are at the floor");
});
