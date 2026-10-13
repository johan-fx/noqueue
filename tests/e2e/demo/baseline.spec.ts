import { test, expect, newClientContext } from '../fixtures.js'
import { fixture, supportEntry } from './fixtures.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
test('three real public countdowns use the sequential queue estimate',async({browser,request,baseURL},info)=>{
 const root=process.env.QUEUE_DEMO_DIR!
 await mkdir(`${root}/raw`,{recursive:true,mode:0o700});await mkdir(`${root}/frames`,{recursive:true,mode:0o700})
 const opts={baseURL:baseURL!,viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block' as const,recordVideo:{dir:`${root}/raw`,size:{width:390,height:844}}}
 const sc=await newClientContext(browser,info,'baseline-staff',opts),cc=await newClientContext(browser,info,'baseline-client',opts)
 const staff=await sc.newPage(),client=await cc.newPage()
 const e:any={id:'baseline',status:'running',duration:0,moments:[],waits:[],assertions:[],videos:[],errors:[],telemetry:[]}
 const removed:number[]=[];let start=0
 try{
  const f=await fixture(staff,request,baseURL!,'restaurant','main',{interval:4,tables:3,approach:2})
  const entries=[]
  for(const name of ['Primer Cliente','Segundo Cliente','Tercer Cliente'])entries.push(await supportEntry(cc.request,baseURL!,f.queue,'restaurant',name))
  await staff.reload();await staff.getByRole('button',{name:'Ver lista',exact:true}).click()
  await client.goto(`/t/${entries[0].recoveryToken}`)
  await expect(client.getByRole('progressbar')).toBeVisible()
  await Promise.all([staff,client].map(p=>p.evaluate(()=>{const m=document.createElement('div');m.id='queue-demo-marker';m.style.cssText='position:fixed;inset:0;background:#ff00ff;z-index:2147483647';document.body.append(m)})))
  await sleep(1200)
  await Promise.all([staff,client].map(async(p,i)=>{await p.evaluate(()=>document.getElementById('queue-demo-marker')!.remove());removed[i]=performance.now()}));await sleep(1000);start=performance.now()
  for(let i=0;i<3;i++){
   if(i)await client.goto(`/t/${entries[i].recoveryToken}`)
   await expect(client.getByRole('progressbar')).toBeVisible()
   const body=await(await client.request.get(`/api/v1/public/entries/${entries[i].recoveryToken}`)).json()
   const actual=Math.round((body.predictedAt-Date.now())/60000),expected=(i+1)*4
   e.assertions.push({key:`customer-${i+1}-minutes`,actual,expected});expect.soft(actual).toBe(expected)
   const text=await client.getByRole('progressbar').innerText()
   e.telemetry.push({at:(performance.now()-start)/1000,ui:{text},server:body})
   e.moments.push({event:`customer-${i+1}`,caption:`Cliente ${i+1} · Previsión inicial ${expected} minutos (menos el tiempo transcurrido) · estimación secuencial`,at:(performance.now()-start)/1000,hold:7})
   await Promise.all([staff,client].map((p,j)=>p.screenshot({path:`${root}/frames/baseline-customer-${i+1}-${j}.png`})))
   await sleep(7000)
  }
  e.status=info.errors.length?'failed':'passed'
 }catch(err){e.status='failed';e.errors.push(String(err));throw err}
 finally{
  e.duration=start?(performance.now()-start)/1000:0;e.errors.push(...info.errors.map(x=>x.message))
  await Promise.all([sc.close(),cc.close()])
  e.videos=await Promise.all([staff,client].map(async(p,i)=>({role:i?'customer':'staff',path:await p.video()!.path(),afterMarker:start?(start-removed[i]!)/1000:0})))
  await writeFile(`${root}/adaptive-baseline.json`,JSON.stringify(e,null,2),{mode:0o600})
 }
})
