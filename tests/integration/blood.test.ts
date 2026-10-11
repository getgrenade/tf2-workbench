import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {bloodPlan} from "../../src/viewer/particles/blood";
import {HitReactions} from "../../src/viewer/hitReactions";
import {SOURCE_TO_VIEWER} from "../../src/viewer/animator";
function camera(distance:number){const camera=new T.PerspectiveCamera();camera.position.copy(new T.Vector3(-distance,0,0).applyMatrix4(SOURCE_TO_VIEWER));camera.lookAt(new T.Vector3());camera.updateMatrixWorld(true);return camera;}
test("blood impact points against damage direction; spray uses Source camera distance and lateral bias",()=>{
  const origin=new T.Vector3(0,0,50),normal=new T.Vector3(1,0,0),plan=bloodPlan(origin,normal,undefined);
  assert.deepEqual(plan.map(p=>p.system),["blood_impact_red_01","blood_spray_red_01"]);
  assert.ok(new T.Vector3().setFromMatrixColumn(plan[0].matrix,0).equals(new T.Vector3(-1,0,0)));
  assert.deepEqual(new T.Vector3().setFromMatrixPosition(plan[1].matrix).toArray(),origin.toArray());
  const near=bloodPlan(new T.Vector3(),normal,camera(399),()=>.75),far=bloodPlan(new T.Vector3(),normal,camera(400),()=>.75);
  assert.equal(near[1].system,"blood_spray_red_01");assert.equal(far[1].system,"blood_spray_red_01_far");
  assert.ok(Math.abs(new T.Vector3().setFromMatrixColumn(near[1].matrix,0).y)>.5,"spray turns away from view");
  for(const p of far){assert.ok(Math.abs(p.matrix.determinant()-1)<1e-8);assert.ok(p.matrix.elements.every(Number.isFinite));}
});
function fixture(factory:any){const actor:any={snapshotCustomPose:()=>null,particleModel:{path:"models/player/test.mdl",bones:[{name:"pelvis",parent:-1}]},playback:{clip:null,time:0,playing:true},particleRootFrame:()=>SOURCE_TO_VIEWER.clone(),particleBoneFrame:()=>new T.Matrix4().makeTranslation(0,0,50),setLive:()=>{},endLive:()=>{},setClip:()=>{},poseBones:()=>{},setReactionHidden:()=>{}};const scene=new T.Scene(),manager=new HitReactions(scene,()=>[actor],{} as any,factory);return {actor,scene,manager};}
function sink(){const log={emits:[] as {origin:T.Vector3;normal:T.Vector3}[],steps:[] as boolean[],frozen:0,disposed:0,created:0};
  const make=()=>{log.created++;const group=new T.Group();return {group,emit:(origin:T.Vector3,normal:T.Vector3)=>{log.emits.push({origin:origin.clone(),normal:normal.clone()});},step:(_dt:number,_c:unknown,frozen=false)=>{log.steps.push(frozen);},freeze:()=>{log.frozen++;},dispose:()=>{log.disposed++;group.removeFromParent();}};};
  return {log,make};}
test("hit blood goes to one shared sink at the actual trace position, respects the setting, and outlives its victim",()=>{
  const origin=new T.Vector3(10,20,30),direction=new T.Vector3(1,0,0),s=sink(),f=fixture(s.make);
  f.manager.setEnabled(false);f.manager.ragdoll(f.actor,direction,0,origin);assert.equal(s.log.created,0);
  f.manager.setEnabled(true);f.manager.ragdoll(f.actor,direction,0,origin);
  assert.equal(s.log.created,1);assert.equal(s.log.emits.length,1);assert.ok(s.log.emits[0].origin.equals(origin));assert.ok(s.log.emits[0].normal.equals(direction));assert.equal(f.scene.children.length,1);
  f.manager.remove(f.actor);assert.equal(s.log.disposed,0,"blood already emitted is not cut short with its victim");
  f.manager.ragdoll(f.actor,direction,0,origin);assert.equal(s.log.created,1,"the same sink serves every hit");assert.equal(s.log.emits.length,2);
});
test("blood steps with the reactions, freezes for screenshots, and reset releases the sink",()=>{
  const s=sink(),f=fixture(s.make);f.manager.ragdoll(f.actor,new T.Vector3(1,0,0),0,new T.Vector3(0,0,50));
  f.manager.step(1/60,camera(200));assert.deepEqual(s.log.steps,[false]);
  f.manager.freeze();assert.equal(s.log.frozen,1);f.manager.step(1/60,camera(200));assert.deepEqual(s.log.steps,[false,true]);
  f.manager.reset();assert.equal(s.log.disposed,1);assert.equal(f.scene.children.length,0);
  f.manager.ragdoll(f.actor,new T.Vector3(1,0,0),0,new T.Vector3(0,0,50));assert.equal(s.log.created,2,"a new session builds a new sink");
});
