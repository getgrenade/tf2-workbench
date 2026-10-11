import test from "node:test";
import assert from "node:assert/strict";
import { WeaponCycle } from "../src/viewer/weaponCycle.ts";
const profile={itemId:199,weaponClass:"tf_weapon_shotgun",clipSize:6,reserve:32,ammoPerShot:1,fireDelay:.625,
  reloadSingly:true,reloadStart:.333,reloadTime:.5,reloadEnd:.3,muzzle:"muzzle_shotgun",brass:"",ejectTimes:[],continuous:false};

test("flamethrower accumulates fractional ticks into 14 whole ammo per second",()=>{
  const w=new WeaponCycle({...profile,clipSize:-1,reserve:200,fireDelay:.02,ammoPerShot:.28,continuous:true});
  for(let i=0;i<50;i++) w.step(.02,true);
  assert.equal(w.reserve,186);assert.equal(w.ammoText,"186");
  const remaining=w.reserve;w.step(.02,false);assert.equal(w.reserve,remaining);
});
test("held fire consumes one shell per shot and reload fills only missing shells",()=>{
  const w=new WeaponCycle(profile);let shots=0;
  for(let i=0;i<144;i++) shots+=w.step(1/60,true).filter(e=>e.type==="shot").length;
  assert.equal(shots,4);assert.equal(w.clip,2);assert.equal(w.reserve,32);
  w.reload();let inserts=0;
  for(let i=0;i<200;i++) inserts+=w.step(1/60,false).filter(e=>e.phase==="insert").length;
  assert.equal(inserts,4);assert.equal(w.clip,6);assert.equal(w.reserve,28);assert.equal(w.phase,null);
});
test("a single-shell reload can be interrupted by firing an inserted shell",()=>{
  const w=new WeaponCycle(profile);w.clip=0;w.reload();
  for(let i=0;i<52;i++) w.step(1/60,false);
  assert.equal(w.clip,1);assert.equal(w.step(1/60,true).filter(e=>e.type==="shot").length,1);
  assert.equal(w.clip,0);assert.equal(w.phase,null);
});
test("magazine reload completes as one operation and preserves reserve exhaustion",()=>{
  const w=new WeaponCycle({...profile,clipSize:12,reloadSingly:false,reloadTime:1});w.clip=4;w.reserve=3;w.reload();
  for(let i=0;i<59;i++) assert.ok(!w.step(1/60,true).some(e=>e.type==="shot"));
  w.step(.02,false);assert.equal(w.clip,7);assert.equal(w.reserve,0);assert.equal(w.phase,null);
  w.reload();assert.equal(w.phase,null);
});
test("minigun uses finite reserve without a magazine; cancelled reload keeps inserted ammo",()=>{
  const w=new WeaponCycle({...profile,clipSize:-1,reserve:3,fireDelay:.1,continuous:true});
  let shots=0;for(let i=0;i<60;i++) shots+=w.step(1/60,true).filter(e=>e.type==="shot").length;
  assert.equal(shots,3);assert.equal(w.reserve,0);assert.equal(w.hasAmmo,false);w.reload();assert.equal(w.phase,null);
  const shell=new WeaponCycle(profile);shell.clip=2;shell.reload();for(let i=0;i<52;i++)shell.step(1/60,false);
  shell.cancel();assert.equal(shell.clip,3);assert.equal(shell.reserve,31);assert.equal(shell.phase,null);
});


test("charge weapons fire on release; cancellation suppresses fire until a fresh press",()=>{
  const w=new WeaponCycle({...profile,charge:{seconds:1,autoRelease:false,cook:false}});
  assert.equal(w.step(.4,true).length,0);assert.equal(w.clip,6);
  const release=w.step(0,false);assert.equal(release[0].type,"shot");assert.equal(release[0].charge,.4);
  w.step(1,false);w.step(.3,true);w.cancelCharge();
  assert.equal(w.step(.5,true).length,0);assert.equal(w.step(0,false).length,0);
  w.step(.2,true);assert.equal(w.step(0,false)[0].charge,.2);
});
test("sticky full charge and cooked cannon automatically release at their source duration",()=>{
  for(const cook of [false,true]) {
    const w=new WeaponCycle({...profile,charge:{seconds:1,autoRelease:true,cook}});
    assert.equal(w.step(.5,true).length,0);
    const events=w.step(.5,true);assert.equal(events[0].charge,1);assert.equal(w.clip,5);
  }
});
const bowProfile={...profile,itemId:56,weaponClass:"tf_weapon_compound_bow",clipSize:1,reserve:12,fireDelay:.5,reloadSingly:false,reloadStart:0,reloadTime:1,reloadEnd:0,
  charge:{seconds:1,autoRelease:false,cook:false},ammoEvent:1.03};
