import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ButtonPumpLink, SETTINGS, doseMilliseconds, doseVolume, settingsPacket, readSettings} from '../pump/button-link.mjs';
import {COMMAND, STATUS} from '../game/ble.mjs';

const reply = ms => { const p = settingsPacket(ms); p[0]=1; return new DataView(p.buffer); };
const tick = () => new Promise(r=>setTimeout(r,0));
function fixture({saved=0, legacy=false, reject=false}={}) {
  const state = new EventTarget();
  state.value=new DataView(Uint8Array.of(0).buffer);
  state.readValue=async()=>state.value;
  state.startNotifications=async()=>state;
  state.notify=n=>{state.value.setUint8(0,n);state.dispatchEvent(new Event('characteristicvaluechanged'));};
  const config={readValue:async()=>reply(saved)};
  const packets=[];
  const command={writeValueWithResponse:async bytes=>{
    packets.push([...bytes]);
    if(bytes[0]===0)state.notify(0);
    if(bytes[0]===4)state.notify(1);
    if(bytes[0]===5 && !reject && state.value.getUint8(0)===0) saved=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(1,true);
  }};
  const device=new EventTarget();
  device.gatt={connected:false,async connect(){this.connected=true;return this;},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));},async getPrimaryService(){return {getCharacteristic:async id=>{
    if(id===COMMAND)return command;if(id===STATUS)return state;
    assert.equal(id,SETTINGS);if(legacy)throw new DOMException('missing','NotFoundError');return config;
  }};}};
  const link=new ButtonPumpLink({requestDevice:async()=>device});
  return {link,state,config,command,device,packets};
}
test('mL conversion preserves the existing estimated 90 mL/min and bounds',()=>{
  for(const [ml,ms] of [[.15,100],[.3,200],[1.5,1000],[3,2000],[90,60000]]){
    assert.equal(doseMilliseconds(ml),ms);assert.ok(Math.abs(doseVolume(ms)-ml)<1e-10);
  }
  for(const ml of [0,.149,90.1,NaN,Infinity,'1',null])assert.throws(()=>doseMilliseconds(ml));
  for(const ms of [-1,1,99,60001,NaN,1.5])assert.throws(()=>settingsPacket(ms));
  assert.deepEqual([...settingsPacket(2000)],[5,208,7,0,0]);
  assert.equal(readSettings(reply(0)),0);
  assert.throws(()=>readSettings(new DataView(Uint8Array.of(1).buffer)));
  const wrong=reply(100);wrong.setUint8(0,2);assert.throws(()=>readSettings(wrong));
});
test('connection reads the Arduino without saving or starting; saved dose survives reconnect',async()=>{
  const f=fixture({saved:2000}); await f.link.connect();
  assert.equal(f.link.buttonMs,2000);assert.deepEqual(f.packets,[[0]]);
  await f.link.disconnect();await f.link.connect();
  assert.equal(f.link.buttonMs,2000);assert.ok(f.packets.every(p=>p[0]===0));f.link.drop('');
});
test('first-use and disabled button cannot dispense',async()=>{
  const f=fixture();await f.link.connect();await f.link.give();
  assert.equal(f.link.buttonMs,0);assert.deepEqual(f.packets,[[0]]);f.link.drop('');
});
test('saving validates, reads back, never starts, and gives one dose using saved mL',async()=>{
  const f=fixture();await f.link.connect();
  await assert.rejects(()=>f.link.saveDose(-1));assert.deepEqual(f.packets,[[0]]);
  assert.equal(await f.link.saveDose(1.5),true);assert.equal(f.link.buttonMs,1000);
  assert.deepEqual(f.packets,[[0],[5,232,3,0,0]]);
  await Promise.all([f.link.give(),f.link.give(),f.link.give()]);
  assert.deepEqual(f.packets.at(-1),[4,232,3,0,0]);assert.equal(f.packets.filter(p=>p[0]===4).length,1);
  assert.equal(await f.link.saveDose(3),false); // Cannot change a running dose.
  f.state.notify(0);assert.equal(await f.link.saveDose(0,false),true);await f.link.give();
  assert.equal(f.packets.filter(p=>p[0]===4).length,1);f.link.drop('');
});
test('unaccepted configuration cannot be reported as saved',async()=>{
  const f=fixture({saved:200,reject:true});await f.link.connect();
  assert.equal(await f.link.saveDose(3),false);assert.equal(f.link.buttonMs,200);
  assert.match(f.link.message,/not accepted/);f.link.drop('');
});
test('save is serialized; clicks during save do not queue juice',async()=>{
  const f=fixture({saved:200});await f.link.connect();let release;
  const original=f.command.writeValueWithResponse;
  f.command.writeValueWithResponse=async bytes=>{await new Promise(r=>release=r);await original(bytes);};
  const save=f.link.saveDose(3);await tick();await f.link.give();
  assert.equal(await f.link.saveDose(6),false);release();assert.equal(await save,true);
  assert.ok(f.packets.every(p=>p[0]!==4));assert.equal(f.link.buttonMs,2000);f.link.drop('');
});
test('lost connection after save does not show a successful save or reuse stale settings',async()=>{
  const f=fixture({saved:200});await f.link.connect();let release;
  f.config.readValue=async()=>{await new Promise(r=>release=r);return reply(2000);};
  const save=f.link.saveDose(3);await tick();f.device.gatt.disconnect();release();
  assert.equal(await save,false);assert.equal(f.link.buttonMs,null);assert.equal(f.link.phase,'offline');
});
test('older firmware requires upload and cannot start via the new page',async()=>{
  const f=fixture({legacy:true});await f.link.connect();await f.link.give();
  assert.match(f.link.message,/Upload the button firmware/);assert.equal(f.link.buttonMs,null);
  assert.equal(await f.link.saveDose(3),false);assert.deepEqual(f.packets,[[0]]);f.link.drop('');
});
test('physical-button notifications update the page without adding browser heartbeats',async()=>{
  const f=fixture({saved:200});await f.link.connect();f.state.notify(1);
  assert.equal(f.link.phase,'running');assert.ok(!f.link.heartbeat);
  await f.link.give();assert.deepEqual(f.packets,[[0]]);
  await f.link.stop();assert.equal(f.link.phase,'idle');f.link.drop('');
});
