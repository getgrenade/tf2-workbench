import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { launchProjectile, stepProjectile, WeaponProjectiles } from "../../src/viewer/particles/projectiles";
import { parseWeaponSnapshot } from "../../src/viewer/particles/weaponSnapshot";
import type { ProjectileProfile } from "../../src/api";
import { readFileSync, existsSync } from "node:fs";
import { parsePayload } from "../../src/viewer/payload";
import { projectileRotation } from "../../src/viewer/particles/projectiles";

const rocket:ProjectileProfile={kind:"rocket",model:"models/weapons/w_models/w_rocket.mdl",trail:"rockettrail",speed:1100,gravity:0,lifetime:8,spin:false,team:0};
const grenade:ProjectileProfile={...rocket,kind:"grenade",speed:1200,gravity:800,lifetime:2,spin:true};
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test("rocket travels along aim without falling; grenade gets Source upward boost, arc and spin",()=>{
  const origin=new THREE.Vector3(10,20,1000), aim=new THREE.Vector3(1,0,0);
  const r=launchProjectile(rocket,origin,aim,()=>.5), g=launchProjectile(grenade,origin,aim,()=>.5);
  const initial=g.rotation.clone();
  for(let i=0;i<60;i++){stepProjectile(r,rocket,1/60,0);stepProjectile(g,grenade,1/60,0);}
  close(r.position.x,1110);close(r.position.z,1000);
  close(g.position.x,1210);close(g.position.z,800);close(g.velocity.z,-600);
  assert.ok(initial.angleTo(g.rotation)>0.1);assert.equal(g.active,true);
  for(let i=0;i<61;i++)stepProjectile(g,grenade,1/60,0);
  assert.equal(g.active,false,"Grenade expires at the SDK's two-second fuse");
});
test("floor bounces grenade; syringe falls with 0.3 gravity and authored spread",()=>{
  const g=launchProjectile(grenade,new THREE.Vector3(0,0,9),new THREE.Vector3(1,0,0),()=>.5);
  g.velocity.set(1200,0,-200);stepProjectile(g,grenade,1/60,0);
  close(g.position.z,8);close(g.velocity.x,540);assert.ok(g.velocity.z>0);
  const p={...rocket,kind:"syringe" as const,speed:1000,gravity:240,lifetime:3};
  const s=launchProjectile(p,new THREE.Vector3(0,0,1000),new THREE.Vector3(1,0,0),()=>.5);
  stepProjectile(s,p,.5,0);close(s.position.x,500);close(s.position.z,970);
  assert.ok(new THREE.Vector3(1,0,0).applyQuaternion(s.rotation).distanceTo(s.velocity.clone().normalize())<1e-7,"Falling syringe points along its velocity");
  const spread=launchProjectile(p,new THREE.Vector3(),new THREE.Vector3(1,0,0),()=>1);
  close(Math.atan2(spread.velocity.y,spread.velocity.x)*180/Math.PI,1.5);
  close(Math.asin(spread.velocity.z/p.speed)*180/Math.PI,1.5);
});
test("projectile entity angles point Source X along horizontal, sloped and vertical flight",()=>{
  for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(1,2,3),new THREE.Vector3(0,0,1)]) {
    assert.ok(new THREE.Vector3(1,0,0).applyQuaternion(projectileRotation(direction)).distanceTo(direction.normalize())<1e-7);
  }
});
for(const name of ["w_rocket","w_syringe_proj"]) test(`installed ${name} idle pose aligns model's long axis with Source forward`,{skip:!existsSync(`target/projectile-orientation/${name}.model`)},async()=>{
  const read=(extension:string)=>{const b=readFileSync(`target/projectile-orientation/${name}.${extension}`);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  const model=parsePayload(read("model"));
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"window");let bakes=0;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{
    assert.equal(command,"bake_sequence");assert.equal(args.sequence,0);bakes++;return read("clip");
  }}}});
  try {
    const restored=await WeaponProjectiles.restore([{model:`models/weapons/w_models/${name}.mdl`,team:0,matrix:new THREE.Matrix4().toArray(),age:0}],
      async()=>({model,materials:new Map()}),{material:()=>new THREE.MeshBasicMaterial()} as any);
    const size=new THREE.Box3().setFromObject(restored.group).getSize(new THREE.Vector3());
    assert.ok(size.x>size.y*2 && size.x>size.z*2,`${name}: posed extents ${size.toArray()}`);
    assert.equal(bakes,1);restored.dispose();
  } finally {if(descriptor)Object.defineProperty(globalThis,"window",descriptor);else Reflect.deleteProperty(globalThis,"window");}
});
test("projectile-only snapshots restore original models and retain team/transforms on resave",async()=>{
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3(200,30,80),new THREE.Quaternion().setFromEuler(new THREE.Euler(.1,.3,.6)),new THREE.Vector3(1,1,1)).toArray();
  const original={nodes:[],shells:[],shellModel:"",projectiles:[{model:rocket.model,team:1,matrix,age:.5}]};
  const parsed=parseWeaponSnapshot(original)!;assert.ok(parsed);parsed.projectiles![0].matrix[12]=250;close(matrix[12],200);
  const restored=await WeaponProjectiles.restore(original.projectiles,async path=>{
    assert.equal(path,rocket.model);return {model:{bones:[],bodyParts:[]} as any,materials:new Map()};
  },{} as any);
  const saved=restored.snapshot();assert.equal(saved[0].model,rocket.model);assert.equal(saved[0].team,1);
  saved[0].matrix.forEach((n,i)=>close(n,matrix[i]));close(saved[0].age,.5);restored.dispose();
  assert.equal(parseWeaponSnapshot({...original,projectiles:[{...original.projectiles[0],model:"../wrong.mdl"}]}),undefined);
});


