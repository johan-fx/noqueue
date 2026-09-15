/** Public login shell only. All data and actions require the existing pilot token.
 * Native HTML keeps this experiment independent of the production web application.
 * Credentials and retry keys live only in page memory; never URLs or browser storage. */
export function experimentPage(nonce: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NoQueue · Prueba privada</title><style nonce="${nonce}">
:root{color-scheme:light;--background:#fafafa;--foreground:#18181b;--card:#fff;--muted:#71717a;--border:#e4e4e7;--subtle:#f4f4f5;--primary:#18181b;--accent:#ecfdf5;--accent-foreground:#065f46;--warning:#fffbeb;--warning-foreground:#854d0e;--danger:#b91c1c;--radius:12px;--shadow:0 1px 2px #18181b08}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.45}button,input{transition:border-color .15s,background .15s,box-shadow .15s}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #a7f3d0;outline-offset:3px}button:disabled:hover{background:inherit}[hidden]{display:none!important}h1,h2,h3,p{margin:0}h1{font-size:clamp(26px,3.8vw,36px);letter-spacing:-1.15px;line-height:1.2;font-weight:650}h2{font-size:16px;font-weight:650;letter-spacing:-.3px}h3{font-size:14px;font-weight:600}small,.small{font-size:12px;line-height:1.6}.muted{color:var(--muted)}.shell{max-width:1200px;padding:0 32px;margin:auto}.topbar{background:var(--card);border-bottom:1px solid var(--border)}.topbar .shell{height:72px;display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{display:flex;align-items:center;gap:11px;font-size:19px;font-weight:700;letter-spacing:-.65px}.brandmark{display:grid;place-items:center;width:32px;height:32px;background:var(--primary);color:white;border-radius:9px;font-size:18px}.brand span:last-child{font-size:13px;font-weight:400;letter-spacing:0;color:var(--muted);border-left:1px solid var(--border);padding-left:14px;margin-left:4px}.badge{display:inline-flex;align-items:center;gap:6px;width:max-content;max-width:100%;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;line-height:1.6;background:var(--card)}.badge:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}.badge[data-tone=good]{color:var(--accent-foreground);border-color:#a7f3d0;background:var(--accent)}.badge[data-tone=warn]{color:var(--warning-foreground);border-color:#fde68a;background:var(--warning)}.badge[data-tone=bad]{color:var(--danger);border-color:#fecaca;background:#fef2f2}.hero{padding:38px 0 26px}.eyebrow{font-size:11px;text-transform:uppercase;font-weight:650;letter-spacing:1.3px;color:var(--muted);margin-bottom:10px}.hero p{margin-top:12px;max-width:660px;font-size:15px;color:var(--muted)}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 14px;border:1px solid var(--primary);border-radius:7px;background:var(--primary);color:white;font-weight:550;font-size:13px;line-height:1.4;box-shadow:var(--shadow)}.btn:hover{background:#303036}.btn.secondary{border-color:var(--border);color:var(--foreground);background:white}.btn.secondary:hover{background:var(--subtle)}.btn.ghost{box-shadow:none;background:transparent;color:var(--muted);border-color:transparent}.btn.ghost:hover{background:var(--subtle)}.btn.danger{background:var(--danger);border-color:var(--danger)}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}.card-head{padding:20px 22px;border-bottom:1px solid var(--border)}.card-body{padding:22px}.card-head p{margin-top:4px}.title-row{display:flex;align-items:center;gap:10px}.step-number{display:grid;place-items:center;width:24px;height:24px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;flex-shrink:0;background:var(--background)}.steps{list-style:none;margin:0 0 26px;padding:16px 20px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;border:1px solid var(--border);border-radius:var(--radius);background:white}.steps li{display:flex;align-items:center;gap:10px;min-width:0}.steps span:last-child{font-size:12px;color:var(--muted)}.steps strong{display:block;font-size:13px;font-weight:550;color:var(--foreground)}.steps li[aria-current=step] .step-number{background:var(--primary);border-color:var(--primary);color:white}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.toolbar .actions{display:flex;gap:4px}.workspace{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;align-items:start}.stack{display:grid;gap:18px}.section-label{font-size:11px;font-weight:650;letter-spacing:1px;color:var(--muted);text-transform:uppercase}.inline{display:flex;align-items:center;justify-content:space-between;gap:20px}.alert{padding:13px 15px;border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.65;background:var(--subtle)}.alert strong{font-weight:600}.alert.warning{background:var(--warning);color:var(--warning-foreground);border-color:#fde68a}.alert.error{background:#fef2f2;color:var(--danger);border-color:#fecaca;margin-bottom:20px}.alert.info{background:#f8fafc;color:#475569;border-color:#e2e8f0}.form-grid{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:16px}label{display:block;font-size:12px;font-weight:550;margin-bottom:7px}input:not([type=checkbox]){width:100%;min-height:42px;border:1px solid var(--border);border-radius:7px;padding:10px 12px;background:white;color:var(--foreground);box-shadow:var(--shadow)}input::placeholder{color:#a1a1aa}input:disabled{background:var(--background);color:var(--muted)}input[type=checkbox]{width:16px;height:16px;margin:3px 0 0;accent-color:var(--primary);flex-shrink:0}.check-label{display:flex;align-items:flex-start;gap:10px;margin:18px 0;font-weight:400;line-height:1.7;color:#52525b}.check-label strong{color:var(--foreground);font-weight:550}.help{font-size:11px;color:var(--muted);margin-top:7px;line-height:1.6}fieldset{padding:0;margin:0;border:0;min-width:0}.form-footer{margin-top:16px}.form-footer .btn{width:100%}.spaced{margin-top:14px}.guest-head{background:linear-gradient(135deg,#f7fcf9,#fff);display:flex;justify-content:space-between;align-items:center;gap:12px}.position-area{display:flex;align-items:center;gap:24px;padding:24px 0}.position{font-size:76px;font-weight:600;line-height:1;letter-spacing:-5px;font-variant-numeric:tabular-nums;min-width:80px}.position-detail p{font-size:15px;font-weight:550}.position-detail .muted{font-size:12px;font-weight:400;margin-top:3px}.reference{font-family:ui-monospace,SFMono-Regular,monospace;letter-spacing:1.6px;font-size:12px}.status-grid{display:grid;gap:14px;margin:18px 0}.status-item{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center}.status-item p{grid-column:1/-1;font-size:11px;color:var(--muted)}.divider{border:0;border-top:1px solid var(--border);margin:18px 0}.empty{padding:26px 10px;text-align:center}.empty-icon{width:42px;height:42px;border:1px dashed #d4d4d8;border-radius:10px;margin:0 auto 12px;display:grid;place-items:center;color:var(--muted);font-size:20px}.empty p{font-size:12px;max-width:270px;margin:7px auto 0;color:var(--muted)}.queue-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.queue-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:8px}.queue-row[data-tester=true]{border-color:#a7f3d0;background:#f0fdf7}.queue-index{display:grid;place-items:center;width:27px;height:27px;background:var(--subtle);border-radius:6px;font-size:12px;font-weight:600;flex-shrink:0}.queue-row[data-tester=true] .queue-index{background:#d1fae5;color:var(--accent-foreground)}.queue-copy{flex:1;min-width:0}.queue-copy strong{display:block;font-size:12px;font-weight:550}.queue-copy small{color:var(--muted);display:block;font-size:10px;overflow-wrap:anywhere}.queue-row .badge{font-size:10px}.queue-count{font-size:12px;color:var(--muted);font-weight:400;margin-left:auto}.footer{padding:26px 0 32px;font-size:11px;color:var(--muted);text-align:center}.login-wrap{max-width:440px;margin:12px auto 70px}.login-wrap .card-head{padding:26px}.login-wrap .card-body{padding:26px}.login-wrap h2{font-size:20px}.login-wrap .btn{width:100%;margin-top:18px}.login-lock{display:grid;place-items:center;width:38px;height:38px;background:var(--subtle);border-radius:9px;margin-bottom:18px}.login-wrap .alert{margin-top:18px}dialog{border:1px solid var(--border);border-radius:14px;max-width:440px;width:calc(100% - 32px);padding:26px;box-shadow:0 20px 70px #0003;color:var(--foreground)}dialog::backdrop{background:#18181b66;backdrop-filter:blur(2px)}dialog h2{font-size:20px}dialog p{font-size:13px;color:var(--muted);margin-top:12px}dialog .actions{display:flex;justify-content:flex-end;gap:9px;margin-top:24px}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.busy-dot{width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;margin-right:6px}#busy-status{min-height:18px;font-size:11px;color:var(--muted)}
@media(max-width:760px){.shell{padding:0 18px}.topbar .shell{height:62px}.brand span:last-child{display:none}.hero{padding:28px 0 22px}.hero p{font-size:13px}.steps{grid-template-columns:repeat(2,1fr);gap:16px;padding:16px}.workspace{grid-template-columns:1fr;gap:22px}.card-head{padding:18px}.card-body{padding:18px}.toolbar{align-items:flex-start}.toolbar .actions{gap:0}.toolbar .btn{font-size:12px;padding:8px}.inline{gap:12px;align-items:flex-start;flex-direction:column}.inline .btn{width:100%}.form-grid{grid-template-columns:minmax(0,1fr) 85px;gap:12px}.position{font-size:68px}.login-wrap{margin-top:0}.guest-head{align-items:flex-start}.footer{text-align:left}.queue-row .badge{padding:2px 5px}dialog .actions .btn{flex:1}}
@media(max-width:760px){.workspace>div.stack,.workspace>aside{display:contents}.workspace>div.stack>.section-label{order:1}.workspace>div.stack>section:nth-of-type(1){order:2}.workspace>div.stack>section:nth-of-type(2){order:3}.workspace>aside>.section-label{order:4}.workspace>aside>section:nth-of-type(1){order:5}.workspace>div.stack>section:nth-of-type(3){order:6}.workspace>aside>section:nth-of-type(2){order:7}.workspace>aside>.alert{order:8}.workspace>aside>.help{order:9}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<header class="topbar"><div class="shell"><div class="brand"><span class="brandmark" aria-hidden="true">N</span>NoQueue<span>Prueba privada</span></div><span class="badge" data-tone="warn">EXPERIMENTO</span></div></header>
<div class="shell"><div class="hero"><div class="eyebrow">Del mostrador al WhatsApp</div><h1>Prueba la cola, de principio a fin.</h1><p>Actúa como personal del restaurante y comprueba lo que recibe el invitado. Una cola compartida para una prueba cada vez. Usa tu propio teléfono.</p></div>
<div id="error" class="alert error" role="alert" hidden></div>
<div id="login-wrap" class="login-wrap"><form id="login" class="card"><div class="card-head"><div class="login-lock" aria-hidden="true">↳</div><h2>Accede a la prueba</h2><p class="muted small">Introduce el acceso privado que te ha facilitado el equipo. Este enlace no concede acceso por sí solo.</p></div><div class="card-body"><label for="access">Acceso al piloto</label><input id="access" type="password" required autocomplete="off" aria-describedby="access-help"><p id="access-help" class="help">Compártelo únicamente por un canal privado. No se guarda en este navegador.</p><button class="btn" type="submit">Entrar</button></div></form><div class="alert info"><strong>Antes de empezar</strong><br>Usa únicamente tu propio teléfono y autoriza el primer contacto. El acceso privado no sustituye tu consentimiento. Los mensajes son reales y pueden generar costes.</div></div>
<main id="panel" hidden>
<ol class="steps" aria-label="Pasos de la prueba"><li data-step="1" aria-current="step"><span class="step-number">1</span><span><strong>Prepara la cola</strong>3 turnos ficticios</span></li><li data-step="2"><span class="step-number">2</span><span><strong>Añade tu turno</strong>Tu propio teléfono</span></li><li data-step="3"><span class="step-number">3</span><span><strong>Confirma en WhatsApp</strong>Responde CONFIRMO</span></li><li data-step="4"><span class="step-number">4</span><span><strong>Avanza la cola</strong>Comprueba el aviso</span></li></ol>
<div class="toolbar"><div><div class="section-label">Vista de la prueba</div><p id="busy-status"><span class="busy-dot"></span>El estado se actualiza automáticamente</p></div><div class="actions"><button id="refresh" class="btn ghost">Actualizar estado</button><button id="logout" class="btn secondary">Salir</button></div></div>
<div class="workspace"><div class="stack"><div class="section-label">Tú haces de personal</div>
<section class="card"><div class="card-head"><div class="title-row"><span class="step-number">1</span><h2>Prepara el escenario</h2></div><p class="muted small">Cola compartida: solo un invitado cada vez. Los tres turnos ficticios no reciben mensajes.</p></div><div class="card-body"><div class="inline"><p class="small muted" id="seed-help">Empieza con una cola limpia para ver cómo cambia la posición.</p><button id="seed" class="btn secondary">Preparar tres turnos</button></div></div></section>
<section class="card"><div class="card-head"><div class="title-row"><span class="step-number">2</span><h2>Añade el turno del invitado</h2></div><p class="muted small">Este primer mensaje solo solicita permiso para enviar los avisos.</p></div><div class="card-body"><div id="join-hint" class="alert info" hidden></div><form id="join"><fieldset id="join-fields"><div class="form-grid"><div><label for="phone">Tu teléfono</label><input id="phone" type="tel" required pattern="\\+[1-9][0-9]{7,14}" placeholder="+34 600 000 000" autocomplete="off" aria-describedby="phone-help"><p id="phone-help" class="help">Incluye el prefijo, sin espacios. Solo tu propio número, nunca el de terceros.</p></div><div><label for="party">Personas</label><input id="party" type="number" min="1" max="20" value="2" required></div></div><label class="check-label" for="authorized"><input id="authorized" type="checkbox" required><span><strong>El invitado ha autorizado previamente este primer contacto.</strong><br>Los avisos de la cola solo se activan cuando confirme por WhatsApp.</span></label><div class="form-footer"><button id="join-submit" class="btn" type="submit">Crear turno y solicitar CONFIRMO <span aria-hidden="true">→</span></button></div></fieldset></form></div></section>
<section class="card"><div class="card-head"><div class="title-row"><span class="step-number">4</span><h2>Haz avanzar la cola</h2></div><p class="muted small">Retira el primer turno. El invitado verá su nueva posición.</p></div><div class="card-body"><button id="advance" class="btn">Avanzar un turno <span aria-hidden="true">→</span></button><p id="advance-help" class="help spaced">Prepara la cola para comenzar.</p></div></section>
</div><aside class="stack" aria-label="Estado del invitado"><div class="section-label">Lo que vive el invitado</div>
<section class="card"><div class="card-head guest-head"><div><div class="title-row"><span class="step-number">3</span><h2>Tu turno de prueba</h2></div><p class="muted small">Confirma en tu WhatsApp real, no aquí.</p></div><span id="guest-badge" class="badge">Sin turno</span></div><div class="card-body"><div id="guest-empty" class="empty"><div class="empty-icon" aria-hidden="true">#</div><h3>El invitado aún no tiene turno</h3><p>Prepara los tres turnos ficticios y añade tu propio teléfono para empezar.</p></div><div id="guest-active" hidden><div class="inline"><span class="muted small">Referencia de tu turno</span><strong id="guest-code" class="reference"></strong></div><div class="position-area"><span id="guest-position" class="position"></span><div class="position-detail"><p id="guest-ahead"></p><p class="muted">Tu posición en la cola</p></div></div><div id="next-warning" class="alert info" hidden>Eres el siguiente en la cola. <strong>No significa que tu mesa esté lista.</strong></div><div class="status-grid"><div class="status-item"><h3>Permiso para los avisos</h3><span id="consent-badge" class="badge"></span><p id="consent-detail"></p></div><div class="status-item"><h3>Último envío</h3><span id="delivery-badge" class="badge"></span><p id="delivery-detail"></p></div></div><div id="guest-next" class="alert info"></div></div></div></section>
<section class="card"><div class="card-head"><div class="title-row"><h2>La cola, en directo</h2><span id="queue-count" class="queue-count">0 turnos</span></div></div><div class="card-body"><p id="queue-empty" class="small muted">Aún no hay turnos en esta prueba.</p><ol id="entries" class="queue-list" aria-label="Turnos en espera"></ol></div></section>
<div id="withdrawal" class="alert warning"><strong>BAJA es el último paso de la prueba.</strong><br>Envía BAJA desde WhatsApp para detener los avisos. Reiniciar la cola no elimina la baja ni vuelve a autorizar ese teléfono.</div>
<p class="help">Solo se envían avisos con permiso activo y dentro de las 24 horas desde el último mensaje del invitado. Un mensaje aceptado por el proveedor todavía puede no haberse entregado.</p>
</aside></div>
</main><footer class="footer">Experimento privado de NoQueue. No es un sistema de personal para producción. Abrir esta página no envía ningún WhatsApp.</footer></div>
<dialog id="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-description"><h2 id="reset-title">¿Reiniciar esta prueba?</h2><p id="reset-description">Esta cola es compartida. Puedes cancelar la prueba de otra persona: se retirarán los turnos actuales y se cancelarán sus avisos pendientes. Después habrá que crear y confirmar un nuevo turno.</p><div class="alert warning spaced">Una BAJA anterior seguirá activa. Un envío con resultado incierto no se reenviará.</div><div class="actions"><button id="reset-cancel" class="btn secondary" autofocus>Conservar la prueba</button><button id="reset-confirm" class="btn danger">Reiniciar prueba</button></div></dialog>
<div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
const el = id => document.getElementById(id);
const base = '/api/v1/experiments/confirmation';
let access = '', busy = false, entries = [], observedWithdrawal = false, lastSnapshot = '';
const keys = new Map();
const errors = {
  pilot_access_required: 'El acceso no es válido o ha caducado. Comprueba el código privado con el equipo.',
  recipient_not_allowed: 'Este entorno todavía restringe los teléfonos de prueba. Pide al equipo que revise su configuración; no uses el número de otra persona.',
  contact_stopped: 'Este teléfono se ha dado de baja. Reiniciar o responder CONFIRMO no lo vuelve a autorizar.',
  unknown_delivery_unresolved: 'Hay un envío con resultado incierto. No crees otro turno ni intentes reenviar el mensaje; el equipo debe comprobarlo.',
  experiment_tester_already_waiting: 'Ya hay un invitado en esta prueba. Conserva su turno o reinicia la cola de forma explícita.',
  prior_authorization_required_or_invalid_join: 'Revisa el teléfono, el número de personas y la autorización previa del invitado.',
  invalid_join: 'Revisa el teléfono y el número de personas antes de continuar.',
  queue_unavailable: 'La cola está cerrada o completa. Actualiza el estado antes de volver a intentarlo.',
  queue_empty: 'La cola ya está vacía. Prepara tres turnos para iniciar otra prueba.',
  rate_limited: 'Se han realizado demasiadas acciones seguidas. Espera un minuto antes de repetir la misma acción.',
  idempotency_conflict: 'La acción no coincide con el intento anterior. Actualiza el estado y pide ayuda al equipo; no vuelvas a enviar datos distintos.',
  origin_not_allowed: 'Abre la prueba desde su enlace original para continuar.',
  not_found: 'Este experimento no está disponible en este entorno. Consulta con el equipo.',
  experiment_spanish_only: 'Esta prueba utiliza mensajes en español.',
};
const consentLabels = {
  pending: ['Por confirmar', 'warn', 'Todavía no hay permiso para enviar avisos de posición.'],
  confirmed: ['Avisos activados', 'good', 'El invitado ha confirmado desde WhatsApp.'],
  revoked: ['Baja registrada', 'bad', 'No se enviarán nuevos avisos. La baja permanece aunque reinicies.'],
  expired: ['Solicitud caducada', 'warn', 'Han pasado los 15 minutos de confirmación. No hay permiso activo.'],
};
const deliveryLabels = {
  pending: ['En espera', '', 'El mensaje está pendiente de envío. No repitas la solicitud.'],
  sending: ['Enviando', '', 'La solicitud está en curso. Espera a que termine.'],
  accepted: ['Aceptado por WhatsApp', '', 'El proveedor lo ha aceptado; esto todavía no confirma su entrega.'],
  sent: ['Enviado', '', 'El proveedor informa de que ha enviado el mensaje.'],
  delivered: ['Entregado', 'good', 'WhatsApp confirma que el mensaje ha llegado al dispositivo.'],
  read: ['Leído', 'good', 'WhatsApp ha informado de su lectura.'],
  unknown: ['Resultado incierto', 'warn', 'No sabemos si se envió. No se reintentará automáticamente: consulta con el equipo.'],
  failed: ['No se pudo enviar', 'bad', 'El proveedor ha rechazado el envío. Consulta con el equipo antes de crear otra solicitud.'],
  cancelled: ['Aviso cancelado', '', 'Puede deberse a una baja, un reinicio, una posición anterior o al límite de 24 horas.'],
  disabled: ['Sin envío', '', 'No hay un mensaje activo para este turno.'],
};
function text(id, value) { if (el(id).textContent !== value) el(id).textContent = value; }
function badge(id, values) { text(id, values[0]); el(id).dataset.tone = values[1]; }
function currentGuest() { return entries.find(entry => entry.confirmation !== 'placeholder'); }
function syncControls() {
  const guest = currentGuest();
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  el('join-fields').disabled = busy || Boolean(guest) || entries.length === 0;
  el('advance').disabled = busy || entries.length === 0;
  el('panel').setAttribute('aria-busy', String(busy));
  text('seed', entries.length ? 'Reiniciar la prueba' : 'Preparar tres turnos');
  text('busy-status', busy ? 'Procesando la acción…' : 'El estado se actualiza automáticamente');
}
function render() {
  const guest = currentGuest();
  if (guest && guest.confirmation === 'revoked') observedWithdrawal = true;
  const step = !entries.length ? 1 : !guest ? 2 : guest.confirmation === 'pending' ? 3 : 4;
  for (const item of document.querySelectorAll('[data-step]')) {
    if (Number(item.dataset.step) === step) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  }
  text('queue-count', entries.length + (entries.length === 1 ? ' turno' : ' turnos'));
  el('queue-empty').hidden = entries.length > 0;
  el('guest-empty').hidden = Boolean(guest);
  el('guest-active').hidden = !guest;
  el('join-hint').hidden = !guest && entries.length > 0;
  text('join-hint', guest ? 'Ya hay un invitado en la prueba. Su estado aparece en el panel del turno.' : 'Primero prepara los tres turnos ficticios del paso 1.');
  text('seed-help', entries.length ? 'El reinicio retira los turnos actuales y cancela sus avisos pendientes.' : 'Empieza con una cola limpia para ver cómo cambia la posición.');
  text('advance-help', !entries.length ? 'Prepara la cola para comenzar.' : !guest ? 'Añade al invitado antes de avanzar para comprobar sus avisos.' : guest.confirmation === 'confirmed' ? 'Cada avance retira al primero y puede enviar la nueva posición al invitado.' : 'La cola puede avanzar, pero sin permiso activo no se enviarán avisos.');
  if (observedWithdrawal) text('withdrawal', 'BAJA registrada durante esta sesión. Ese teléfono seguirá dado de baja aunque reinicies la cola. No se reactivará con CONFIRMO.');
  if (guest) {
    const consent = consentLabels[guest.confirmation] || ['Sin permiso', '', 'No hay autorización activa.'];
    const delivery = deliveryLabels[guest.notification] || deliveryLabels.disabled;
    badge('guest-badge', consent); badge('consent-badge', consent); badge('delivery-badge', delivery);
    text('guest-code', guest.code); text('guest-position', String(guest.position));
    text('guest-ahead', guest.position === 1 ? 'Eres el siguiente' : guest.position === 2 ? '1 turno delante de ti' : (guest.position - 1) + ' turnos delante de ti');
    el('next-warning').hidden = guest.position !== 1;
    text('consent-detail', consent[2]); text('delivery-detail', delivery[2]);
    text('guest-next', guest.confirmation === 'pending' ? 'Abre el WhatsApp de NoQueue y pulsa el botón CONFIRMO o responde CONFIRMO. No basta con recibir el mensaje.' : guest.confirmation === 'confirmed' ? 'Ya puedes avanzar la cola desde los controles del personal y comprobar el siguiente aviso en WhatsApp.' : guest.confirmation === 'revoked' ? 'La baja no elimina el turno. La cola puede seguir avanzando, pero no recibirás nuevos avisos.' : 'La solicitud de confirmación ha caducado. Consulta con el equipo antes de iniciar otra prueba.');
  } else badge('guest-badge', ['Sin turno', '']);
  const snapshot = JSON.stringify(entries);
  if (snapshot !== lastSnapshot) {
    el('entries').replaceChildren(...entries.map(entry => {
      const tester = entry.confirmation !== 'placeholder';
      const row = document.createElement('li'); row.className = 'queue-row'; row.dataset.tester = String(tester);
      const index = document.createElement('span'); index.className = 'queue-index'; index.textContent = entry.position;
      const copy = document.createElement('div'); copy.className = 'queue-copy';
      const title = document.createElement('strong'); title.textContent = tester ? 'Turno del invitado' : 'Turno ficticio';
      const detail = document.createElement('small'); detail.textContent = tester ? entry.code + ' · ' + entry.partySize + ' personas' : 'Sin teléfono · no recibe mensajes';
      copy.append(title,detail);
      const status = document.createElement('span'); status.className = 'badge'; status.textContent = tester ? (consentLabels[entry.confirmation] || ['Sin permiso'])[0] : 'Simulado';
      if (tester) status.dataset.tone = (consentLabels[entry.confirmation] || ['',''])[1];
      row.append(index,copy,status); return row;
    }));
    lastSnapshot = snapshot;
  }
  syncControls();
}
async function api(path, body, key) {
  const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type':'application/json','X-NoQueue-Pilot-Token':access,...(key ? {'Idempotency-Key':key} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'request_failed');
  return data;
}
async function refresh() { const data = await api('/state'); entries = data.entries; render(); }
async function run(operation) {
  if (busy) return;
  busy = true; syncControls(); el('error').hidden = true;
  try { await operation(); }
  catch (error) {
    if (error.message === 'contact_stopped') { observedWithdrawal = true; render(); }
    text('error', errors[error.message] || 'No pudimos comprobar el resultado. Actualiza el estado. Si repites la misma acción sin cambiar sus datos, conservaremos la clave del intento para evitar duplicados.');
    el('error').hidden = false;
  } finally { busy = false; syncControls(); }
}
async function mutate(path, body) {
  const signature = path + JSON.stringify(body);
  if (!keys.has(signature)) keys.set(signature, crypto.randomUUID());
  await api(path, body, keys.get(signature));
  await refresh();
  keys.delete(signature);
  text('announcement','Acción completada. Estado de la cola actualizado.');
}
el('login').onsubmit = event => { event.preventDefault(); run(async () => { access = el('access').value; await refresh(); el('access').value = ''; el('login-wrap').hidden = true; el('panel').hidden = false; }); };
el('seed').onclick = () => { if (entries.length) el('reset-dialog').showModal(); else run(() => mutate('/seed',{})); };
el('reset-cancel').onclick = () => el('reset-dialog').close();
el('reset-confirm').onclick = () => { el('reset-dialog').close(); run(() => mutate('/seed',{})); };
el('advance').onclick = () => run(() => mutate('/advance',{}));
el('refresh').onclick = () => run(refresh);
el('join').onsubmit = event => { event.preventDefault(); run(() => mutate('/queues/confirmation-experiment/entries',{phone:el('phone').value.trim(),partySize:Number(el('party').value),locale:'es',priorContactAuthorization:el('authorized').checked})); };
el('logout').onclick = () => { access = ''; entries = []; lastSnapshot = ''; el('panel').hidden = true; el('login-wrap').hidden = false; el('entries').replaceChildren(); el('phone').value = ''; el('authorized').checked = false; el('error').hidden = true; keys.clear(); el('access').focus(); };
setInterval(async () => { if (!access || busy || el('panel').hidden || el('reset-dialog').open) return; try { await refresh(); } catch { text('busy-status','No se pudo actualizar. Usa «Actualizar estado» para comprobarlo.'); } },4000);
</script></body></html>`
}
