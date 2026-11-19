// Local UI test only. Not copied into dist or served in production.
(() => {
  const SETTINGS='3e61a103-27c5-4b4a-a89d-72b7b1478420';
  let saved=Number(sessionStorage.getItem('simulated-button-ms')||0), timer, runs=0;
  const packets=[];
  const status=new EventTarget();
  status.value=new DataView(Uint8Array.of(0).buffer);
  status.readValue=async()=>status.value;
  status.startNotifications=async()=>status;
  status.notify=n=>{status.value.setUint8(0,n);status.dispatchEvent(new Event('characteristicvaluechanged'));};
  const output=document.createElement('output');
  output.style.cssText='display:block;background:#fff8d9;color:#493c00;padding:16px;font:14px system-ui';
  document.body.prepend(output);
  const log=()=>output.textContent=`SIMULATED PUMP — no hardware. Runs: ${runs}. Saved: ${saved} ms. Commands: ${packets.map(p=>p[0]).join(', ')||'none'}`;
  log();
  const config={readValue:async()=>{const p=new Uint8Array(5);p[0]=1;new DataView(p.buffer).setUint32(1,saved,true);return new DataView(p.buffer);}};
  const command={writeValueWithResponse:async bytes=>{
    packets.push([...bytes]);
    if(bytes[0]===0){clearTimeout(timer);status.notify(0);}
    if(bytes[0]===5 && !status.value.getUint8(0)){
      saved=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(1,true);
      sessionStorage.setItem('simulated-button-ms',saved);
    }
    if(bytes[0]===4 && !status.value.getUint8(0)){
      const ms=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(1,true);
      runs++;status.notify(1);timer=setTimeout(()=>status.notify(0),ms);
    }
    log();
  }};
  const device=new EventTarget();
  device.gatt={connected:false,async connect(){this.connected=true;return this;},disconnect(){clearTimeout(timer);status.notify(0);this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));},async getPrimaryService(){return {getCharacteristic:async id=>id===SETTINGS?config:id.includes('a101')?command:status};}};
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{requestDevice:async()=>device}});
})();