test("scene walls and ceiling terminate rockets; sticky bombs settle on each boundary",()=>{
  const bounds=new THREE.Box3(new THREE.Vector3(-100,-100,0),new THREE.Vector3(100,100,100));
  for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1)]) {
    const r=launchProjectile(rocket,new THREE.Vector3(0,0,50),direction);stepProjectile(r,rocket,.2,0,bounds);
    assert.equal(r.active,false);assert.ok(r.impactNormal);
    const sticky={...grenade,kind:"sticky" as const,lifetime:3600};
    const s=launchProjectile(sticky,new THREE.Vector3(0,0,50),direction,()=>.5);stepProjectile(s,sticky,.2,0,bounds);
    assert.equal(s.active,true);assert.equal(s.settled,true);assert.equal(s.velocity.length(),0);
  }
});
test("charge changes arrow ballistics and cannon fuse without mutating the base profile",()=>{
  const p={...rocket,kind:"arrow",speed:1800,speedMax:2600,gravity:400,gravityMin:80,lifetime:10};
  const manager=new (WeaponProjectiles as any)(p,0);
  const slot:any={group:new THREE.Group(),matrix:new THREE.Matrix4(),motion:null,action:0,stopped:-1};manager.slots.push(slot);
  manager.shot(new THREE.Matrix4().setPosition(0,0,100),new THREE.Vector3(1,0,0),1,1);
  assert.equal(slot.profile.speed,2600);assert.equal(slot.profile.gravity,80);assert.equal(p.speed,1800);
  const cannon=new (WeaponProjectiles as any)({...p,kind:"cannon",lifetime:1},0);cannon.slots.push({...slot,motion:null});
  cannon.shot(new THREE.Matrix4().setPosition(0,0,100),new THREE.Vector3(1,0,0),.7,1);
  close(cannon.slots[0].profile.lifetime,.3);
});
test("armed stickies survive weapon switching and Scottish aim selection skips other bombs",()=>{
  const manager=new (WeaponProjectiles as any)({...grenade,kind:"sticky",armTime:.8,detonateMode:1,lifetime:3600},0);
  for(const [position,age] of [[new THREE.Vector3(300,0,20),1],[new THREE.Vector3(0,300,20),1],[new THREE.Vector3(400,0,20),.2]] as const) {
    const motion=launchProjectile({...grenade,kind:"sticky"},position,new THREE.Vector3(1,0,0));motion.age=age;
    manager.slots.push({group:new THREE.Group(),matrix:new THREE.Matrix4(),motion,action:0,stopped:0});
  }
  manager.detonate(new THREE.Vector3(),new THREE.Vector3(1,0,0));
  assert.equal(manager.slots[0].motion,null);assert.ok(manager.slots[1].motion);assert.ok(manager.slots[2].motion);
});
test("arrow trail and mixed shell models round trip without shared arrays",()=>{
  const value={nodes:[],shellModel:"models/weapons/shells/shell_shotgun.mdl",shells:[{model:"models/weapons/shells/shell_pistol.mdl",matrix:new THREE.Matrix4().toArray(),age:0}],projectiles:[{model:"models/weapons/w_models/w_arrow.mdl",matrix:new THREE.Matrix4().toArray(),team:0,age:1,trail:{material:"effects/arrowtrail_red.vmt",time:1,points:[[1,2,3,.9]]}}]};
  const parsed=parseWeaponSnapshot(value)!;assert.ok(parsed);assert.deepEqual(parsed,value);
  parsed.projectiles![0].trail!.points[0][0]=5;assert.equal(value.projectiles[0].trail.points[0][0],1);
});