test("the bow has no reload: the fire animation loads the next arrow, and it cannot be drawn before that",()=>{
  const w=new WeaponCycle(bowProfile);let reloads=0,shots=0;
  const run=(seconds:number,attack:boolean)=>{for(let t=0;t<seconds-1e-9;t+=1/60){const events=w.step(1/60,attack);reloads+=events.filter(e=>e.type==="reload").length;shots+=events.filter(e=>e.type==="shot").length;}};
  run(1.2,true);assert.equal(shots,0,"drawing");assert.ok(w.chargeTime!==null);
  run(1/60,false);assert.equal(shots,1,"released: the arrow flies");assert.equal(w.clip,0);assert.equal(w.reserve,12);
  run(1.0,false);assert.equal(w.clip,0,"the animation has not reached its event yet");
  run(.01,true);assert.equal(w.chargeTime,null,"no arrow to draw yet");
  run(.1,false);assert.equal(w.clip,1,"the event moved an arrow from the reserve into the clip");assert.equal(w.reserve,11);
  assert.equal(reloads,0,"and no reload phase or gesture happened");
  w.reload();assert.equal(w.phase,null,"R does nothing");run(.1,true);assert.ok(w.chargeTime!==null,"ready to draw again");
});
test("the bow's ammo event is not lost when the weapon is put away, and an empty reserve leaves it empty",()=>{
  const w=new WeaponCycle(bowProfile);w.step(1/60,true);for(let i=0;i<70;i++)w.step(1/60,true);w.step(1/60,false);
  assert.equal(w.clip,0);w.cancel();assert.equal(w.clip,1,"switching away completes the pending event");assert.equal(w.reserve,11);
  const empty=new WeaponCycle({...bowProfile,reserve:0});empty.clip=0;for(let i=0;i<200;i++)empty.step(1/60,true);
  assert.equal(empty.clip,0);assert.equal(empty.hasAmmo,false);
});
test("a weapon with an ordinary reload still reloads",()=>{
  const w=new WeaponCycle({...profile,clipSize:12,reloadSingly:false,reloadTime:1,ammoEvent:null});w.clip=2;w.reload();assert.equal(w.phase,"magazine");
});
const jarProfile={...profile,itemId:58,weaponClass:"tf_weapon_jar",clipSize:-1,reserve:1,ammoPerShot:1,fireDelay:.8,throwable:{recharge:20.1,delay:.1}};
test("a thrown weapon leaves the hand and comes back only when the effect bar has refilled",()=>{
  const w=new WeaponCycle(jarProfile);let shots=0;
  const run=(seconds:number,attack:boolean)=>{for(let t=0;t<seconds-1e-9;t+=1/60)shots+=w.step(1/60,attack).filter(e=>e.type==="shot").length;};
  assert.equal(w.hasAmmo,true);run(1/60,true);assert.equal(shots,1);assert.equal(w.hasAmmo,false);
  run(19,true);assert.equal(shots,1,"still recharging");assert.equal(w.ammoText,"2s");
  run(1.5,true);assert.equal(shots,2,"back after 20.1 seconds, and thrown again");
});

test("with infinite ammunition a magazine still empties and reloads, but the reserve never runs down", () => {
  const w = new WeaponCycle({ ...profile, clipSize: 12, reserve: 24, reloadSingly: false, reloadTime: 1, fireDelay: .1 }, true);
  let shots = 0;
  for (let i = 0; i < 300; i++) shots += w.step(1 / 60, true).filter((e) => e.type === "shot").length;
  assert.ok(shots > 24, "far more shots than the reserve could give: " + shots);
  assert.equal(w.reserve, 24, "the reserve is where it started");
  // the rules of reloading stay: an empty magazine cannot fire until it has been reloaded
  const empty = new WeaponCycle({ ...profile, clipSize: 2, reserve: 4, reloadSingly: false, reloadTime: 1, fireDelay: .1 }, true);
  let fired = 0;
  for (let i = 0; i < 30; i++) fired += empty.step(1 / 60, true).filter((e) => e.type === "shot").length;
  assert.equal(fired, 2, "two rounds, then the reload runs");
  assert.equal(empty.hasAmmo, false);
  assert.equal(empty.phase, "magazine");
  for (let i = 0; i < 70; i++) empty.step(1 / 60, false);
  assert.equal(empty.clip, 2);
  assert.equal(empty.reserve, 4);
});
test("with infinite ammunition a flamethrower never runs dry, and the status line shows no ammunition", () => {
  const w = new WeaponCycle({ ...profile, clipSize: -1, reserve: 200, fireDelay: .02, ammoPerShot: .28, continuous: true }, true);
  for (let i = 0; i < 2000; i++) w.step(.02, true);
  assert.equal(w.reserve, 200);
  assert.equal(w.hasAmmo, true);
  assert.equal(w.statusText, "");
  const jar = new WeaponCycle({ ...profile, clipSize: -1, reserve: 1, throwable: { recharge: 20 } } as never, true);
  jar.step(.02, true);
  assert.equal(jar.statusText, "20s", "the time until a thrown weapon is back is still worth showing");
});
