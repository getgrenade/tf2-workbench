import test from "node:test";
import assert from "node:assert/strict";
import {PlayController,type PlayHost} from "../../src/viewer/play";
import {PLAY_DAMAGE_ACTIONS} from "../../src/viewer/playLogic";
function fixture(){let dead=false;const damage:string[]=[],gestures:string[]=[];let placed=0,ended=0;
  const host={actor:{offset:{x:0,y:0,z:0},yaw:0,setPlacement:()=>placed++,endLive:()=>ended++},anim:{info:{sequences:[],poseParams:[]}},gameClass:"scout",weaponSets:()=>[],heldSlot:()=>"primary",slots:()=>[],onFiring:()=>{},isDamaged:()=>dead,onDamage:(action:string)=>damage.push(action)} as unknown as PlayHost;
  const play=new PlayController(host) as any;play.running=true;play.animate=(action:string)=>gestures.push(action);
  return {play,host,damage,gestures,dead:(value:boolean)=>dead=value,placed:()=>placed,ended:()=>ended};
}