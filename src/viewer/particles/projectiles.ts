import * as THREE from "three";
import type { ProjectileProfile, WeaponProfile } from "../../api";
import { bakeSequence, particleSystemFile } from "../../api";
import { parseClip } from "../payload";
import { Rig } from "../animator";
import { buildGeometry } from "../geometryCache";
import type { SourceMaterials } from "../sourceMaterials";
import type { ShellLoader } from "./weapons";
import { loadDefinitions, loadParticleMaterial, loadParticleModel } from "./assets";
import { NativeSimulation, NativeRenderNode, nativeControlPoint } from "./native";
import { ParticleRopeDraw } from "./rope";
import type { WeaponParticleSnapshot } from "./weaponSnapshot";

export interface ProjectileMotion { position: THREE.Vector3; velocity: THREE.Vector3; rotation: THREE.Quaternion; angular: THREE.Vector3; age: number; active: boolean; settled?:boolean; impactNormal?:THREE.Vector3 }
/** Source VectorAngles with zero roll, including vertical aim. */
export function projectileRotation(direction:THREE.Vector3) {
  const yaw=Math.atan2(direction.y,direction.x), pitch=-Math.atan2(direction.z,Math.hypot(direction.x,direction.y));
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0,pitch,yaw,"ZYX"));
}
/** Source x-forward/z-up launch velocity, including grenade up boost and syringe spread. */
export function launchProjectile(profile: ProjectileProfile, position: THREE.Vector3, direction: THREE.Vector3, random = Math.random): ProjectileMotion {
  const forward = direction.clone().normalize();
  if (profile.kind === "syringe") {
    const yaw = Math.atan2(forward.y, forward.x) + (random() * 3 - 1.5) * Math.PI / 180;
    const pitch = Math.asin(forward.z) + (random() * 3 - 1.5) * Math.PI / 180;
    forward.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
  }
  const right = new THREE.Vector3(forward.y, -forward.x, 0).normalize(), up = right.clone().cross(forward).normalize();
  const velocity = forward.clone().multiplyScalar(profile.speed);
  // thrown out food (CTFLunchBox::SecondaryAttack): ten degrees above the aim
  if (profile.kind === "plate") velocity.copy(forward).multiplyScalar(Math.cos(10 * Math.PI / 180)).addScaledVector(up, Math.sin(10 * Math.PI / 180)).multiplyScalar(profile.speed);
  if (["grenade","cannon","sticky","jar"].includes(profile.kind)) velocity.addScaledVector(up, 200 + random() * 20 - 10).addScaledVector(right, random() * 20 - 10);
  // CTFCleaver::GetVelocityVector: forward * 10 + up, normalized, at 3000 units/s
  if (profile.kind === "cleaver") velocity.copy(forward).multiplyScalar(10).add(up).normalize().multiplyScalar(profile.speed);
  const rotation = projectileRotation(forward);
  // the jar rolls about its own axis (300 deg/s) and the cleaver tumbles end over end (500 deg/s): their AngularImpulses
  const angular = profile.kind === "jar" ? new THREE.Vector3(300 * Math.PI / 180, 0, 0) : profile.kind === "cleaver" ? new THREE.Vector3(0, 500 * Math.PI / 180, 0) : null;
  return { position: position.clone(), velocity, rotation, angular: angular ?? (profile.spin ? new THREE.Vector3(600, Math.floor(random() * 2401) - 1200, 0).multiplyScalar(Math.PI / 180) : new THREE.Vector3()), age: 0, active: true };
}
const spinRotation = new THREE.Quaternion(), spinEuler = new THREE.Euler();
/** Fixed-step ballistic motion. The viewer uses a floor and scene bounds in place of a Source map/VPhysics world. */
export function stepProjectile(m: ProjectileMotion, profile: ProjectileProfile, dt: number, floor: number, bounds=new THREE.Box3(new THREE.Vector3(-2048,-2048,floor),new THREE.Vector3(2048,2048,floor+2048))) {
  if (!m.active) return;
  m.age += dt;
  if(!m.settled) {
    m.position.addScaledVector(m.velocity, dt); m.position.z -= .5 * profile.gravity * dt * dt;
    m.velocity.z -= profile.gravity * dt;
    if(["syringe","arrow"].includes(profile.kind) && m.velocity.lengthSq()>0) m.rotation.copy(projectileRotation(m.velocity));
    if (profile.spin) m.rotation.multiply(spinRotation.setFromEuler(spinEuler.set(m.angular.x * dt, m.angular.y * dt, m.angular.z * dt)));
    const radius = ["grenade","cannon","sticky","jar","cleaver","plate"].includes(profile.kind) ? 8 : 1;
    for(const axis of ["x","y","z"] as const) {
      const min=axis==="z" ? Math.max(floor,bounds.min.z)+radius : bounds.min[axis]+radius,max=bounds.max[axis]-radius;
      if(m.position[axis]>=min && m.position[axis]<=max) continue;
      const sign=m.position[axis]<min ? 1 : -1;
      m.position[axis]=sign===1 ? min : max;
      m.impactNormal=new THREE.Vector3();m.impactNormal[axis]=sign;
      if(profile.kind==="sticky" || profile.kind==="arrow" || profile.kind==="cleaver") {m.settled=true;m.velocity.set(0,0,0);m.angular.set(0,0,0);}
      else if(["grenade","cannon","plate"].includes(profile.kind)) {
        m.velocity.multiplyScalar(.45);m.velocity[axis]=Math.abs(m.velocity[axis])*sign;
        if(m.velocity.lengthSq()<900 && axis==="z" && sign===1) {m.settled=true;m.velocity.set(0,0,0);m.angular.set(0,0,0);}
      } else m.active=false;
      break;
    }
  }
  if (m.age >= profile.lifetime) m.active = false;
}

