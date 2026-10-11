import * as THREE from "three";
import {playerGibs,modelPhysics,type ModelPhysics,type GibDefinition} from "../api";
import type {Actor} from "./actor";
import {SOURCE_TO_VIEWER,Rig} from "./animator";
import {buildGeometry} from "./geometryCache";
import {loadParticleModel,type ParticleModelInfo} from "./particles/assets";
import type {ShellLoader} from "./particles/weapons";
import type {MaterialData,ModelData} from "./payload";
import type {SourceMaterials} from "./sourceMaterials";

import {BloodPool,prepareBlood,type BloodSink} from "./particles/blood";
import {BloodDecals,type DecalSink} from "./particles/decals";
import {ArticulatedRagdoll,SOLVER_PASSES} from "./ragdollPhysics";
import {StuckArrows,arrowSpot,boltPlacement,pinPosition,transformedBox,wallAlong} from "./stuckArrows";
const TO_SOURCE=SOURCE_TO_VIEWER.clone().invert();
export function segmentHit(start:THREE.Vector3,end:THREE.Vector3,boxes:THREE.Box3[]):{point:THREE.Vector3;index:number}|null {
  const delta=end.clone().sub(start),length=delta.length();if(length<1e-8)return null;
  const ray=new THREE.Ray(start,delta.divideScalar(length));let nearest=length+1e-6,result:THREE.Vector3|null=null,index=-1;
  for(const [i,box] of boxes.entries()){const point=box.containsPoint(start)?start.clone():ray.intersectBox(box,new THREE.Vector3());if(point && point.distanceTo(start)<nearest){nearest=point.distanceTo(start);result=point;index=i;}}
  return result ? {point:result,index} : null;
}
const traceRoot=new THREE.Matrix4(),traceFrame=new THREE.Matrix4(),traceMatrix=new THREE.Matrix4(),traceInverse=new THREE.Matrix4();
const traceBounds=new THREE.Box3(),traceExtent=new THREE.Vector3(),traceStart=new THREE.Vector3(),traceEnd=new THREE.Vector3(),tracePoint=new THREE.Vector3(),traceBest=new THREE.Vector3();
const traceRay=new THREE.Ray(),traceDelta=new THREE.Vector3();
const traceHit=new THREE.Vector3(),traceCenter=new THREE.Vector3(),traceClosest=new THREE.Vector3();
/** How far a point is from a segment (no allocation). */
function distanceToSegment(point:THREE.Vector3,start:THREE.Vector3,end:THREE.Vector3){
  traceDelta.subVectors(end,start);
  const lengthSquared=traceDelta.lengthSq(),t=lengthSquared>1e-12?THREE.MathUtils.clamp(traceClosest.subVectors(point,start).dot(traceDelta)/lengthSquared,0,1):0;
  return traceClosest.copy(start).addScaledVector(traceDelta,t).distanceTo(point);
}
/** Whether the segment touches the box, with the point where it first does written to `out`; the one-box case of segmentHit, without allocating. */
function segmentBoxHit(start:THREE.Vector3,end:THREE.Vector3,box:THREE.Box3,out:THREE.Vector3){
  traceDelta.subVectors(end,start);const length=traceDelta.length();if(length<1e-8)return false;
  traceRay.origin.copy(start);traceRay.direction.copy(traceDelta).divideScalar(length);
  const point=box.containsPoint(start)?out.copy(start):traceRay.intersectBox(box,out);
  return !!point && point.distanceTo(start)<length+1e-6;
}
/** CreatePlayerGibs caps its normalized upward-biased impulse at 400, then randomizes each piece's direction. */
export function gibVelocity(impact:THREE.Vector3,random=Math.random) {
  const base=impact.clone();base.z+=1;base.normalize();
  return base.add(new THREE.Vector3(random()*2-1,random()*2-1,random())).normalize().multiplyScalar(400);
}

