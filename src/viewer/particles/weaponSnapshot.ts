/** Render state only: no native process, emitters, timers or copied game assets. */
export interface WeaponParticleSnapshot {
  nodes: { file: string; name: string; time: number; dt: number; particles: number[][] }[];
  shellModel: string;
  projectiles?: { model: string; team: number; matrix: number[]; age: number; trail?:{material:string;time:number;points:number[][]} }[];
  shells: { matrix: number[]; age: number; model?:string }[];
}

export function parseWeaponSnapshot(value: unknown): WeaponParticleSnapshot | undefined {
  const v = value as WeaponParticleSnapshot | null;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!v || !Array.isArray(v.nodes) || v.nodes.length > 1024 || !Array.isArray(v.shells) || v.shells.length > 384) return;
  let count = 0;
  for (const n of v.nodes) {
    if (!n || typeof n.file !== "string" || !/^particles\/[\w/-]+\.pcf$/.test(n.file) || n.file.includes("..") ||
      typeof n.name !== "string" || n.name.length > 256 || !finite(n.time) || !finite(n.dt) || n.dt <= 0 ||
      !Array.isArray(n.particles) || n.particles.length > 5000) return;
    count += n.particles.length;
    if (count > 100000 || n.particles.some(p => !Array.isArray(p) || p.length !== 17 || !p.every(finite))) return;
  }
  if (typeof v.shellModel !== "string" || (v.shells.length && !/^models\/[\w/-]+\.mdl$/.test(v.shellModel))) return;
  if (v.shells.some(s => !s || !Array.isArray(s.matrix) || s.matrix.length !== 16 || !s.matrix.every(finite) || !finite(s.age) || s.age < 0 || (s.model!==undefined && !/^models\/[\w/-]+\.mdl$/.test(s.model)))) return;
  if (v.projectiles !== undefined && (!Array.isArray(v.projectiles) || v.projectiles.length > 128 || v.projectiles.some(p => !p ||
    typeof p.model !== "string" || !/^models\/[\w/-]+\.mdl$/.test(p.model) || ![0,1].includes(p.team) ||
    !Array.isArray(p.matrix) || p.matrix.length !== 16 || !p.matrix.every(finite) || !finite(p.age) || p.age < 0 || (p.trail!==undefined && (!p.trail || typeof p.trail.material!=="string" || !/^(materials\/)?effects\/[\w/-]+\.vmt$/.test(p.trail.material) || !finite(p.trail.time) || !Array.isArray(p.trail.points) || p.trail.points.length>32 || p.trail.points.some(v=>!Array.isArray(v)||v.length!==4||!v.every(finite))))))) return;
  if (!count && !v.shells.length && !v.projectiles?.length) return;
  // Own all arrays: open scene tabs must not share mutable render data.
  return { nodes: v.nodes.map(n => ({...n,particles:n.particles.map(p=>p.slice())})), shellModel:v.shellModel,
    shells:v.shells.map(s=>({...s,matrix:s.matrix.slice()})),
    ...(v.projectiles ? {projectiles:v.projectiles.map(p=>({...p,matrix:p.matrix.slice(),...(p.trail ? {trail:{...p.trail,points:p.trail.points.map(v=>v.slice())}} : {})}))} : {}) };
}
