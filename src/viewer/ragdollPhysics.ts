import * as T from "three";
import type {ModelPhysics} from "../api";
import type {ModelData} from "./payload";
import {Rig} from "./animator";
const H=1/120;
/** Fixed steps one frame may run. A slower frame slows the simulation down instead of piling up more work for the next one. */
const MAX_STEPS_PER_FRAME=4;
/** Constraint iterations per step when nothing else is going on; HitReactions lowers it while many bodies are awake. */
export const SOLVER_PASSES=24;
interface Body {bone:number;id:number;mass:number;p:T.Vector3;q:T.Quaternion;scale:T.Vector3;center:T.Vector3;half:T.Vector3;v:T.Vector3;w:T.Vector3;corners:T.Vector3[];support:T.Vector3[];/** Radius of a sphere about `p` that holds the collision capsule. */reach:number}
interface Joint {a:Body;b:Body;anchorA:T.Vector3;anchorB:T.Vector3;rest:T.Quaternion;restInverse:T.Quaternion;min:number[];max:number[]}
interface Shape {box:T.Box3;support:T.Vector3[]}
/** What the mesh says about each solid's size: the same for every character of a model, so it is measured once. */
const SHAPES=new WeakMap<ModelPhysics,WeakMap<ModelData,Map<number,Shape>>>();
function rotation(m:T.Matrix4){const q=new T.Quaternion();m.decompose(new T.Vector3(),q,new T.Vector3());return q;}
// Scratch values for the solver: it runs at 120 Hz for every awake body, so it allocates nothing per step.
const qa=new T.Quaternion(),qb=new T.Quaternion(),qc=new T.Quaternion(),qd=new T.Quaternion(),qe=new T.Quaternion(),euler=new T.Euler();
const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),vd=new T.Vector3(),ve=new T.Vector3(),vf=new T.Vector3(),vg=new T.Vector3(),vh=new T.Vector3();
const turnAxis=new T.Vector3(),turnQ=new T.Quaternion();
const poseInverse=new T.Matrix4(),poseLocal=new T.Matrix4(),posePosition=new T.Vector3(),poseRotation=new T.Quaternion(),poseScale=new T.Vector3();
interface Capsule {a:T.Vector3;b:T.Vector3;radius:number}
const capA:Capsule={a:new T.Vector3(),b:new T.Vector3(),radius:0},capB:Capsule={a:new T.Vector3(),b:new T.Vector3(),radius:0};
function turn(b:Body,axis:T.Vector3){const n=axis.length();if(n>1e-8)b.q.premultiply(turnQ.setFromAxisAngle(turnAxis.copy(axis).divideScalar(n),Math.min(.12,n))).normalize();}
/** Fixed-step articulated preview using the installed PHY's masses, joint limits and collision rules.
 * Collision hulls approximate the mesh; this is not the native VPhysics convex solver. */