/** A position-based skeleton preview, not Source VPhysics. Bone lengths and torso diagonals are constrained. */
export class SkeletonRagdoll {
  readonly points:THREE.Vector3[];
  private previous:THREE.Vector3[];
  private readonly edges:{a:number;b:number;length:number}[]=[];
  private readonly initial:THREE.Vector3[];
  private accumulated=0;
  private age=0;
  sleeping=false;
  constructor(private matrices:THREE.Matrix4[],private parents:number[],velocity:THREE.Vector3,private floor:number,names:string[]=[]) {
    this.points=matrices.map(m=>new THREE.Vector3().setFromMatrixPosition(m));this.initial=this.points.map(p=>p.clone());
    this.previous=this.points.map((p,i)=>p.clone().addScaledVector(velocity,-1/120).add(new THREE.Vector3(0,(i%3-1)*.02,0)));
    parents.forEach((p,i)=>{if(p>=0)this.edges.push({a:p,b:i,length:this.points[p].distanceTo(this.points[i])});});
    // Short diagonals stop the spine and pelvis from folding into a zero-volume chain.
    parents.forEach((p,i)=>{const grand=p>=0?parents[p]:-1;if(grand>=0 && /spine|pelvis|neck|head/i.test(names[i] ?? ""))this.edges.push({a:grand,b:i,length:this.points[grand].distanceTo(this.points[i])});});
  }
  step(dt:number) {
    if(this.sleeping)return false;
    this.age+=dt;if(this.age>=12)this.sleeping=true;
    this.accumulated+=Math.min(.1,dt);
    while(this.accumulated>=1/120-1e-9){const h=1/120;this.accumulated-=h;
      this.points.forEach((p,i)=>{const old=p.clone();p.addScaledVector(p.clone().sub(this.previous[i]),.99).add(new THREE.Vector3(0,0,-800*h*h));this.previous[i].copy(old);});
      for(let k=0;k<10;k++){
        for(const e of this.edges){const a=this.points[e.a],b=this.points[e.b],d=b.clone().sub(a),len=d.length();if(len>1e-8){d.multiplyScalar((len-e.length)/len*.5);a.add(d);b.sub(d);}}
        this.points.forEach((p,i)=>{if(p.z<this.floor+2){p.z=this.floor+2;this.previous[i].x=THREE.MathUtils.lerp(this.previous[i].x,p.x,.25);this.previous[i].y=THREE.MathUtils.lerp(this.previous[i].y,p.y,.25);this.previous[i].z=p.z;}});
      }
    }
  }
  pose(rootInverse:THREE.Matrix4) {
    const world=this.matrices.map((m,i)=>{
      const rotation=new THREE.Quaternion();m.decompose(new THREE.Vector3(),rotation,new THREE.Vector3());
      const child=this.parents.findIndex((p,j)=>p===i && this.initial[j].distanceTo(this.initial[i])>1);
      if(child>=0){const from=this.initial[child].clone().sub(this.initial[i]).normalize(),to=this.points[child].clone().sub(this.points[i]).normalize();rotation.premultiply(new THREE.Quaternion().setFromUnitVectors(from,to));}
      return new THREE.Matrix4().compose(this.points[i],rotation,new THREE.Vector3(1,1,1));
    });
    const pos=new Float32Array(world.length*3),quat=new Float32Array(world.length*4);
    world.forEach((m,i)=>{const local=(this.parents[i]>=0?world[this.parents[i]].clone().invert():rootInverse.clone()).multiply(m);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();local.decompose(p,q,s);p.toArray(pos,i*3);q.toArray(quat,i*4);});
    return {pos,quat};
  }
}

