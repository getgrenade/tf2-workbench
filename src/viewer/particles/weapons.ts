import * as THREE from "three";
import { particleSystemFile, type WeaponProfile } from "../../api";
import type { Actor } from "../actor";
import { SOURCE_TO_VIEWER, Rig } from "../animator";
import { buildGeometry } from "../geometryCache";
import type { ModelData, MaterialData } from "../payload";
import type { SourceMaterials } from "../sourceMaterials";
import { loadDefinitions, loadParticleMaterial, loadParticleModel, type ParticleModelInfo } from "./assets";
import { NativeSimulation, NativeRenderNode } from "./native";
import type { WeaponParticleSnapshot } from "./weaponSnapshot";
import { ParticleDraw } from "./render";
import { ParticleRopeDraw } from "./rope";

import { WeaponProjectiles,type ProjectileInteractions } from "./projectiles";

type Draw = ParticleDraw | ParticleRopeDraw;
export type ShellLoader = (path: string) => Promise<{ model: ModelData; materials: Map<string, MaterialData | null> }>;
const TO_SOURCE = SOURCE_TO_VIEWER.clone().invert();
interface Shell { model?:string; group: THREE.Group; velocity: THREE.Vector3; angular: THREE.Vector3; age: number; settled: boolean; fading: THREE.ShaderMaterial[] }

