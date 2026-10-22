import { env } from 'cloudflare:workers'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { fixture } from './whatsapp-v4-fixture'
import { hmac } from '../src/features/queue/crypto'
import { joinQueue } from '../src/features/queue/entries'
import { runQueueCommand } from '../src/features/staff/commands'
import { expireArrivals } from '../src/features/queue/customer'
import { parsePushSnapshot } from '../src/features/mobile/push/lifecycle'
import { renderPushCopy } from '../src/features/mobile/push/copy'
import { allowLifecycleRequest, lifecycleGuardSchema } from './local-push-lifecycle-policy'

const bindings={...env,APP_ENV:'local',WHATSAPP_ENABLED:'false',MOBILE_PUSH_ENABLED:'true',FCM_PROJECT_ID:'nq-app-f3127',
  FCM_CLIENT_EMAIL:'noqueue-push-sender@nq-app-f3127.iam.gserviceaccount.com',MOBILE_PUSH_TOKEN_KEY:'44'.repeat(32)}
const endpoint='https://fcm.googleapis.com/v1/projects/nq-app-f3127/messages:send'
const request=(body:unknown,url=endpoint)=>new Request(url,{method:'POST',redirect:'manual',body:JSON.stringify(body)})
beforeEach(async()=>{ for(const name of ['local_push_lifecycle_attempt','local_push_lifecycle_guard'])await env.DB.exec(`DROP TABLE IF EXISTS ${name}`);for(const sql of lifecycleGuardSchema)await env.DB.exec(sql.replaceAll('\n',' ')) })
afterEach(()=>vi.restoreAllMocks())
async function scenario(platform:'ios'|'android', budget=2,limits={called:1,expired:1}){
  const f=await fixture(),owner=crypto.randomUUID().replaceAll('-','').repeat(2),token='test-only-'+crypto.randomUUID(),now=Date.now()
  const tokenHash=await hmac(bindings.MOBILE_PUSH_TOKEN_KEY,`push:fcm:${token}`)
  await env.DB.prepare("INSERT INTO mobile_push_registration VALUES (?,'fcm',?,'unused','es',1,?,?)").bind(owner,tokenHash,now,platform).run()
  await joinQueue(bindings,f.queue,crypto.randomUUID(),{displayName:'Test',partySize:1,receptionService:'check_in',locale:'es',whatsapp:{consent:false}},false,undefined,'mobile-app',owner)
  const entry=(await env.DB.prepare('SELECT id FROM queue_entry WHERE queue_id=?').bind(f.queue).first<{id:string}>())!.id
  await env.DB.prepare('INSERT INTO local_push_lifecycle_guard VALUES (1,?,?,?,?,?,?,?,2,1)').bind(platform,owner,tokenHash,entry,now+90*60000,budget,JSON.stringify(limits)).run()
  await runQueueCommand(bindings,f.actor,f.queue,crypto.randomUUID(),{action:'assign_next',expectedEntryId:entry,expectedVersion:0})
  async function body(kind='called'){
    const n=(await env.DB.prepare('SELECT id,payload_snapshot FROM mobile_push_outbox WHERE entry_id=? AND kind=?').bind(entry,kind).first<{id:string;payload_snapshot:string}>())!
    await env.DB.prepare("UPDATE mobile_push_outbox SET status='sending',attempts=1 WHERE id=?").bind(n.id).run()
    const notification={title:'NoQueue',body:renderPushCopy(parsePushSnapshot(n.payload_snapshot))}
    return {message:{token,notification,data:{type:'queue-update',notificationId:n.id},...(platform==='ios'?{apns:{headers:{'apns-topic':'com.noqueue-app.ios'},payload:{aps:{alert:notification}}}}:{android:{notification:{channel_id:'queue-updates'}}})}}
  }
  return {...f,entry,owner,token,now,body}
}
it.each(['ios','android'] as const)('consumes an explicitly bounded %s lifecycle once per event even concurrently',async platform=>{
  const f=await scenario(platform),first=await f.body()
  expect((await Promise.all([allowLifecycleRequest(request(first),bindings),allowLifecycleRequest(request(first),bindings)])).sort()).toEqual([false,true])
  vi.spyOn(Date,'now').mockReturnValue(f.now+6*60000)
  await expireArrivals(bindings,f.queue,Date.now())
  const expired=await f.body('expired')
  expect(await allowLifecycleRequest(request(expired),bindings)).toBe(true)
  expect(await allowLifecycleRequest(request(expired),bindings)).toBe(false)
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM local_push_lifecycle_attempt').first())?.n).toBe(2)
})
it('rejects wrong destination, content, event, project, broadcast and environment without spending budget',async()=>{
  const f=await scenario('android'),body=await f.body()
  for(const patch of [{token:'other'},{topic:'all'},{condition:'true'},{notification:{title:'NoQueue',body:'unapproved'}},{data:{...body.message.data,recoveryToken:'secret'}},{data:{type:'queue-update',notificationId:'f'.repeat(32)}}])
    expect(await allowLifecycleRequest(request({message:{...body.message,...patch}}),bindings)).toBe(false)
  expect(await allowLifecycleRequest(request(body,endpoint.replace('nq-app-f3127','other')),bindings)).toBe(false)
  expect(await allowLifecycleRequest(request(body),{...bindings,APP_ENV:'production'})).toBe(false)
  expect(await allowLifecycleRequest(request(body),{...bindings,WHATSAPP_ENABLED:'true'})).toBe(false)
  expect(await allowLifecycleRequest(request(body),bindings)).toBe(true)
})
it.each(['disarmed','expired','revoked','budget','kind','retry'] as const)('blocks %s before egress',async reason=>{
  const f=await scenario('ios'),body=await f.body()
  if(reason==='disarmed')await env.DB.prepare('UPDATE local_push_lifecycle_guard SET armed=0').run()
  if(reason==='expired')await env.DB.prepare('UPDATE local_push_lifecycle_guard SET expires_at=0').run()
  if(reason==='revoked')await env.DB.prepare('DELETE FROM mobile_push_registration WHERE installation_hash=?').bind(f.owner).run()
  if(reason==='budget'){expect(await allowLifecycleRequest(request(body),bindings)).toBe(true);await env.DB.prepare('UPDATE local_push_lifecycle_guard SET budget=1').run()}
  if(reason==='kind')await env.DB.prepare('UPDATE local_push_lifecycle_guard SET limits=?').bind(JSON.stringify({expired:1})).run()
  if(reason==='retry')await env.DB.prepare('UPDATE mobile_push_outbox SET attempts=2').run()
  expect(await allowLifecycleRequest(request(body),bindings)).toBe(false)
})