test("a jar flies like a pipebomb but rolls, bursts on the first surface and splashes; the cleaver is thrown nearly straight and tumbles",()=>{
  const jar:ProjectileProfile={...grenade,kind:"jar",speed:1000,lifetime:2,damageRadius:200};
  const j=launchProjectile(jar,new THREE.Vector3(0,0,100),new THREE.Vector3(1,0,0),()=>.5);
  close(j.velocity.x,1000);close(j.velocity.z,200);close(j.angular.x,300*Math.PI/180);close(j.angular.y,0);
  const cleaver:ProjectileProfile={...jar,kind:"cleaver",speed:3000,lifetime:4};
  const c=launchProjectile(cleaver,new THREE.Vector3(0,0,100),new THREE.Vector3(1,0,0),()=>.5);
  close(c.velocity.length(),3000);close(c.velocity.z/c.velocity.x,.1);close(c.angular.y,500*Math.PI/180);
  // the cleaver sticks where it lands, the jar is spent
  const down=launchProjectile(cleaver,new THREE.Vector3(0,0,20),new THREE.Vector3(1,0,-1),()=>.5);
  for(let i=0;i<30&&!down.settled;i++)stepProjectile(down,cleaver,1/60,0);assert.equal(down.settled,true);
  const fall=launchProjectile(jar,new THREE.Vector3(0,0,20),new THREE.Vector3(1,0,-1),()=>.5);
  for(let i=0;i<60&&fall.active;i++)stepProjectile(fall,jar,1/60,0);assert.equal(fall.active,false);
});
test("a thrown jar leaves 0.1 s after the shot and calls the splash hook where it burst",()=>{
  const jar:ProjectileProfile={...grenade,kind:"jar",speed:1000,lifetime:2,damageRadius:200};
  const splashes:{p:THREE.Vector3;r:number}[]=[];
  const manager=new (WeaponProjectiles as any)(jar,0,undefined,{hit:()=>null,explosion:()=>{throw new Error("a jar does not explode");},splash:(p:THREE.Vector3,r:number)=>splashes.push({p,r})});
  for(let i=0;i<4;i++){const group=new THREE.Group();group.visible=false;manager.group.add(group);manager.slots.push({group,matrix:new THREE.Matrix4(),motion:null,action:0,stopped:-Infinity,model:"",team:0});}
  manager.shot(new THREE.Matrix4().makeTranslation(0,0,60),new THREE.Vector3(1,0,0),0,1,.1);
  assert.ok(manager.slots.every((s:any)=>!s.motion),"nothing in the air yet");
  for(let i=0;i<5;i++)manager.step(1/60);assert.ok(manager.slots.every((s:any)=>!s.motion),"0.083 s");
  manager.step(1/60);assert.ok(manager.slots.some((s:any)=>s.motion),"thrown at 0.1 s");
  for(let i=0;i<240&&!splashes.length;i++)manager.step(1/60);
  assert.equal(splashes.length,1);assert.equal(splashes[0].r,200);assert.ok(splashes[0].p.z<=10,"it burst on the floor");
});