export interface ProjectileInteractions {hit:(start:THREE.Vector3,end:THREE.Vector3)=>THREE.Vector3|null;/** An arrow's own test: it also leaves the arrow in whatever it strikes (given the flying arrow, to copy). */arrow?:(start:THREE.Vector3,end:THREE.Vector3,direction:THREE.Vector3,model:THREE.Object3D)=>THREE.Vector3|null;explosion:(position:THREE.Vector3,radius:number)=>void;/** A jar burst at this point; everything within the radius gets wet. */splash?:(position:THREE.Vector3,radius:number)=>void}
interface Slot { group: THREE.Group; matrix: THREE.Matrix4; motion: ProjectileMotion | null; action: number; stopped: number; model: string; team: number; profile?:ProjectileProfile; pulseAction?:number; pulsed?:boolean; trailStopped?:boolean }
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
export class WeaponProjectiles {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly slots: Slot[] = [];
  private trailAttachment = new THREE.Matrix4();
  private time = 0;
  private readonly trails=new Map<Slot,{node:NativeRenderNode;draw:ParticleRopeDraw;material:string}>();
  private readonly impacts = new Map<string, {matrix:THREE.Matrix4;action:number}[]>();
  /** Throws that wait for their moment (a jar leaves the hand 0.1 s into the animation). */
  private readonly pending: {at:number;origin:THREE.Matrix4;direction:THREE.Vector3}[] = [];
  private constructor(private readonly profile: ProjectileProfile, private readonly floor: number,private readonly bounds?:THREE.Box3,private readonly interactions?:ProjectileInteractions) {}
  static async create(profile: WeaponProfile, load: ShellLoader, materials: SourceMaterials, floor: number, register: (sim: NativeSimulation, file: string) => Promise<void>,bounds?:THREE.Box3,interactions?:ProjectileInteractions) {
    if (!profile.projectile) return null;
    const result = new WeaponProjectiles(profile.projectile, floor,bounds,interactions);
    try {
      const template = profile.projectile.model ? await result.model(profile.projectile.model, profile.projectile.team, load, materials) : new THREE.Group();
      if (profile.projectile.kind === "rocket") {
        const info = await loadParticleModel(profile.projectile.model), rig = template.userData.rig as Rig;
        const attachment = info.attachments.find(a => a.name.toLowerCase() === "trail");
        if (attachment && rig.boneWorld[attachment.bone]) result.trailAttachment.copy(rig.boneWorld[attachment.bone]).multiply(attachment.local);
      }
      delete template.userData.rig;
      const count = 32;
      for (let i = 0; i < count; i++) {
        const group = template.clone(); group.visible = false; group.scale.setScalar(profile.projectile.scale ?? 1); group.updateMatrix();
        result.group.add(group);
        result.slots.push({ group, matrix: new THREE.Matrix4(), motion: null, action: 0, stopped: -Infinity, model: profile.projectile.model, team: profile.projectile.team });
      }
      if(profile.projectile.spriteTrail) for(const slot of result.slots) await result.addSpriteTrail(slot,profile.projectile.spriteTrail);
      const system = profile.projectile.trail;
      if (system) {
        const file = await particleSystemFile(system), definitions = await loadDefinitions(file);
        const sim = await NativeSimulation.create(definitions, () => new THREE.Matrix4(), console.error, file, system, () => [], 0, [], profile.weaponClass === "tf_weapon_raygun" ? [...(profile.colors ?? []).slice(3), ...(profile.colors ?? []).slice(0,3)] : profile.colors, count, () => result.slots.map(slot => {
          const row = [...nativeControlPoint(slot.matrix), slot.action]; slot.action = 0; return row;
        }));
        if (!sim) throw new Error("Native helper is required for projectile trails");
        await register(sim, file);
      }
      for(const name of new Set([profile.projectile.impact,profile.projectile.impactAir].filter((s):s is string=>!!s))) {
        const file=await particleSystemFile(name), definitions=await loadDefinitions(file);
        const slots=Array.from({length:8},()=>({matrix:new THREE.Matrix4(),action:0}));result.impacts.set(name,slots);
        const sim=await NativeSimulation.create(definitions,()=>new THREE.Matrix4(),console.error,file,name,()=>[],0,[],profile.colors,slots.length,
          ()=>slots.map(slot=>{const row=[...nativeControlPoint(slot.matrix),slot.action];slot.action=0;return row;}));
        if(!sim) throw new Error("Native helper is required for projectile impacts");
        await register(sim,file);
      }
      if(profile.projectile.kind==="sticky") {
        const name=profile.projectile.team ? "stickybomb_pulse_blue" : "stickybomb_pulse_red",file=await particleSystemFile(name);
        const sim=await NativeSimulation.create(await loadDefinitions(file),()=>new THREE.Matrix4(),console.error,file,name,()=>[],0,[],[],count,
          ()=>result.slots.map(slot=>{const row=[...nativeControlPoint(slot.matrix),slot.pulseAction ?? 0];slot.pulseAction=0;return row;}));
        if(!sim) throw new Error("Native helper is required for sticky arming effects");await register(sim,file);
      }
      return result;
    } catch (error) { result.dispose(); throw error; }
  }
  private async model(path: string, team: number, load: ShellLoader, materials: SourceMaterials) {
    const { model, materials: data } = await load(path), rig = new Rig(model.bones), group = new THREE.Group(); group.userData.rig = rig;
    // Entity angles rotate the posed MDL, not its raw VVD bind mesh. Projectile
    // idle sequences contain the authored basis change (and syringe offset).
    if(model.bones.length) rig.poseFromClip(parseClip(await bakeSequence(path,0,[])),0);
    const skin = model.bones.map((_, i) => rig.boneWorld[i].clone().multiply(rig.poseToBone[i]));
    for (const part of model.bodyParts) for (const mesh of part.models[0]?.meshes ?? []) {
      if (!mesh.indices.length) continue;
      const geo = buildGeometry(mesh, true).geo, positions = geo.getAttribute("position"), normals = geo.getAttribute("normal"), tangents = geo.getAttribute("tangent");
      for (let v = 0; v < positions.count; v++) {
        const pos = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3();
        for (let k = 0; k < 4; k++) {
          const weight = mesh.skinWeights[v * 4 + k]; if (!weight) continue;
          const matrix = skin[mesh.skinIndices[v * 4 + k]];
          pos.addScaledVector(new THREE.Vector3().fromBufferAttribute(positions, v).applyMatrix4(matrix), weight);
          normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(normals, v).transformDirection(matrix), weight);
          tangent.addScaledVector(new THREE.Vector3().fromBufferAttribute(tangents, v).transformDirection(matrix), weight);
        }
        positions.setXYZ(v, pos.x, pos.y, pos.z); normals.setXYZ(v, normal.x, normal.y, normal.z); tangents.setXYZ(v, tangent.x, tangent.y, tangent.z);
      }
      this.geometries.push(geo);
      const rendered = new THREE.Mesh(geo, materials.material(data.get(mesh.materials[team] ?? mesh.material) ?? null));
      rendered.material.userData.noShadow = true; group.add(rendered);
    }
    return group;
  }
  private async addSpriteTrail(slot:Slot,material:string,saved?:{time:number;points:number[][]}) {
    const source=await loadParticleMaterial(material);
    const definition={name:"SourceSpriteTrail",attributes:{},children:[],functions:{renderers:[{type:"DmeParticleOperator",name:"render_rope",attributes:{functionName:"render_rope",subdivision_count:1,texel_size:96/(source.texture.image.height || 1)}}]}};
    const node=new NativeRenderNode(definition,32),draw=new ParticleRopeDraw(node,source);
    if(saved) {node.time=saved.time;for(const p of saved.points) node.particles.push({position:new THREE.Vector3(p[0],p[1],p[2]),born:p[3],life:.3,radius:3,alpha:Math.max(0,1-(node.time-p[3])/.3),color:[1,1,1],rotation:0,sequence:0,yaw:0});}
    this.trails.set(slot,{node,draw,material});this.group.add(draw.mesh);
  }
  draw(camera:THREE.Camera){for(const trail of this.trails.values()) trail.draw.update(camera);}
  shot(origin: THREE.Matrix4, direction: THREE.Vector3,charge=0,chargeSeconds=1,delay=0) {
    if(delay>0) {this.pending.push({at:this.time+delay,origin:origin.clone(),direction:direction.clone()});return;}
    const fraction=Math.min(1,charge/Math.max(.01,chargeSeconds));
    const profile={...this.profile,speed:THREE.MathUtils.lerp(this.profile.speed,this.profile.speedMax ?? this.profile.speed,fraction),gravity:THREE.MathUtils.lerp(this.profile.gravity,this.profile.gravityMin ?? this.profile.gravity,fraction)};
    if(profile.kind==="cannon") profile.lifetime=Math.max(.01,profile.lifetime-charge);
    if(profile.kind==="sticky") {const active=this.slots.filter(s=>s.motion);if(active.length>=(profile.maxActive ?? 8)) this.remove(active.reduce((a,b)=>a.motion!.age>b.motion!.age?a:b),true); }
    const slot = this.slots.find(s => !s.motion && this.time - s.stopped >= 1) ?? this.slots.reduce((old, next) => (old.motion?.age ?? Infinity) >= (next.motion?.age ?? Infinity) ? old : next);
    slot.profile=profile;slot.pulsed=slot.trailStopped=false;
    slot.motion = launchProjectile(profile, new THREE.Vector3().setFromMatrixPosition(origin), direction);
    this.trails.get(slot)?.node.particles.splice(0);
    slot.group.visible = true; slot.action = 1; this.sync(slot);
  }
  private sync(slot: Slot) {
    const motion = slot.motion; if (!motion) return;
    slot.group.position.copy(motion.position); slot.group.quaternion.copy(motion.rotation); slot.group.updateMatrix();
    // (the trail's control point has no scale: the healing bolt is drawn three times as big, its trail is not)
    slot.matrix.compose(motion.position, motion.rotation, UNIT_SCALE).multiply(this.trailAttachment);
  }
  /** Where a projectile was before this sub-step (the segment its hit test sweeps); one vector for all of them, they are tested one at a time. */
  private readonly stepStart = new THREE.Vector3();
  step(dt: number) {
    this.time += dt;
    while(this.pending.length && this.pending[0].at<=this.time+1e-9) {const throwing=this.pending.shift()!;this.shot(throwing.origin,throwing.direction);}
    for(const [slot,trail] of this.trails) {
      trail.node.time=this.time;
      if(slot.motion && !slot.motion.settled && slot.motion.age<3) {trail.node.particles.push({position:slot.motion.position.clone(),born:this.time,life:.3,radius:3,alpha:1,color:[1,1,1],rotation:0,sequence:0,yaw:0});}
      while(trail.node.particles.length && (this.time-trail.node.particles[0].born>=.3 || trail.node.particles.length>32)) trail.node.particles.shift();
      for(const p of trail.node.particles) p.alpha=Math.max(0,1-(this.time-p.born)/.3);
    }
    for (const slot of this.slots) {
      const motion = slot.motion; if (!motion) continue;
      let remaining = Math.min(dt, .1);
      while (remaining > 1e-8 && motion.active) { const h = Math.min(1 / 120, remaining); const start=this.stepStart.copy(motion.position);stepProjectile(motion, slot.profile ?? this.profile, h, this.floor,this.bounds);
        const hit=motion.settled || this.profile.kind==="sticky" ? null : this.profile.kind==="arrow" && this.interactions?.arrow ? this.interactions.arrow(start,motion.position,motion.velocity,slot.group) : this.interactions?.hit(start,motion.position) ?? null;
        if(hit){motion.position.copy(hit);motion.impactNormal=motion.velocity.clone().negate().normalize();motion.active=false;}
        remaining -= h; }
      this.sync(slot);
      if(this.profile.kind==="sticky") {
        if(motion.settled && !slot.trailStopped) {slot.action=2;slot.trailStopped=true;}
        if(motion.age>=(this.profile.armTime ?? .8) && !slot.pulsed) {slot.pulseAction=1;slot.pulsed=true;}
      }
      if (!motion.active) this.remove(slot,this.profile.kind!=="arrow" && this.profile.kind!=="syringe");
    }
  }
  detonate(origin:THREE.Vector3,direction:THREE.Vector3) {
    if(this.profile.kind!=="sticky") return;
    for(const slot of this.slots) if(slot.motion && slot.motion.age>=(this.profile.armTime ?? .8)) {
      const offset=slot.motion.position.clone().sub(origin);
      if(this.profile.detonateMode===1 && offset.length()>146 && offset.normalize().dot(direction)<.975) continue;
      this.remove(slot,true);
    }
  }
  private remove(slot:Slot,explode:boolean) {
    const motion=slot.motion;if(!motion) return;
    if(explode) {
      if(["rocket","grenade","cannon","sticky"].includes(this.profile.kind))this.interactions?.explosion(motion.position.clone(),this.profile.damageRadius ?? 146);
      else if(this.profile.kind==="jar")this.interactions?.splash?.(motion.position.clone(),this.profile.damageRadius ?? 200);
      const name=motion.impactNormal ? this.profile.impact : this.profile.impactAir;
      const impacts=(name && this.impacts.get(name)) || (this.profile.impact && this.impacts.get(this.profile.impact));
      if(impacts) {
        const impact=impacts.shift()!;impacts.push(impact);
        impact.matrix.makeRotationFromQuaternion(projectileRotation(motion.impactNormal ?? new THREE.Vector3(1,0,0))).setPosition(motion.position);impact.action=1;
      }
    }
    slot.group.visible=false;slot.motion=null;slot.action=2;slot.pulseAction=2;slot.stopped=this.time;
  }
  snapshot() {
    return this.slots.filter(s => s.motion && s.group.visible && s.model).map(s => ({ model: s.model, team: s.team, matrix: s.group.matrix.toArray(), age: s.motion!.age,...(this.trails.has(s) ? {trail:{material:this.trails.get(s)!.material,time:this.trails.get(s)!.node.time,points:this.trails.get(s)!.node.particles.map(p=>[...p.position.toArray(),p.born])}} : {}) }));
  }
  static async restore(saved: NonNullable<WeaponParticleSnapshot["projectiles"]>, load: ShellLoader, materials: SourceMaterials) {
    const result = new WeaponProjectiles({ kind: "rocket", model: "", trail: "", speed: 0, gravity: 0, lifetime: 0, spin: false, team: 0 }, 0);
    const templates = new Map<string, THREE.Group>();
    try {
      for (const item of saved) {
        const key = `${item.model}:${item.team}`;
        let template = templates.get(key); if (!template) { template = await result.model(item.model, item.team, load, materials); templates.set(key, template); }
        delete template.userData.rig;
        const group = template.clone(); new THREE.Matrix4().fromArray(item.matrix).decompose(group.position, group.quaternion, group.scale);
        group.updateMatrix();
        result.group.add(group);
        result.slots.push({ group, matrix: new THREE.Matrix4(), action: 0, stopped: 0, model: item.model, team: item.team, motion: { position: group.position.clone(), rotation: group.quaternion.clone(), velocity: new THREE.Vector3(), angular: new THREE.Vector3(), age: item.age, active: true } });
        if(item.trail) await result.addSpriteTrail(result.slots[result.slots.length-1],item.trail.material,item.trail);
      }
      return result;
    } catch (error) { result.dispose(); throw error; }
  }
  dispose() {for(const trail of this.trails.values()) trail.draw.dispose(); this.group.removeFromParent(); for (const geo of this.geometries) geo.dispose(); }
}