export class ArticulatedRagdoll {
  readonly bodies:Body[]=[];
  readonly joints:Joint[]=[];
  private pairs:[Body,Body][]=[];
  private followers:{body:Body;local:T.Matrix4}[]=[];
  private remainder=0;private age=0;private quiet=0;
  private previousP:T.Vector3[]=[];private previousQ:T.Quaternion[]=[];
  private bodyMatrices:T.Matrix4[]=[];
  private followerBody:number[]=[];
  private worldMatrices:T.Matrix4[]=[];
  private poseOut:{pos:Float32Array;quat:Float32Array}|null=null;
  sleeping=false;
  /** A body held where an arrow nailed it to a wall (StickRagdollNowTF freezes the bone it hit); the rest hangs from it. */
  private pinned:{body:Body;at:T.Vector3;q:T.Quaternion}|null=null;
  /** Called with the point where the body lands on the floor, at most every 0.1 s (the game throttles a prop's touches the same way); gibs use it to splash blood. */
  onImpact:((point:T.Vector3)=>void)|null=null;
  private touching=false;private bodyTouch:boolean[]=[];private impactAt=-Infinity;
  constructor(private model:ModelData,initial:T.Matrix4[],physics:ModelPhysics,velocity:T.Vector3,private floor:number,angular=new T.Vector3()) {
    const rig=new Rig(model.bones),byBone=new Map<number,Body>(),byId=new Map<number,Body>();
    const solids=physics.solids.length?physics.solids:[{index:0,bone:model.bones[0]?.name ?? "",mass:1}];
    for(const solid of solids){let bone=model.bones.findIndex(b=>b.name.toLowerCase()===solid.bone.toLowerCase());if(bone<0 && solids.length===1)bone=0;if(bone<0)continue;
      const p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();initial[bone].decompose(p,q,scale);
      const body:Body={bone,id:solid.index,mass:Math.max(.1,solid.mass),p,q,scale,center:new T.Vector3(),half:new T.Vector3(2,2,2),v:velocity.clone(),w:angular.clone(),corners:[],support:[],reach:0};this.bodies.push(body);byBone.set(bone,body);byId.set(solid.index,body);
    }
    const ancestor=(bone:number)=>{while(bone>=0){const b=byBone.get(bone);if(b)return b;bone=model.bones[bone]?.parent ?? -1;}return this.bodies[0];};
    const shapes=this.measure(model,physics,rig,ancestor);
    for(const b of this.bodies){const shape=shapes.get(b.id);const box=shape?.box;if(box && !box.isEmpty()){box.getCenter(b.center);box.getSize(b.half).multiplyScalar(.5);b.half.max(new T.Vector3(.5,.5,.5));}
      // Store physical dimensions in world units, rotating about the geometry centre rather than the MDL origin.
      b.support=shape?.support.map(point=>point.clone()) ?? [];
      for(const point of b.support)point.multiply(b.scale);
      b.center.multiply(b.scale);b.half.multiply(b.scale);b.half.set(Math.abs(b.half.x),Math.abs(b.half.y),Math.abs(b.half.z));b.p.add(b.center.clone().applyQuaternion(b.q));
      for(const point of b.support)point.sub(b.center);
      for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])b.corners.push(new T.Vector3(x*b.half.x,y*b.half.y,z*b.half.z));
      if(!b.support.length)b.support=b.corners;
      b.reach=b.half.length();
    }
    for(const source of physics.joints){const a=byId.get(source.parent),b=byId.get(source.child);if(!a || !b)continue;
      const childOrigin=new T.Vector3().setFromMatrixPosition(rig.bindWorld[b.bone]);
      const local=childOrigin.applyMatrix4(rig.poseToBone[a.bone]).multiply(a.scale).sub(a.center);
      const rest=rotation(rig.bindWorld[a.bone]).invert().multiply(rotation(rig.bindWorld[b.bone]));
      this.joints.push({a,b,anchorA:local,anchorB:b.center.clone().negate(),rest,restInverse:rest.clone().invert(),min:source.min.map(T.MathUtils.degToRad),max:source.max.map(T.MathUtils.degToRad)});
    }
    if(physics.selfCollisions!==false)for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++){
      const a=this.bodies[i],b=this.bodies[j];const enabled=physics.collisionRules?physics.collisionPairs.some(p=>p.includes(a.id)&&p.includes(b.id)):!this.joints.some(p=>p.a===a&&p.b===b || p.a===b&&p.b===a);
      if(enabled)this.pairs.push([a,b]);
    }
    this.followers=model.bones.map((_,i)=>{const body=ancestor(i)!;return {body,local:initial[body.bone].clone().invert().multiply(initial[i])};});
    this.previousP=this.bodies.map(b=>b.p.clone());this.previousQ=this.bodies.map(b=>b.q.clone());
    this.bodyMatrices=this.bodies.map(()=>new T.Matrix4());
    this.followerBody=this.followers.map(f=>this.bodies.indexOf(f.body));
  }
  /** The box (and, for a single body, the vertices) around each solid, from the vertices its bones move most; cached per model. */
  private measure(model:ModelData,physics:ModelPhysics,rig:Rig,ancestor:(bone:number)=>Body):Map<number,Shape> {
    let byModel=SHAPES.get(physics);if(!byModel){byModel=new WeakMap();SHAPES.set(physics,byModel);}
    const cached=byModel.get(model);if(cached)return cached;
    const shapes=new Map<number,Shape>(this.bodies.map(b=>[b.id,{box:new T.Box3(),support:[]}]));
    const point=new T.Vector3();
    for(const part of model.bodyParts)for(const mesh of part.models[0]?.meshes ?? [])for(let v=0;v<mesh.positions.length/3;v++){
      let slot=0;for(let k=1;k<4;k++)if(mesh.skinWeights[v*4+k]>mesh.skinWeights[v*4+slot])slot=k;
      const body=ancestor(mesh.skinIndices[v*4+slot]);if(!body)continue;
      point.fromArray(mesh.positions,v*3).applyMatrix4(rig.poseToBone[body.bone]);
      const shape=shapes.get(body.id)!;shape.box.expandByPoint(point);if(this.bodies.length===1)shape.support.push(point.clone());
    }
    byModel.set(model,shapes);
    return shapes;
  }
  private matrix(b:Body,out=new T.Matrix4()){return out.compose(vh.copy(b.center).applyQuaternion(b.q).negate().add(b.p),b.q,b.scale);}
  /** The world matrix of every bone. The array and its matrices are reused: read them before the next call. */
  worlds(){
    this.bodies.forEach((b,i)=>this.matrix(b,this.bodyMatrices[i]));
    this.followers.forEach(({local},i)=>(this.worldMatrices[i]??=new T.Matrix4()).copy(this.bodyMatrices[this.followerBody[i]]).multiply(local));
    return this.worldMatrices;
  }
  /** Every bone's transform relative to its parent (to `rootInverse` for the root). The arrays are reused: copy them to keep them. */
  pose(rootInverse:T.Matrix4){
    const world=this.worlds(),n=world.length,out=this.poseOut??={pos:new Float32Array(n*3),quat:new Float32Array(n*4)};
    for(let i=0;i<n;i++){
      const parent=this.model.bones[i].parent;
      if(parent>=0)poseInverse.copy(world[parent]).invert();else poseInverse.copy(rootInverse);
      poseLocal.multiplyMatrices(poseInverse,world[i]).decompose(posePosition,poseRotation,poseScale);
      posePosition.toArray(out.pos,i*3);poseRotation.toArray(out.quat,i*4);
    }
    return out;
  }
  private limit(j:Joint){
    qa.copy(j.a.q).invert().multiply(j.b.q);
    qb.copy(j.restInverse).multiply(qa);
    euler.setFromQuaternion(qb,"XYZ");
    euler.set(T.MathUtils.clamp(euler.x,j.min[0],j.max[0]),T.MathUtils.clamp(euler.y,j.min[1],j.max[1]),T.MathUtils.clamp(euler.z,j.min[2],j.max[2]),"XYZ");
    qa.setFromEuler(euler);
    qb.copy(j.a.q).multiply(j.rest).multiply(qa);                   // target
    qc.copy(j.b.q).invert();qd.copy(qb).multiply(qc);               // correction
    const wb=j.a.mass/(j.a.mass+j.b.mass);j.b.q.slerp(qb,wb);
    qe.identity().slerp(qd.invert(),1-wb);j.a.q.premultiply(qe).normalize();
  }
  private anchor(j:Joint){
    va.copy(j.anchorA).applyQuaternion(j.a.q);vb.copy(j.anchorB).applyQuaternion(j.b.q);
    vc.copy(j.b.p).add(vb).sub(j.a.p).sub(va);const wa=j.b.mass/(j.a.mass+j.b.mass);
    j.a.p.addScaledVector(vc,wa);j.b.p.addScaledVector(vc,-(1-wa));
    vd.copy(va).cross(vc).multiplyScalar(.15*wa/Math.max(4,va.lengthSq()));turn(j.a,vd);
    vd.copy(vb).cross(vc).multiplyScalar(-.15*(1-wa)/Math.max(4,vb.lengthSq()));turn(j.b,vd);
  }
  private capsule(b:Body,out:Capsule){
    const hx=b.half.x,hy=b.half.y,hz=b.half.z;let axis=0,longest=hx;if(hy>longest){axis=1;longest=hy;}if(hz>longest){axis=2;longest=hz;}
    const radius=Math.max(.5,Math.min(hx,hy,hz)*.75);out.radius=radius;
    ve.set(0,0,0).setComponent(axis,Math.max(0,longest-radius)).applyQuaternion(b.q);
    out.a.copy(b.p).sub(ve);out.b.copy(b.p).add(ve);
  }
  private contact(a:Body,b:Body){
    // Capsules lie inside the sphere of radius \`reach\` about their body; most pairs of a ragdoll are far apart.
    const reach=a.reach+b.reach;if(a.p.distanceToSquared(b.p)>reach*reach)return;
    this.capsule(a,capA);this.capsule(b,capB);
    const u=va.copy(capA.b).sub(capA.a),v=vb.copy(capB.b).sub(capB.a),w=vc.copy(capA.a).sub(capB.a),aa=u.dot(u),bb=u.dot(v),cc=v.dot(v),dd=u.dot(w),ee=v.dot(w),den=aa*cc-bb*bb;
    let s=den>1e-8?T.MathUtils.clamp((bb*ee-cc*dd)/den,0,1):0;let t=cc>1e-8?T.MathUtils.clamp((bb*s+ee)/cc,0,1):0;s=aa>1e-8?T.MathUtils.clamp((bb*t-dd)/aa,0,1):0;t=cc>1e-8?T.MathUtils.clamp((bb*s+ee)/cc,0,1):0;
    const delta=vd.copy(capB.a).addScaledVector(v,t).sub(ve.copy(capA.a).addScaledVector(u,s)),distance=delta.length(),penetration=capA.radius+capB.radius-distance;if(penetration<=0)return;if(distance<1e-6)delta.set(1,0,0);else delta.divideScalar(distance);
    const weight=b.mass/(a.mass+b.mass);a.p.addScaledVector(delta,-penetration*weight);b.p.addScaledVector(delta,penetration*(1-weight));
  }
  /** World-space inverse inertia of a torque, approximated from the mesh bounds (written to \`out\`). */
  private inverseInertia(b:Body,torque:T.Vector3,out:T.Vector3){
    const h=b.half;out.copy(torque).applyQuaternion(qa.copy(b.q).invert());
    out.set(out.x*3/(b.mass*(h.y*h.y+h.z*h.z)),out.y*3/(b.mass*(h.x*h.x+h.z*h.z)),out.z*3/(b.mass*(h.x*h.x+h.y*h.y)));
    return out.applyQuaternion(b.q);
  }
  private effectiveMass(b:Body,r:T.Vector3,direction:T.Vector3){vf.copy(r).cross(direction);this.inverseInertia(b,vf,vg);return 1/b.mass+vg.cross(r).dot(direction);}
  private impulse(b:Body,r:T.Vector3,impulse:T.Vector3){b.v.addScaledVector(impulse,1/b.mass);vf.copy(r).cross(impulse);b.w.add(this.inverseInertia(b,vf,vg));}
  private impact(point:T.Vector3){if(!this.onImpact || this.age-this.impactAt<.1)return;this.impactAt=this.age;this.onImpact(point.clone());}
  /** Free debris keeps angular momentum; contact friction exchanges it with linear motion. */
  private debrisStep(b:Body){
    b.v.z-=800*H;b.p.addScaledVector(b.v,H);turn(b,va.copy(b.w).multiplyScalar(H));
    const down=vb.set(0,0,1).applyQuaternion(qb.copy(b.q).invert());
    let minimum=Infinity;for(const point of b.support)minimum=Math.min(minimum,point.dot(down));
    const gap=b.p.z+minimum-this.floor;
    if(gap<=.05){
      const landed=!this.touching;this.touching=true;
      b.p.z-=Math.min(0,gap);
      // Average coplanar supporting vertices: a flat face rests on its centre rather than an arbitrary corner.
      const r=vc.set(0,0,0);let count=0;for(const point of b.support)if(point.dot(down)<=minimum+.05){r.add(point);count++;}r.divideScalar(count).applyQuaternion(b.q);
      if(landed)this.impact(ve.copy(b.p).add(r));
      const normal=vd.set(0,0,1),contact=ve.copy(b.w).cross(r).add(b.v),closing=contact.z;
      const normalImpulse=Math.max(0,-closing*(closing<-30?1.25:1)/this.effectiveMass(b,r,normal));
      this.impulse(b,r,normal.multiplyScalar(normalImpulse));
      const slip=vd.copy(b.w).cross(r).add(b.v);slip.z=0;
      if(slip.lengthSq()>1e-10){const length=slip.length(),amount=Math.min(length/this.effectiveMass(b,r,slip.normalize()),.5*normalImpulse);this.impulse(b,r,slip.multiplyScalar(-amount));}
      // Small rolling resistance dissipates energy after the slip impulse; never zero spin at first contact.
      b.w.multiplyScalar(Math.exp(-.6*H));
    }else this.touching=false;
    b.v.multiplyScalar(Math.exp(-.15*H));b.w.multiplyScalar(Math.exp(-.2*H));
  }
  /**
   * Nails the body of `bone` (or the nearest one above it) with its origin at `position`, and wakes the ragdoll: the body no longer
   * moves or turns, and the others hang from it by their joints.
   */
  pin(bone:number,position:T.Vector3){
    let at=bone;while(at>=0 && !this.bodies.some(b=>b.bone===at))at=this.model.bones[at]?.parent ?? -1;
    const body=this.bodies.find(b=>b.bone===at) ?? this.bodies[0];if(!body)return false;
    this.pinned={body,at:position.clone().add(body.center.clone().applyQuaternion(body.q)),q:body.q.clone()};
    this.sleeping=false;this.quiet=0;this.age=Math.min(this.age,8);return true;
  }
  private hold(){const pin=this.pinned;if(pin){pin.body.p.copy(pin.at);pin.body.q.copy(pin.q);pin.body.v.set(0,0,0);pin.body.w.set(0,0,0);}}
  step(dt:number,passes=SOLVER_PASSES){if(this.sleeping)return false;this.remainder+=Math.min(MAX_STEPS_PER_FRAME*H+1e-6,Math.max(0,dt));while(this.remainder>=H-1e-9){this.remainder-=H;this.age+=H;
    if(this.bodies.length===1 && !this.joints.length){
      const b=this.bodies[0];this.debrisStep(b);this.hold();
      this.quiet=b.v.length()<3 && b.w.length()*b.half.length()<3?this.quiet+H:0;
      if(this.quiet>.75 || this.age>=20){this.sleeping=true;this.remainder=0;break;}continue;
    }
    for(let i=0;i<this.bodies.length;i++){this.previousP[i].copy(this.bodies[i].p);this.previousQ[i].copy(this.bodies[i].q);}
    for(const b of this.bodies){b.v.z-=800*H;b.p.addScaledVector(b.v,H);turn(b,va.copy(b.w).multiplyScalar(H));}
    this.hold();
    for(let pass=0;pass<passes;pass++){
      for(const j of this.joints){this.limit(j);this.anchor(j);}
      for(const [a,b] of this.pairs)this.contact(a,b);
      for(const b of this.bodies){let lowestZ=Infinity;for(const corner of b.corners){const r=va.copy(corner).applyQuaternion(b.q);if(r.z<lowestZ){lowestZ=r.z;vb.copy(r);}}
        const penetration=this.floor-b.p.z-lowestZ;if(penetration>0){b.p.z+=penetration;turn(b,vc.copy(vb).cross(vd.set(0,0,penetration)).multiplyScalar(.2/Math.max(4,b.half.lengthSq())));}
      }
      this.hold();
    }
    let speed=0;this.bodies.forEach((b,i)=>{b.v.copy(b.p).sub(this.previousP[i]).divideScalar(H).multiplyScalar(.985);const dq=qa.copy(b.q).multiply(qb.copy(this.previousQ[i]).invert());if(dq.w<0)dq.set(-dq.x,-dq.y,-dq.z,-dq.w);const angle=2*Math.acos(T.MathUtils.clamp(dq.w,-1,1)),axis=va.set(dq.x,dq.y,dq.z);b.w.copy(axis.lengthSq()>1e-10?axis.normalize().multiplyScalar(Math.min(12,angle/H)*.92):vb.set(0,0,0));
      let lowest=Infinity;for(const c of b.corners){const z=va.copy(c).applyQuaternion(b.q).z;if(z<lowest){lowest=z;vc.copy(va);}}
      const ground=b.p.z+lowest<this.floor+.2;
      if(ground!==!!this.bodyTouch[i]){this.bodyTouch[i]=ground;if(ground)this.impact(vd.copy(b.p).add(vc));}
      if(ground){b.v.x*=.8;b.v.y*=.8;b.w.multiplyScalar(.8);}speed=Math.max(speed,b.v.length(),b.w.length()*5);
    });this.quiet=speed<3?this.quiet+H:0;if(this.quiet>.75 || this.age>=20){this.sleeping=true;this.remainder=0;break;}
  }return true;}
}
