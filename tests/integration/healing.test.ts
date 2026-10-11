import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {Viewer} from "../../src/viewer/viewer";
import {SOURCE_TO_VIEWER} from "../../src/viewer/animator";
function fixture() {
  const actor=(x:number,team=0)=>({particleTeam:team,computeBounds:(out:THREE.Box3)=>out.copy(new THREE.Box3(new THREE.Vector3(x-10,-10,0),new THREE.Vector3(x+10,10,80)).applyMatrix4(SOURCE_TO_VIEWER)),particleRootFrame:()=>SOURCE_TO_VIEWER.clone().multiply(new THREE.Matrix4().makeTranslation(x,0,0))});
  const medic=actor(0),patient=actor(300),enemy=actor(150,1);
  let endpoint:THREE.Vector3|null=null;
  const effect={profile:{healing:{range:450}},muzzlePosition:new THREE.Vector3(0,0,40),setHealingTarget:(p:THREE.Vector3|null)=>endpoint=p};
  const viewer=Object.create(Viewer.prototype);Object.assign(viewer,{actorList:[medic,patient],healingTargets:new Map(),weaponEffects:new Map([[medic,{effect}]])});
  return {viewer,medic,patient,enemy,endpoint:()=>endpoint};
}
test("Medi Gun acquires friendly characters and follows their source origin plus 50",()=>{
  const f=fixture();assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),true);
  assert.deepEqual(f.endpoint()!.toArray(),[300,0,50]);
  assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(-1,0,0),true),true,"Retains patient when aim turns away");
  assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),false),false);assert.equal(f.endpoint(),null);
});
test("enemy obstruction blocks acquisition and breaks an existing beam",()=>{
  const f=fixture();f.viewer.actorList.push(f.enemy);
  assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),false);
  f.viewer.actorList.pop();assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),true);
  f.viewer.actorList.push(f.enemy);assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),false);
});
test("Medi Gun uses separate acquisition and 1.2x retention ranges",()=>{
  const f=fixture();assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),true);
  f.patient.computeBounds=(out:THREE.Box3)=>out.copy(new THREE.Box3(new THREE.Vector3(500,-10,0),new THREE.Vector3(520,10,80)).applyMatrix4(SOURCE_TO_VIEWER));
  assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(-1,0,0),true),true);
  f.viewer.healingTargets.clear();assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),false);
  f.patient.computeBounds=(out:THREE.Box3)=>out.copy(new THREE.Box3(new THREE.Vector3(560,-10,0),new THREE.Vector3(580,10,80)).applyMatrix4(SOURCE_TO_VIEWER));
  f.viewer.healingTargets.set(f.medic,f.patient);assert.equal(f.viewer.healWeapon(f.medic,new THREE.Vector3(1,0,0),true),false);
});
