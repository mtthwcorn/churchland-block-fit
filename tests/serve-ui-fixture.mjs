// npm run build, then node tests/serve-ui-fixture.mjs. Localhost-only simulated BLE.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const mime={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',zip:'application/zip'};
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    let path=decodeURIComponent(url.pathname);
    if(path.includes('..'))throw Error('invalid');
    if(path.endsWith('/'))path+='index.html';
    let content;
    if(path==='/pump/fixture.js')content=await readFile(new URL('./browser-pump-fixture.js',import.meta.url));
    else if(path.endsWith('/sw.js')){res.writeHead(404);res.end();return;}
    else content=await readFile(new URL('.'+path,root));
    if(path==='/pump/index.html') content=content.toString().replace('<script type="module"','<script src="./fixture.js"></script><script type="module"');
    if(path==='/pump/app.mjs') content=content.toString().replace(/if \('serviceWorker' in navigator\).*\n/,'');
    res.writeHead(200,{'Content-Type':mime[path.split('.').at(-1)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  }catch {res.writeHead(404);res.end('Not found');}
}).listen(8773,'127.0.0.1',()=>console.log('SIMULATED pump: http://127.0.0.1:8773/pump/ (no hardware)'));
