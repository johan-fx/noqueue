// Local-only reference server; never deploy. TLS verification remains enabled.
import { fileURLToPath } from 'node:url';
import {createServer} from 'node:http'; import {request} from 'node:https'; import {readFile} from 'node:fs/promises'; import path from 'node:path';
const root=fileURLToPath(new URL('../../../', import.meta.url));const ca=await readFile(root+'/reports/android-local/tls/res/raw/noqueue_local_ca.pem');
createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')||req.url==='/__local/evidence'){
 const headers={...req.headers,host:'127.0.0.1:8788'};if(headers.origin)headers.origin='https://127.0.0.1:8788';
 const proxy=request('https://127.0.0.1:8788'+req.url,{method:req.method,headers,ca},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',()=>{res.writeHead(502);res.end()});req.pipe(proxy);return;
 }
 const url=new URL(req.url,'http://127.0.0.1:4173');const name=(/\.[a-z0-9]+$/i.test(url.pathname) ? url.pathname : '/index.html');
 try{const data=await readFile(path.join(root,'apps/web/dist',name));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':name.endsWith('.webmanifest')?'application/manifest+json':'text/html');res.end(data)}catch{res.writeHead(404);res.end()}
}).listen(4173,'127.0.0.1',()=>console.log('Local parity preview 4173'));