export class WeaponEffects {
  readonly group = new THREE.Group();
  private projectiles: WeaponProjectiles | null = null;
  private readonly muzzleSims: NativeSimulation[] = [];
  private readonly chargeSims:NativeSimulation[]=[];
  private readonly sims: NativeSimulation[] = [];
  private readonly draws: Draw[] = [];
  private readonly shells: Shell[] = [];
  private template: THREE.Group | null = null;
  private accumulated = 0;
  private firing = false;
  private time = 0;
  private readonly pendingShells: number[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private disposed = false;
  private frozen = false;
  private shellModel = "";
  private healingTarget:THREE.Vector3|null=null;
  private healingSim:NativeSimulation|null=null;
  private readonly nodes: { file:string; node:NativeRenderNode }[] = [];
  get isFrozen() {return this.frozen;}
  private constructor(private actor: Actor, readonly profile: WeaponProfile | null, private modelPath: string,
    private attachments: ParticleModelInfo, private floor: number) { this.group.matrixAutoUpdate = false; this.group.name = "Weapon firing effects"; }

  static async create(actor: Actor, profile: WeaponProfile, loadShell: ShellLoader, materials: SourceMaterials, floor: number,bounds?:THREE.Box3,interactions?:ProjectileInteractions): Promise<WeaponEffects> {
    const weapon = actor.particleCosmetic(profile.itemId);
    if (!weapon) throw new Error("Weapon model is not equipped yet");
    const attachments = await loadParticleModel(weapon.path);
    const effect = new WeaponEffects(actor,profile,weapon.path,attachments,floor);
    try {
      for (const [system, anchor] of [[profile.muzzle,"muzzle"], [profile.weaponClass === "tf_weapon_minigun" ? "eject_minigunbrass" : "","eject_brass"]]) {
        if (!system || !attachments.attachments.some(a=>a.name.toLowerCase()===anchor)) continue;
        const file = await particleSystemFile(system), definitions = await loadDefinitions(file);
        const sim = await NativeSimulation.create(definitions,()=>effect.attachment(anchor) ?? new THREE.Matrix4(),console.error,file,system,()=>[],0,profile.flame,profile.colors);
        if (!sim) throw new Error("Native particle helper is required for firing effects");
        effect.sims.push(sim); effect.muzzleSims.push(sim); sim.emission(2);
        for (const node of sim.walk()) {effect.nodes.push({file,node});await effect.addDraws(node);}
      }
      if (profile.brass && !profile.continuous && effect.attachment("eject_brass")) {
        await effect.loadShellTemplate(profile.brass,loadShell,materials);
      }
      effect.projectiles = await WeaponProjectiles.create(profile,loadShell,materials,floor,async (sim,file) => {
        effect.sims.push(sim);
        for (const node of sim.walk()) {effect.nodes.push({file,node});await effect.addDraws(node);}
      },bounds,interactions);
      if(effect.projectiles) effect.group.add(effect.projectiles.group);
      if(profile.weaponClass==="tf_weapon_cannon") {
        for(const [system,anchor] of [["loose_cannon_sparks","cannon_fuse"],["loose_cannon_buildup_smoke3","muzzle"]]) {
          if(!effect.attachment(anchor)) continue;
          const file=await particleSystemFile(system);
          const sim=await NativeSimulation.create(await loadDefinitions(file),()=>effect.attachment(anchor) ?? new THREE.Matrix4(),console.error,file,system);
          if(!sim) throw new Error("Native helper is required for cannon charge effects");
          effect.sims.push(sim);effect.chargeSims.push(sim);sim.emission(2);
          for(const node of sim.walk()) {effect.nodes.push({file,node});await effect.addDraws(node);}
        }
      }
      if(profile.healing) {
        const system=profile.healing.system,file=await particleSystemFile(system);
        const sim=await NativeSimulation.create(await loadDefinitions(file),()=>effect.attachment("muzzle") ?? new THREE.Matrix4(),console.error,file,system,()=>[],0,[],[],1,()=>[],()=>effect.healingTarget?.toArray() ?? []);
        if(!sim) throw new Error("Native helper is required for healing beams");effect.healingSim=sim;effect.sims.push(sim);sim.emission(2);
        for(const node of sim.walk()) {effect.nodes.push({file,node});await effect.addDraws(node);}
      }
      actor.attachWorldParticles(effect.group); return effect;
    } catch(error) { effect.dispose(); throw error; }
  }

  private async addDraws(node:NativeRenderNode) {
    for (const [index,renderer] of node.definition.functions.renderers.entries()) {
      const name=renderer.attributes.functionName;
      if(name==="render_screen_velocity_rotate") continue;
      if(!["render_rope","render_animated_sprites","render_sprite_trail"].includes(String(name))) throw new Error(`Unsupported weapon particle renderer: ${name}`);
      const source=await loadParticleMaterial(String(node.definition.attributes.material));
      const draw=name==="render_rope" ? new ParticleRopeDraw(node,source,index) : new ParticleDraw(node,source,index);
      this.draws.push(draw);this.group.add(draw.mesh);
    }
  }

  private async loadShellTemplate(path:string,loadShell:ShellLoader,materials:SourceMaterials) {
        this.shellModel=path;
        const { model, materials: data } = await loadShell(path);
        this.template = new THREE.Group(); const rig = new Rig(model.bones);
        for (const part of model.bodyParts) for (const mesh of part.models[0]?.meshes ?? []) {
          if (!mesh.indices.length) continue;
          const geo = buildGeometry(mesh,true).geo;
          // Shell MDLs use Source bind vertices; bake the bind skin once, shared by every casing.
          const positions = geo.getAttribute("position"), normals = geo.getAttribute("normal");
          const skin = model.bones.map((_,i)=>rig.bindWorld[i].clone().multiply(rig.poseToBone[i]));
          for (let v=0;v<positions.count;v++) { const pos = new THREE.Vector3(), norm = new THREE.Vector3();
            for (let k=0;k<4;k++) { const w=mesh.skinWeights[v*4+k]; if (!w) continue; const matrix=skin[mesh.skinIndices[v*4+k]];
              pos.addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,v).applyMatrix4(matrix),w);
              norm.addScaledVector(new THREE.Vector3().fromBufferAttribute(normals,v).transformDirection(matrix),w);
            } positions.setXYZ(v,pos.x,pos.y,pos.z); normals.setXYZ(v,norm.x,norm.y,norm.z);
          }
          this.geometries.push(geo); this.template.add(new THREE.Mesh(geo,materials.material(data.get(mesh.material) ?? null)));
        }
  }

  freeze() {
    this.frozen=true;this.pendingShells.length=0;
    // Disposing the bridge also rejects any later IPC frame: rendered state stays exact.
    for(const sim of this.sims) sim.dispose();
  }
  snapshot(): WeaponParticleSnapshot | undefined {
    const nodes=this.nodes.filter(({node})=>node.particles.length).map(({file,node})=>({file,name:node.definition.name,time:node.time,dt:node.stepTime,
      particles:node.particles.map(p=>[...p.position.toArray(),...p.color,p.alpha,p.radius,p.rotation,p.born,p.life,p.sequence,p.yaw,
        ...(p.previous ?? p.position).toArray(),p.trailLength ?? 0])}));
    const projectiles=this.projectiles?.snapshot() ?? [];
    if(!nodes.length && !this.shells.length && !projectiles.length) return;
    return {nodes,projectiles,shellModel:this.shellModel,shells:this.shells.map(s=>{s.group.updateMatrix();return {matrix:s.group.matrix.toArray(),age:s.age,...(s.model ? {model:s.model} : {})};})};
  }
  static async restore(actor:Actor,snapshot:WeaponParticleSnapshot,loadShell:ShellLoader,materials:SourceMaterials):Promise<WeaponEffects> {
    const effect=new WeaponEffects(actor,null,"",{attachments:[],hitboxes:[]},0);effect.frozen=true;
    try {
      for(const saved of snapshot.nodes) {
        const definitions=await loadDefinitions(saved.file),definition=definitions.get(saved.name);
        if(!definition) throw new Error(`Saved weapon particle definition missing: ${saved.name}`);
        const node=new NativeRenderNode(definition,Math.max(2,saved.particles.length));
        node.apply({id:0,name:saved.name,capacity:node.capacity,time:saved.time,dt:saved.dt,particles:saved.particles});
        effect.nodes.push({file:saved.file,node});await effect.addDraws(node);
      }
      if(snapshot.shells.length) {
        await effect.loadShellTemplate(snapshot.shellModel,loadShell,materials);
        for(const saved of snapshot.shells) {
          if(saved.model && saved.model!==effect.shellModel) await effect.loadShellTemplate(saved.model,loadShell,materials);
          const group=effect.template!.clone();new THREE.Matrix4().fromArray(saved.matrix).decompose(group.position,group.quaternion,group.scale);
          const shell:Shell={group,model:saved.model,age:saved.age,velocity:new THREE.Vector3(),angular:new THREE.Vector3(),settled:true,fading:[]};
          effect.shells.push(shell);effect.group.add(group);effect.fadeShell(shell);
        }
      }
      if(snapshot.projectiles?.length) {
        effect.projectiles=await WeaponProjectiles.restore(snapshot.projectiles,loadShell,materials);
        effect.group.add(effect.projectiles.group);
      }
      actor.attachWorldParticles(effect.group);return effect;
    } catch(error) {effect.dispose();throw error;}
  }

  private attachment(name: string): THREE.Matrix4 | null {
    if(!this.profile) return null;
    const att = this.attachments.attachments.find(a=>a.name.toLowerCase()===name);
    const bone = att && this.actor.particleCosmeticBoneFrame(this.profile.itemId,this.modelPath,att.bone);
    return bone && att ? TO_SOURCE.clone().multiply(this.actor.particleRootFrame()).multiply(bone).multiply(att.local) : null;
  }
  shot(direction?:THREE.Vector3,charge=0) {
    if (this.disposed || this.frozen || !this.profile) return;
    if (!this.profile.continuous) for (const sim of this.muzzleSims) sim.emission(1);
    const thrown=this.profile.throwable;
    const origin=this.attachment("muzzle") ?? (thrown && direction ? this.throwOrigin(direction) : null);
    if(origin && this.projectiles) this.projectiles.shot(origin,direction ?? new THREE.Vector3().setFromMatrixColumn(origin,0),charge,this.profile.charge?.seconds,thrown?.delay ?? 0);
    if (this.template) for (const delay of this.profile.ejectTimes.length ? this.profile.ejectTimes : [0]) this.pendingShells.push(this.time+delay);
  }
  /** Where a thrown jar starts (CTFJar::TossJarThink): the eye, 16 units ahead, 8 to the right and 6 below. */
  private throwOrigin(direction:THREE.Vector3) {
    const root=TO_SOURCE.clone().multiply(this.actor.particleRootFrame()),eye=this.actor.eyeFrame() ?? new THREE.Matrix4().makeTranslation(0,0,68);
    const forward=direction.clone().normalize(),right=new THREE.Vector3(forward.y,-forward.x,0).normalize(),up=right.clone().cross(forward).normalize();
    const position=new THREE.Vector3().setFromMatrixPosition(root.multiply(eye)).addScaledVector(forward,16).addScaledVector(right,8).addScaledVector(up,-6);
    return new THREE.Matrix4().makeTranslation(position.x,position.y,position.z);
  }
  get muzzlePosition(){const matrix=this.attachment("muzzle");return matrix ? new THREE.Vector3().setFromMatrixPosition(matrix) : null;}
  setHealingTarget(target:THREE.Vector3|null) {
    const changed=!!target!==!!this.healingTarget;this.healingTarget=target;
    if(changed) this.healingSim?.emission(target ? 3 : 2);
  }
  detonate(direction:THREE.Vector3) {const origin=this.attachment("muzzle");this.projectiles?.detonate(origin ? new THREE.Vector3().setFromMatrixPosition(origin) : new THREE.Vector3().setFromMatrixPosition(this.actor.particleRootFrame()).applyMatrix4(TO_SOURCE),direction);}
  setFiring(firing: boolean) {
    if(!firing) this.setHealingTarget(null);
    if ((!this.profile?.continuous && !this.chargeSims.length) || this.firing===firing || this.disposed || this.frozen) return;
    this.firing=firing; for (const sim of this.profile?.continuous ? this.muzzleSims : this.chargeSims) sim.emission(firing ? 3 : 2);
  }
  private eject() {
    const matrix=this.attachment("eject_brass"); if (!matrix || !this.template) return;
    if (this.shells.length>=96) this.removeShell(this.shells.shift()!);
    const group=this.template.clone(), e=matrix.elements;
    group.position.setFromMatrixPosition(matrix);
    const forward=new THREE.Vector3(e[0],e[1],e[2]),right=new THREE.Vector3(-e[4],-e[5],-e[6]),up=new THREE.Vector3(e[8],e[9],e[10]);
    const direction=up.clone().negate();
    group.rotation.set(0,Math.atan2(-direction.z,Math.hypot(direction.x,direction.y)),Math.atan2(direction.y,direction.x),"ZYX");
    const random=(a:number,b:number)=>THREE.MathUtils.lerp(a,b,Math.random());
    const velocity=forward.multiplyScalar(random(130,180)).addScaledVector(right,random(-30,30)).addScaledVector(up,random(-30,30));
    const angular=new THREE.Vector3(random(-512,511),random(-255,255),random(-255,255)).multiplyScalar(Math.PI/180);
    this.shells.push({model:this.shellModel,group,velocity,angular,age:0,settled:false,fading:[]}); this.group.add(group);
  }
  private removeShell(shell: Shell) {shell.group.removeFromParent();for(const material of shell.fading) material.dispose();}
  private fadeShell(s:Shell) {
    if(s.age<10) return;
    if(!s.fading.length) s.group.traverse(object=> {if(object instanceof THREE.Mesh) {
      const material=(object.material as THREE.ShaderMaterial).clone(); material.transparent=true;material.depthWrite=false;object.material=material;s.fading.push(material);
    }});
    for(const material of s.fading) material.uniforms.uOpacity.value=Math.max(0,1-(s.age-10)*.5);
  }
  step(dt:number,camera:THREE.Camera) {
    if (this.disposed) return;
    this.actor.attachWorldParticles(this.group);
    if(this.frozen) {this.group.updateWorldMatrix(true,true);for(const draw of this.draws) draw.update(camera);this.projectiles?.draw(camera);return;}
    this.time+=dt;
    for (let i=this.pendingShells.length-1;i>=0;i--) if (this.pendingShells[i]<=this.time) { this.pendingShells.splice(i,1); this.eject(); }
    this.accumulated+=Math.min(dt,.1);
    while (this.accumulated>=1/60) { this.projectiles?.step(1/60); for(const sim of this.sims) sim.step(1/60); this.accumulated-=1/60; }
    for(let i=this.shells.length-1;i>=0;i--) { const s=this.shells[i]; s.age+=dt;
      if(s.age>=12) {this.removeShell(s);this.shells.splice(i,1);continue;}
      this.fadeShell(s);
      if(!s.settled) {s.group.position.addScaledVector(s.velocity,dt);s.velocity.z-=320*dt;
        s.group.rotation.x+=s.angular.z*dt;s.group.rotation.y+=s.angular.x*dt;s.group.rotation.z+=s.angular.y*dt;
        if(s.group.position.z<this.floor) {s.group.position.z=this.floor;
          if(s.velocity.z>=-320*dt*3) {s.settled=true;s.group.rotation.x=s.group.rotation.y=0;} else {s.velocity.z=-s.velocity.z*.5;s.velocity.x*=.5;s.velocity.y*=.5;}
        }
      }
    }
    this.group.updateWorldMatrix(true,true);for(const draw of this.draws) draw.update(camera);this.projectiles?.draw(camera);
  }
  get needsSceneDepth() {return this.draws.some(d=>d instanceof ParticleDraw && d.needsSceneDepth);}
  get needsSceneColor() {return this.draws.some(d=>d instanceof ParticleDraw && d.needsSceneColor);}
  setSceneDepth(texture:THREE.Texture|null,camera:THREE.Camera,width:number,height:number,color:THREE.Texture|null=null) {for(const draw of this.draws) if(draw instanceof ParticleDraw) draw.setSceneDepth(texture,camera,width,height,color);}
  dispose() {this.disposed=true;this.projectiles?.dispose();for(const sim of this.sims) sim.dispose();for(const draw of this.draws) draw.dispose();for(const shell of this.shells) this.removeShell(shell);for(const geo of this.geometries) geo.dispose();this.group.removeFromParent();}
}
