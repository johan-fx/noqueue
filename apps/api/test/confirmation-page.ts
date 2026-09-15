// Imported only by the local e2e entrypoint, never the deployable Worker.
export const confirmationPage = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>NoQueue confirmation experiment</title>
<style>body{font:18px system-ui;max-width:680px;margin:40px auto;padding:20px;background:#fafaf8;color:#172326}label{display:block;margin:18px 0}input,button{font:inherit;padding:10px}input:not([type=checkbox]){display:block;max-width:95%}button{margin:6px 6px 6px 0}section{border:1px solid #aaa;padding:20px;margin:24px 0}strong{color:#914500}</style>
<h1>EXPERIMENT — staff-assisted confirmation</h1><strong>LOCAL SIMULATION. No WhatsApp is sent. No approved template or support resolution is implied.</strong>
<p>You play both staff and customer. The turn is real local queue data; delivery and replies are simulated. Failure or withdrawal never removes your turn.</p>
<form id="join"><h2>1. Staff records the request</h2>
<label>Pilot access code<input id="access" type="password" required autocomplete="off"></label>
<label>Phone with international prefix<input id="phone" type="tel" value="+34600000000" required></label>
<label>Party size<input id="party" type="number" min="1" max="20" value="2" required></label>
<label><input id="authorized" type="checkbox" required> The customer previously authorized this first WhatsApp confirmation request. This does NOT yet authorize queue updates.</label>
<button>Create experimental turn</button></form><p id="error" role="alert"></p>
<section id="customer" hidden><h2>2. Customer — simulated inbox</h2>
<p id="turn"></p><p id="delivery"></p><p id="permission"></p>
<p>Provisional experiment copy: Confirm WhatsApp updates for this turn by tapping CONFIRMO or replying CONFIRMO. Reply STOP or BAJA to withdraw.</p>
<button data-action="button">Simulate CONFIRMO button</button><button data-action="text">Simulate typed CONFIRMO</button>
<button data-action="STOP">Simulate STOP</button><button data-action="BAJA">Simulate BAJA</button>
<p>Requests expire after 15 minutes. With multiple pending turns for one phone, plain CONFIRMO is ignored; use the matching button.</p></section>
<script>
const el=id=>document.getElementById(id); let token=null; let key=crypto.randomUUID(); let previous=null;
async function refresh(){if(!token)return; const r=await fetch('/api/v1/public/entries/'+token);if(!r.ok)return; const e=await r.json();
el('turn').textContent='Turn '+e.code+' — '+e.status+' — position '+e.position;
el('delivery').textContent='Simulated request: '+e.notification;el('permission').textContent='Updates permission: '+e.confirmation;
}
el('join').onsubmit=async event=>{event.preventDefault();el('error').textContent='';const body=JSON.stringify({phone:el('phone').value,partySize:Number(el('party').value),locale:'es',priorContactAuthorization:el('authorized').checked});
if(previous!==null&&previous!==body)key=crypto.randomUUID();previous=body;
try{const r=await fetch('/api/v1/experiments/confirmation/queues/demo-queue/entries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-NoQueue-Pilot-Token':el('access').value},body});const e=await r.json();if(!r.ok)throw Error(e.error);token=e.recoveryToken;el('customer').hidden=false;await refresh()}catch(e){el('error').textContent=e.message}};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=async()=>{if(!token)return;el('error').textContent='';try{const r=await fetch('/api/v1/experiments/local/reply',{method:'POST',headers:{'Content-Type':'application/json','X-NoQueue-Pilot-Token':el('access').value},body:JSON.stringify({token,action:button.dataset.action})});if(!r.ok)throw Error((await r.json()).error);await refresh()}catch(e){el('error').textContent=e.message}};
setInterval(()=>refresh().catch(()=>{}),1000);
</script></html>`
