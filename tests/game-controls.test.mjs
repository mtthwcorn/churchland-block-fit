import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {BLOCKS, newPuzzle, fitBlock} from '../game/engine.mjs';
import {PUMP_ML_PER_MINUTE, rewardPlan, PulseRunner} from '../game/rewards.mjs';

const source = (await readFile(new URL('../game/app.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const html = await readFile(new URL('../game/index.html', import.meta.url), 'utf8');
function fixture() {
  const nodes={};
  class Node extends EventTarget {
    constructor() { super(); this.value=''; this.dataset={}; this.children=[]; this.classList={toggle(){},remove(){},add(){}};this.style={setProperty(){}}; }
    set id(value) { nodes[value]=this;this._id=value; }
    get id() { return this._id; }
    setAttribute(name,value) { this[name]=value; }
    removeAttribute(name) { delete this[name]; }
    replaceChildren(...children) { this.children=children; }
    getBoundingClientRect() { return {left:0,top:0,width:100,height:100}; }
  }
  let time=0;
  class MockPump extends EventTarget {
    constructor() { super(); this.phase='offline'; this.pending=''; this.runs=[]; }
    state(phase) { this.phase=phase; this.dispatchEvent(new Event('change')); }
    connect() { this.device={name:'Test pump',gatt:{connected:true}};this.state('idle'); }
    run(seconds) { this.runs.push(seconds);this.state('running');return Promise.resolve(); }
    async stop() { if(this.device) this.state('idle'); }
    drop(message) { this.message=message; this.device=null; this.state('offline'); }
  }
  for(const [,id] of html.matchAll(/id="([^"]+)"/g)) nodes[id]=new Node();
  nodes.progress.children=[new Node(),new Node(),new Node()];
  const document=Object.assign(new EventTarget(),{hidden:false,getElementById:id=>nodes[id],createElement:()=>new Node(),querySelectorAll:()=>[]});
  const storage=new Map([['pump-2048-reward-ml-v2','1.5'],['pump-2048-device-v1:old-pump',JSON.stringify({calibration:{rate:.5},limitMl:.1,used:999})]]);
  const context=vm.createContext({PumpLink:MockPump,PulseRunner,PUMP_ML_PER_MINUTE,rewardPlan,BLOCKS,newPuzzle,fitBlock,document,
    window:Object.assign(new EventTarget(),{isSecureContext:true}),navigator:{bluetooth:{}},matchMedia:()=>({matches:true}),
    HTMLInputElement:Node,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},performance,setTimeout,clearTimeout});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run('runner.now = () => testClock()');
  context.testClock=()=>time;
  return {run,nodes,document,link:run('link'),time:value=>{time=value;},fit:(piece='square',slot=piece)=>run(`placePiece(${JSON.stringify(piece)},${JSON.stringify(slot)})`)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('practice fits, connection and old settings never activate the pump',async()=>{
  const f=fixture();assert.equal(f.nodes['reward-ml'].value,'1.5');
  await f.fit();assert.deepEqual(f.link.runs,[]);
  f.link.connect();assert.deepEqual(f.link.runs,[]);
  assert.equal(f.nodes['start-rewards'].disabled,false);
  assert.match(f.nodes['dose-preview'].textContent,/1 s \/ trial/);
  assert.equal(f.run('mode'),'practice');
});
test('only the third fitted block earns one reward, and each later trial earns its configured amount',async()=>{
  const f=fixture();f.link.connect();f.run('startRewards()');
  await f.fit('square','long');assert.deepEqual(f.link.runs,[]);
  await f.fit('square');assert.deepEqual(f.link.runs,[]);
  await f.fit('square');assert.deepEqual(f.link.runs,[]);
  await f.fit('tall');assert.deepEqual(f.link.runs,[]);
  const finalFit=f.fit('long');await tick();assert.deepEqual(f.link.runs,[1]);
  assert.equal(f.run('puzzle.placed.length'),3);assert.equal(f.run('operation'),true);
  await f.fit('long');assert.deepEqual(f.link.runs,[1]);
  f.time(1000);f.link.state('idle');await finalFit;
  await f.fit('long');assert.deepEqual(f.link.runs,[1]);
  await f.run('pausePlay()');f.nodes['reward-ml'].value='.75';f.run('freshBoard();startRewards()');
  await f.fit('long');await f.fit('tall');assert.deepEqual(f.link.runs,[1]);
  const next=f.fit('square');await tick();assert.deepEqual(f.link.runs,[1,.5]);
  f.time(1500);f.link.state('idle');await next;f.run('clearTimeout(restartTimer)');
});
test('pause stops a trial reward and resume cannot replay it',async()=>{
  const f=fixture();f.link.connect();f.run('startRewards()');
  await f.fit('square');await f.fit('tall');
  const fit=f.fit('long');await tick();await f.run('pausePlay()');await fit;
  assert.equal(f.run('paused'),true);assert.deepEqual(f.link.runs,[1]);
  f.run('startRewards()');await f.fit('long');assert.equal(f.run('paused'),false);assert.deepEqual(f.link.runs,[1]);
  f.run('clearTimeout(restartTimer)');
});
test('disconnect pauses a trial reward; reconnect requires resume and cannot replay it',async()=>{
  const f=fixture();f.link.connect();f.run('startRewards()');
  await f.fit('square');await f.fit('tall');
  const fit=f.fit('long');await tick();f.link.drop('Disconnected');await fit;
  assert.equal(f.run('paused'),true);f.link.connect();assert.equal(f.run('paused'),true);
  f.run('startRewards()');await f.fit('long');assert.equal(f.run('paused'),false);assert.deepEqual(f.link.runs,[1]);
  f.run('clearTimeout(restartTimer)');
});
test('invalid amounts cannot activate rewards even when the full trial is completed',async()=>{
  const f=fixture();f.link.connect();f.nodes['reward-ml'].value='.01';f.run('startRewards()');
  await f.fit('square');await f.fit('tall');await f.fit('long');
  assert.equal(f.run('mode'),'practice');assert.deepEqual(f.link.runs,[]);f.run('clearTimeout(restartTimer)');
});
test('hiding the page cancels a pending completion reward and resume never replays it',async()=>{
  const f=fixture();f.link.connect();f.run('startRewards()');await f.fit('square');await f.fit('tall');
  const fit=f.fit('long');f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));await fit;await tick();
  assert.equal(f.run('paused'),true);assert.deepEqual(f.link.runs,[]);
  f.run('startRewards()');assert.equal(f.run('paused'),true);
  f.document.hidden=false;f.run('startRewards()');await f.fit('long');assert.deepEqual(f.link.runs,[]);
  f.run('clearTimeout(restartTimer)');
});
test('practice completes all three blocks and starts fresh without dispensing',async()=>{
  const f=fixture();await f.fit('square');await f.fit('tall');await f.fit('long');
  assert.equal(f.run('puzzle.placed.length'),3);
  const layout=f.run('puzzle.layout');f.run('freshBoard()');
  assert.equal(f.run('puzzle.placed.length'),0);assert.notEqual(f.run('puzzle.layout'),layout);
  assert.deepEqual(f.link.runs,[]);
});