interface Piece {group:THREE.Group;simulation:ArticulatedRagdoll|null;skeleton:THREE.Skeleton|null}
/** Everything about one gib model that does not depend on the victim: loaded once and shared by every character that bursts into it. */
interface GibAsset {model:ModelData;materials:Map<string,MaterialData|null>;metadata:ParticleModelInfo;physics:ModelPhysics;rig:Rig;meshes:{mesh:ModelData["bodyParts"][number]["models"][number]["meshes"][number];geo:THREE.BufferGeometry}[]}
interface Reaction {actor:Actor;clip:Actor["playback"]["clip"];time:number;playing:boolean;hidden:boolean;rootInverse:THREE.Matrix4;ragdoll?:SkeletonRagdoll|ArticulatedRagdoll;pieces:Piece[];savedPose:ReturnType<Actor["snapshotCustomPose"]>;floor:number}
export class HitReactions {
  enabled=true;
  frozen=false;
  private camera:THREE.Camera|undefined;
  private bloodPrepared=false;
  private entries=new Map<Actor,Reaction>();
  /** One blood effect for every victim (see BloodPool); created when the first hit needs it. */
  private bloodSink:BloodSink|null=null;
  /** The blood gibs leave on the floor (one layer for the whole scene). */
  private decalSink:DecalSink|null=null;
  /** Arrows left in bodies and walls by the Huntsman (one layer for the whole scene). */
  private stuck:StuckArrows|null=null;
  private definitions=new Map<string,Promise<GibDefinition[]>>();
  private physics=new Map<string,ModelPhysics>();
  private pendingPhysics=new Map<string,Promise<ModelPhysics>>();
  private getPhysics(path:string){let pending=this.pendingPhysics.get(path);if(!pending){pending=modelPhysics(path).then(p=>{this.physics.set(path,p);return p;});this.pendingPhysics.set(path,pending);pending.catch(()=>this.pendingPhysics.delete(path));}return pending;}
  private collisionModels=new Map<string,ParticleModelInfo>();
  private gibAssets=new Map<string,Promise<GibAsset>>();
  private gibGeometries:THREE.BufferGeometry[]=[];
  private disposed=false;
  /** Loads (once) what a gib model needs: its mesh data, materials, attachments, physics, skeleton and shared geometry. */
  private gibAsset(path:string,load:ShellLoader){
    let pending=this.gibAssets.get(path);
    if(!pending){
      pending=(async()=>{
        const [{model,materials},metadata,physics]=await Promise.all([load(path),loadParticleModel(path),this.getPhysics(path)]);
        const meshes:GibAsset["meshes"]=[];
        for(const part of model.bodyParts)for(const mesh of part.models[0]?.meshes ?? []){const geo=buildGeometry(mesh,false).geo;this.gibGeometries.push(geo);meshes.push({mesh,geo});}
        if(this.disposed)for(const m of meshes)m.geo.dispose();
        return {model,materials,metadata,physics,rig:new Rig(model.bones),meshes};
      })();
      this.gibAssets.set(path,pending);
      pending.catch(()=>this.gibAssets.delete(path));
    }
    return pending;
  }
  private gibDefinitions(path:string){let pending=this.definitions.get(path);if(!pending){pending=playerGibs(path);this.definitions.set(path,pending);pending.catch(()=>this.definitions.delete(path));}return pending;}
  /** Loads the gibs of a character's model ahead of the first explosion, so that its pieces appear in the frame it bursts. */
  private preloadGibs(path:string,load:ShellLoader){
    void this.gibDefinitions(path).then(definitions=>Promise.all(definitions.map(d=>this.gibAsset(d.model,load)))).catch(error=>console.error("Gib assets unavailable",error));
  }
  async prepare(load?:ShellLoader){if(this.enabled && !this.bloodPrepared){this.bloodPrepared=true;void prepareBlood().catch(e=>{this.bloodPrepared=false;console.error("Blood assets unavailable",e);});}await Promise.all(this.actors().map(async actor=>{const path=actor.particleModel?.path;if(!path)return;if(load&&this.enabled){this.preloadGibs(path,load);this.decals();}
    await Promise.all([!this.collisionModels.has(path)?loadParticleModel(path).then(m=>this.collisionModels.set(path,m)).catch(e=>console.error("Character hitboxes unavailable",e)):null,
      !this.physics.has(path)?this.getPhysics(path).catch(e=>console.error("Character physics unavailable",e)):null]);
  }));}
  constructor(private scene:THREE.Scene,private actors:()=>Actor[],private materials:SourceMaterials,private createPool:()=>BloodSink=()=>new BloodPool(),private createDecals:()=>DecalSink=()=>new BloodDecals()){}
  original(actor:Actor){const e=this.entries.get(actor);return e ? {pose:e.savedPose,time:e.time,playing:e.playing} : null;}
  has(actor:Actor){return this.entries.has(actor);}
  /** Whether some ragdoll or gib is still moving (their skeletons move without their meshes' transforms changing, which the shadow pass cannot see). */
  get animating(){for(const e of this.entries.values()){if(e.ragdoll && !e.ragdoll.sleeping)return true;for(const p of e.pieces)if(p.simulation && !p.simulation.sleeping)return true;}return false;}
  /** Releases the shared gib geometry (the scene is being torn down). */
  dispose(){this.disposed=true;this.reset();for(const geo of this.gibGeometries)geo.dispose();this.gibGeometries=[];this.gibAssets.clear();}
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.reset();}
  freeze(){this.frozen=true;this.bloodSink?.freeze();}
  reset(){for(const actor of [...this.entries.keys()])this.remove(actor);this.bloodSink?.dispose();this.bloodSink=null;this.decalSink?.dispose();this.decalSink=null;this.stuck?.dispose();this.stuck=null;this.frozen=false;}
  remove(actor:Actor){const e=this.entries.get(actor);if(!e)return;this.entries.delete(actor);this.stuck?.clearActor(actor);actor.setReactionHidden(false);actor.endLive();actor.setClip(e.clip);actor.playback.time=e.time;actor.playback.playing=e.playing;actor.poseBones();for(const p of e.pieces){(p.group.userData.wrapper as THREE.Group|undefined)?.removeFromParent();p.group.removeFromParent();p.skeleton?.dispose();}}
  private begin(actor:Actor,floor:number){
    const root=TO_SOURCE.clone().multiply(actor.particleRootFrame());
    const entry:Reaction={actor,clip:actor.playback.clip,time:actor.playback.time,playing:actor.playback.playing,hidden:false,rootInverse:root.clone().invert(),pieces:[],savedPose:actor.snapshotCustomPose(),floor};
    this.entries.set(actor,entry);actor.playback.playing=false;return {entry,root};
  }
  /**
   * Where a segment first meets a character (its posed hitboxes, or its bounds when its model has none), widened by `hull`: the distance,
   * the bone and hitbox, and the point (in `traceBest`, only while the result is the one that was asked for). No allocation: projectiles ask
   * this twice per frame each, and a flame every shot. A character the segment cannot get near is skipped before any hitbox is looked at.
   */
  private hitActor(actor:Actor,start:THREE.Vector3,end:THREE.Vector3,hull:number,limit:number,out:{distance:number;bone:number;box:number}):boolean{
    const model=this.collisionModels.get(actor.particleModel?.path ?? "");
    if(model?.hitboxes.length){
      traceRoot.copy(TO_SOURCE).multiply(actor.particleRootFrame(traceFrame));
      // a character is within about 150 units (times its scale) of its feet whatever it is doing: a sphere round that rules most of a crowd out
      const e=traceRoot.elements,scale=Math.max(Math.hypot(e[0],e[1],e[2]),Math.hypot(e[4],e[5],e[6]),Math.hypot(e[8],e[9],e[10]),1e-6);
      traceCenter.set(e[12],e[13],e[14]+45*scale);
      if(distanceToSegment(traceCenter,start,end)>150*scale+hull)return false;
      let found=false;
      for(const [index,box] of model.hitboxes.entries()){
        const bone=actor.particleBoneFrame(box.bone);if(!bone)continue;
        traceMatrix.multiplyMatrices(traceRoot,bone);traceInverse.copy(traceMatrix).invert();
        traceBounds.min.copy(box.min);traceBounds.max.copy(box.max);
        if(hull){const m=traceInverse.elements;traceExtent.set(Math.abs(m[0])+Math.abs(m[4])+Math.abs(m[8]),Math.abs(m[1])+Math.abs(m[5])+Math.abs(m[9]),Math.abs(m[2])+Math.abs(m[6])+Math.abs(m[10])).multiplyScalar(hull);traceBounds.min.sub(traceExtent);traceBounds.max.add(traceExtent);}
        if(!segmentBoxHit(traceStart.copy(start).applyMatrix4(traceInverse),traceEnd.copy(end).applyMatrix4(traceInverse),traceBounds,tracePoint))continue;
        tracePoint.applyMatrix4(traceMatrix);
        const distance=tracePoint.distanceTo(start);
        if(distance<limit && (!found || distance<out.distance)){found=true;out.distance=distance;out.bone=box.bone;out.box=index;traceHit.copy(tracePoint);}
      }
      return found;
    }
    const bounds=actor.computeBounds(new THREE.Box3()).applyMatrix4(TO_SOURCE).expandByScalar(hull);
    if(!segmentBoxHit(start,end,bounds,tracePoint))return false;
    const distance=tracePoint.distanceTo(start);
    if(distance>=limit)return false;
    out.distance=distance;out.bone=-1;out.box=-1;traceHit.copy(tracePoint);return true;
  }
  private readonly traceResult={distance:0,bone:-1,box:-1};
  /** The first character along a segment. */
  trace(owner:Actor,start:THREE.Vector3,end:THREE.Vector3,hull=0){
    let nearest=start.distanceTo(end)+1e-6,found:Actor|null=null,foundBone=-1,foundBox=-1;
    const result=this.traceResult;
    for(const actor of this.actors()){
      if(actor===owner || this.has(actor))continue;
      if(this.hitActor(actor,start,end,hull,nearest,result)){nearest=result.distance;found=actor;foundBone=result.bone;foundBox=result.box;traceBest.copy(traceHit);}
    }
    return found ? {point:traceBest.clone(),actor:found,bone:foundBone,box:foundBox} : null;
  }
  /**
   * Every character along a segment, the nearest first (a flame goes through a character and out the other side, so what stands behind
   * one is set alight as well; a bullet does not, and uses `trace`). `out` is emptied and filled; each character is there once.
   */
  traceAll(owner:Actor,start:THREE.Vector3,end:THREE.Vector3,hull:number,out:Actor[]):Actor[]{
    out.length=0;
    const length=start.distanceTo(end)+1e-6,result=this.traceResult,distances:number[]=[];
    for(const actor of this.actors()){
      if(actor===owner || this.has(actor))continue;
      if(this.hitActor(actor,start,end,hull,length,result)){
        let at=out.length;while(at>0 && distances[at-1]>result.distance)at--;
        out.splice(at,0,actor);distances.splice(at,0,result.distance);
      }
    }
    return out;
  }
  private arrows(){
    if(!this.stuck){this.stuck=new StuckArrows();this.scene.add(this.stuck.group);}
    return this.stuck;
  }
  /**
   * A Huntsman arrow reaching a character (tf_projectile_arrow.cpp). It lies inside the hitbox it struck; the victim dies, and the
   * arrow either stays in its body, following the bone through the ragdoll, or, when a wall is within PIN_RANGE along its path,
   * pins the ragdoll there with the bolt left in the wall. `model` is the flying arrow (copied); `world` gives the scene bounds.
   * Returns the point of impact, or null when the segment hits nobody.
   */
  arrowStrike(owner:Actor,start:THREE.Vector3,end:THREE.Vector3,direction:THREE.Vector3,model:THREE.Object3D,floor:number,world:()=>THREE.Box3){
    const hit=this.trace(owner,start,end);if(!hit)return null;
    if(!this.enabled)return hit.point;
    const {actor,bone}=hit,box=bone>=0?this.collisionModels.get(actor.particleModel?.path ?? "")?.hitboxes[hit.box]:undefined;
    const boneMatrix=box?StuckArrows.boneMatrix(actor,box.bone):null;
    const dir=direction.clone().normalize();
    let spot=hit.point;
    if(box&&boneMatrix){const aabb=transformedBox(boneMatrix,box.min,box.max);spot=arrowSpot(aabb.min,aabb.max);}
    this.ragdoll(actor,dir,floor,hit.point);
    if(!this.has(actor))return hit.point;
    const arrow=model.clone();
    const placed=new THREE.Matrix4().compose(spot,model.quaternion,new THREE.Vector3(1,1,1));
    const bounds=world(),wall=bounds.containsPoint(spot)?wallAlong(spot,dir,bounds):null,ragdoll=this.entries.get(actor)?.ragdoll;
    if(wall && box && ragdoll instanceof ArticulatedRagdoll && ragdoll.pin(box.bone,pinPosition(wall.point,dir))){
      this.arrows().fix(arrow,placed.setPosition(boltPlacement(wall.point,dir)));
    }else if(box)this.arrows().attach(arrow,actor,box.bone,placed);
    return hit.point;
  }
  private decals(){
    if(!this.decalSink){this.decalSink=this.createDecals();this.scene.add(this.decalSink.group);}
    return this.decalSink;
  }
  private blood(position:THREE.Vector3,direction:THREE.Vector3){
    if(!this.bloodSink){this.bloodSink=this.createPool();this.scene.add(this.bloodSink.group);if(this.frozen)this.bloodSink.freeze();}
    this.bloodSink.emit(position,direction,this.camera);
  }
  ragdoll(actor:Actor,direction:THREE.Vector3,floor:number,hitPosition?:THREE.Vector3){
    if(!this.enabled || this.has(actor) || !actor.particleModel)return;
    const {entry,root}=this.begin(actor,floor),bones=actor.particleModel.bones;
    const frames=bones.map((_,i)=>root.clone().multiply(actor.particleBoneFrame(i)!)),velocity=direction.clone().normalize().multiplyScalar(180).add(new THREE.Vector3(0,0,70));
    if(hitPosition)this.blood(hitPosition.clone(),direction);
    const physics=this.physics.get(actor.particleModel.path);
    entry.ragdoll=physics?.solids.length?new ArticulatedRagdoll(actor.particleModel,frames,physics,velocity,floor):new SkeletonRagdoll(frames,bones.map(b=>b.parent),velocity,floor,bones.map(b=>b.name));
  }
  explodeActor(actor:Actor,direction:THREE.Vector3,floor:number,load:ShellLoader){
    if(!this.enabled || this.has(actor))return;
    void this.gib(actor,direction,floor,load).catch(error=>console.error("Could not explode character",error));
  }
  /**
   * The box the game measures a blast against: the player collision hull (tf_gamerules.cpp g_TFViewVectors, -24..24 by 0..82 around the
   * feet, scaled with the model), found by RadiusDamage through CollisionProp()->CalcNearestPoint. It does not skin the mesh, so a
   * crowd costs nothing per victim.
   */
  blastHull(actor:Actor){
    const root=TO_SOURCE.clone().multiply(actor.particleRootFrame()),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();root.decompose(p,q,s);
    s.set(Math.abs(s.x)||1,Math.abs(s.y)||1,Math.abs(s.z)||1);
    return new THREE.Box3(new THREE.Vector3(p.x-24*s.x,p.y-24*s.y,p.z),new THREE.Vector3(p.x+24*s.x,p.y+24*s.y,p.z+82*s.z));
  }
  /** Most gib pieces that stay in the scene (twelve or so per character): the oldest ones go when a crowd's worth has burst. */
  static readonly MAX_GIB_PIECES=400;
  private dropPieces(e:Reaction){
    for(const p of e.pieces){(p.group.userData.wrapper as THREE.Group|undefined)?.removeFromParent();p.group.removeFromParent();p.skeleton?.dispose();}
    e.pieces=[];
  }
  /** Removes the pieces of the oldest gibbed characters (the character stays gone) while there are more than MAX_GIB_PIECES. */
  private trimGibs(){
    let total=0;for(const e of this.entries.values())total+=e.pieces.length;
    for(const e of this.entries.values()){ // the map keeps the order the characters burst in
      if(total<=HitReactions.MAX_GIB_PIECES)break;
      if(!e.pieces.length)continue;
      total-=e.pieces.length;this.dropPieces(e);
    }
  }
  /** Blood bursts of one explosion: the nearest victims only, so a crowd does not flood the particle systems. */
  static readonly BLOOD_PER_EXPLOSION=8;
  explosion(owner:Actor,position:THREE.Vector3,radius:number,floor:number,load:ShellLoader){
    if(!this.enabled || radius<=0)return;
    const victims:{actor:Actor;direction:THREE.Vector3;distance:number}[]=[];
    for(const actor of this.actors())if(actor!==owner && !this.has(actor)) {
      const box=this.blastHull(actor),distance=box.distanceToPoint(position);
      if(distance>radius)continue;
      victims.push({actor,direction:box.getCenter(new THREE.Vector3()).sub(position).normalize(),distance});
    }
    victims.sort((x,y)=>x.distance-y.distance);
    victims.forEach(({actor,direction},i)=>void this.gib(actor,direction,floor,load,i<HitReactions.BLOOD_PER_EXPLOSION).catch(error=>console.error("Could not load player gibs",error)));
  }
  private async gib(actor:Actor,direction:THREE.Vector3,floor:number,load:ShellLoader,blood=true){
    const path=actor.particleModel?.path;if(!path)return;
    const {entry,root}=this.begin(actor,floor);
    if(blood)this.blood(this.blastHull(actor).getCenter(new THREE.Vector3()),direction);
    const model=actor.particleModel!,boneFrames=model.bones.map((_,i)=>root.clone().multiply(actor.particleBoneFrame(i)!));
    try {
      const definitions=await this.gibDefinitions(path);if(!definitions.length)throw Error(`No break models in ${path}`);
      // every piece loads at once (and is usually cached already), so the whole burst appears in one frame
      const assets=await Promise.all(definitions.map(d=>this.gibAsset(d.model,load)));
      if(this.entries.get(actor)!==entry)return;
      const pieces:Piece[]=[];entry.pieces=pieces;
      definitions.forEach((definition,n)=>{
        const {model:gib,metadata,physics,rig,meshes,materials}=assets[n],group=new THREE.Group();
        let matrix=root.clone();
        const bone=model.bones.findIndex(b=>b.name.toLowerCase()===definition.bone.toLowerCase());
        if(bone>=0)matrix.copy(boneFrames[bone]);
        else {const attachment=metadata.attachments.find(a=>a.name.toLowerCase()==="placementorigin");const origin=attachment ? new THREE.Vector3().setFromMatrixPosition(rig.bindWorld[attachment.bone].clone().multiply(attachment.local)) : new THREE.Vector3();matrix.multiply(new THREE.Matrix4().makeTranslation(...new THREE.Vector3().fromArray(definition.offset).sub(origin).toArray()));}

        const velocity=new THREE.Vector3().fromArray(definition.velocity);if(!velocity.lengthSq())velocity.copy(gibVelocity(direction));else velocity.transformDirection(root).multiplyScalar(new THREE.Vector3().fromArray(definition.velocity).length());
        const burst=new THREE.Vector3().setFromMatrixPosition(matrix).sub(new THREE.Vector3().setFromMatrixPosition(root));velocity.addScaledVector(burst.normalize(),definition.burst);
        const angular=new THREE.Vector3(Math.random()*120,Math.random()*120,0).multiplyScalar(Math.PI/180);
        const frames=rig.bindWorld.map(m=>matrix.clone().multiply(m));
        const simulation=gib.bones.length?new ArticulatedRagdoll(gib,frames,physics,velocity,floor,angular):null;
        if(simulation && metadata.bloodSplat)simulation.onImpact=point=>{if(this.enabled && !this.frozen)this.decals().add(point,new THREE.Vector3(0,0,1));};
        const renderBones=gib.bones.map(()=>{const b=new THREE.Bone();b.matrixAutoUpdate=false;b.matrixWorldAutoUpdate=false;return b;});
        const skeleton=renderBones.length?new THREE.Skeleton(renderBones,rig.poseToBone):null;
        frames.forEach((m,i)=>renderBones[i].matrixWorld.copy(m));skeleton?.update();
        for(const {mesh,geo} of meshes){
          const material=this.materials.material(materials.get(mesh.materials[actor.particleTeam] ?? mesh.material) ?? null);
          const object=skeleton?new THREE.SkinnedMesh(geo,material):new THREE.Mesh(geo,material);
          if(object instanceof THREE.SkinnedMesh){object.bindMode=THREE.DetachedBindMode;object.bind(skeleton!,new THREE.Matrix4());}
          object.frustumCulled=false;group.add(object);
        }
        if(!simulation)matrix.decompose(group.position,group.quaternion,group.scale);
        pieces.push({group,simulation,skeleton});
      });
      entry.hidden=true;actor.setReactionHidden(true);this.stuck?.clearActor(actor);
      for(const piece of pieces){const wrapper=new THREE.Group();wrapper.matrixAutoUpdate=false;wrapper.matrix.copy(SOURCE_TO_VIEWER);wrapper.add(piece.group);this.scene.add(wrapper);piece.group.userData.wrapper=wrapper;}
      this.trimGibs();
    }catch(error){if(this.entries.get(actor)===entry){this.remove(actor);this.ragdoll(actor,direction,floor);}throw error;}
  }
  step(dt:number,camera?:THREE.Camera){
    if(camera)this.camera=camera;
    this.bloodSink?.step(dt,camera,this.frozen);
    if(this.frozen)return;
    this.stuck?.step(dt);
    // Every awake articulated body costs solver time: with many of them, each gets fewer constraint iterations (looser joints, same motion).
    let awake=0;for(const e of this.entries.values()){if(e.ragdoll instanceof ArticulatedRagdoll && !e.ragdoll.sleeping)awake++;for(const p of e.pieces)if(p.simulation && p.simulation.joints.length && !p.simulation.sleeping)awake++;}
    const passes=awake<=4?SOLVER_PASSES:awake<=8?16:10;
    for(const e of this.entries.values()){
      if(e.ragdoll && (e.ragdoll instanceof ArticulatedRagdoll?e.ragdoll.step(dt,passes):e.ragdoll.step(dt))!==false)e.actor.setLive(e.ragdoll.pose(e.rootInverse));
      for(const p of e.pieces)if(p.simulation && p.skeleton && p.simulation.step(dt,passes)!==false){
        p.simulation.worlds().forEach((m,i)=>p.skeleton!.bones[i].matrixWorld.copy(m));p.skeleton.update();
      }
    }
  }
}
