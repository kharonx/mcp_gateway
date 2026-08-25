/** Self-contained Hungarian admin dashboard: Beallitasok / Toolok / Naplo. */
export const ADMIN_HTML = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>M365 Reporting MCP – Admin</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 1.25rem; max-width: 1250px; margin-inline: auto; }
  h1 { font-size: 1.25rem; margin: 0 0 .2rem; }
  .muted { opacity: .7; font-size: .85rem; }
  nav { display: flex; gap: .4rem; margin: 1rem 0; flex-wrap: wrap; }
  nav button { padding: .45rem 1rem; cursor: pointer; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; border-radius: .5rem; font-size: .9rem; color: inherit; }
  nav button.active { background: color-mix(in srgb, currentColor 12%, transparent); font-weight: 600; }
  section { display: none; } section.active { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: .82rem; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 22%, transparent); padding: .3rem .5rem; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: Canvas; }
  .wrap { overflow: auto; max-height: 65vh; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .badge { display: inline-block; padding: 0 .45rem; border-radius: .6rem; font-size: .75rem; font-weight: 600; }
  .r { background: #2e7d3222; color: #2e7d32; } .w { background: #c6282822; color: #c62828; }
  .ok { color: #2e7d32; font-weight: 600; } .fail { color: #c62828; font-weight: 600; }
  @media (prefers-color-scheme: dark) { .r{color:#81c784} .w{color:#ef9a9a} .ok{color:#81c784} .fail{color:#ef9a9a} }
  fieldset { border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: .6rem; margin-bottom: 1rem; padding: .8rem 1rem; }
  legend { font-weight: 600; padding-inline: .3rem; }
  label.f { display: block; margin-bottom: .6rem; font-size: .85rem; }
  label.f input[type=text], label.f input[type=password], label.f input[type=number] { display: block; width: 100%; max-width: 480px; padding: .4rem .5rem; margin-top: .15rem; box-sizing: border-box; }
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: .25rem .8rem; font-size: .85rem; }
  button.primary { padding: .5rem 1.2rem; cursor: pointer; font-weight: 600; }
  button.sec { padding: .4rem .9rem; cursor: pointer; }
  .msg { margin-left: .8rem; font-size: .85rem; }
  .filters { display: flex; gap: .5rem; margin-bottom: .6rem; flex-wrap: wrap; align-items: center; }
  .filters input, .filters select { padding: .35rem .5rem; }
  code { font-size: .95em; }
  .keybar { display: flex; gap: .5rem; align-items: center; margin-top: .6rem; }
  .keybar input { padding: .4rem .5rem; }
  .pill { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: .5rem; padding: .5rem .8rem; font-size: .85rem; margin: .2rem 0; display: inline-block; }
</style>
</head>
<body>
<h1>Microsoft 365 Reporting MCP – Admin</h1>
<div class="muted">Read broadly, write narrowly · v1.0</div>
<div class="keybar">
  <input id="key" type="password" placeholder="Admin kulcs (ADMIN_KEY)">
  <button class="sec" onclick="saveKey()">Belépés</button>
  <span id="status" class="muted"></span>
</div>

<nav>
  <button data-tab="settings" class="active" onclick="showTab('settings')">⚙️ Beállítások</button>
  <button data-tab="tools" onclick="showTab('tools')">🧰 Toolok</button>
  <button data-tab="audit" onclick="showTab('audit')">📜 Napló</button>
</nav>

<section id="tab-settings" class="active">
  <fieldset>
    <legend>Microsoft Entra ID</legend>
    <label class="f">Tenant ID <input type="text" id="s-tenantId" placeholder="00000000-0000-…"></label>
    <label class="f">Client ID (app registration) <input type="text" id="s-clientId" placeholder="00000000-0000-…"></label>
    <label class="f">Client Secret <input type="password" id="s-clientSecret" placeholder="(változatlan, ha üresen hagyod)"></label>
    <label class="f">Base URL (publikus cím) <input type="text" id="s-baseUrl" placeholder="https://mcp.ceged.hu"></label>
    <div class="pill">Entra app <b>Redirect URI</b> (Web): <code id="s-redirect">–</code></div>
    <div class="pill">Regisztrált MCP kliensek (ChatGPT stb.): <b id="s-clients">0</b></div>
  </fieldset>
  <fieldset>
    <legend>Profil és limitek</legend>
    <label class="f"><input type="checkbox" id="s-readOnly"> Read-only mód (minden levélküldő tool letiltva)</label>
    <div class="muted" style="margin:.3rem 0">Engedélyezett toolsetek (mind kikapcsolva = az összes engedélyezett):</div>
    <div class="checks" id="s-toolsets"></div>
    <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-top:.8rem">
      <label class="f">Alapért. listaelem <input type="number" id="s-defaultPageItems" min="1"></label>
      <label class="f">Max. listaelem <input type="number" id="s-maxPageItems" min="1"></label>
      <label class="f">Max. letöltés (byte) <input type="number" id="s-maxDownloadBytes" min="1024"></label>
    </div>
  </fieldset>
  <button class="primary" onclick="saveSettings()">Mentés</button>
  <button class="sec" onclick="testConnection()">Entra kapcsolat tesztelése</button>
  <span id="s-msg" class="msg"></span>
  <p class="muted">A mentés azonnal érvénybe lép (újraindítás csak a PORT módosításához kell, az .env-ben).
  ChatGPT csatlakoztatása: új connector → MCP server URL = <code id="s-mcpurl">…/mcp</code> — a bejelentkezés Entra ID-n keresztül történik, a beépített OAuth-proxy intézi a kliens-regisztrációt.</p>
</section>

<section id="tab-tools">
  <div class="filters">
    <input id="t-filter" placeholder="Szűrés névre / endpointra…" oninput="renderTools()">
    <span class="muted" id="t-count"></span>
  </div>
  <div class="wrap"><table><thead>
  <tr><th>Tool</th><th>Toolset</th><th>R/W</th><th>Metódus</th><th>Graph endpoint</th><th>Delegált scope-ok</th></tr>
  </thead><tbody id="t-body"></tbody></table></div>
</section>

<section id="tab-audit">
  <div class="filters">
    <select id="a-day" onchange="loadAudit()"><option value="">Legutóbbi (memória)</option></select>
    <input id="a-user" placeholder="Felhasználó…" onchange="loadAudit()">
    <input id="a-tool" placeholder="Tool…" onchange="loadAudit()">
    <button class="sec" onclick="loadAudit()">Frissítés</button>
    <span class="muted" id="a-count"></span>
  </div>
  <div class="wrap"><table><thead>
  <tr><th>Időpont</th><th>Felhasználó</th><th>Tool</th><th>Művelet</th><th>Graph endpoint</th><th>Eredmény</th><th>ms</th><th>Címzettek / hiba</th></tr>
  </thead><tbody id="a-body"></tbody></table></div>
  <p class="muted">A napló csak metaadatot tartalmaz – levéltörzs, átirat, dokumentumtartalom és token soha nem kerül bele.</p>
</section>

<script>
let TOOLS = [];
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function api(p, opts){
  const r = await fetch(p, Object.assign({ headers: { 'x-admin-key': localStorage.adminKey || '', 'content-type': 'application/json' } }, opts||{}));
  if (r.status === 401) throw new Error('Hibás admin kulcs');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function showTab(t){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.tab===t));
  document.querySelectorAll('section').forEach(s=>s.classList.toggle('active', s.id==='tab-'+t));
}
async function loadSettings(){
  const s = await api('/admin/api/settings');
  document.getElementById('s-tenantId').value = s.tenantId || '';
  document.getElementById('s-clientId').value = s.clientId || '';
  document.getElementById('s-clientSecret').placeholder = s.clientSecretSet ? '******** (változatlan, ha üresen hagyod)' : 'kötelező a működéshez';
  document.getElementById('s-baseUrl').value = s.baseUrl || '';
  document.getElementById('s-redirect').textContent = s.redirectUri;
  document.getElementById('s-clients').textContent = s.registeredMcpClients;
  document.getElementById('s-mcpurl').textContent = s.baseUrl + '/mcp';
  document.getElementById('s-readOnly').checked = !!s.readOnly;
  document.getElementById('s-defaultPageItems').value = s.defaultPageItems;
  document.getElementById('s-maxPageItems').value = s.maxPageItems;
  document.getElementById('s-maxDownloadBytes').value = s.maxDownloadBytes;
  const box = document.getElementById('s-toolsets');
  box.innerHTML = s.toolsetsAvailable.map(t =>
    '<label><input type="checkbox" name="ts" value="'+t+'"'+(s.enabledToolsets && s.enabledToolsets.includes(t)?' checked':'')+'> '+t+'</label>').join('');
  document.getElementById('status').textContent = s.configured ? 'Entra ID konfigurálva ✓' : '⚠ Entra ID még nincs beállítva';
}
async function saveSettings(){
  const checked = [...document.querySelectorAll('input[name=ts]:checked')].map(c=>c.value);
  const body = {
    tenantId: document.getElementById('s-tenantId').value,
    clientId: document.getElementById('s-clientId').value,
    clientSecret: document.getElementById('s-clientSecret').value,
    baseUrl: document.getElementById('s-baseUrl').value,
    readOnly: document.getElementById('s-readOnly').checked,
    enabledToolsets: checked.length ? checked : null,
    defaultPageItems: +document.getElementById('s-defaultPageItems').value,
    maxPageItems: +document.getElementById('s-maxPageItems').value,
    maxDownloadBytes: +document.getElementById('s-maxDownloadBytes').value,
  };
  const m = document.getElementById('s-msg');
  try { await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    m.textContent = 'Mentve ✓'; m.className = 'msg ok';
    document.getElementById('s-clientSecret').value = '';
    await loadSettings(); await loadTools();
  } catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
async function testConnection(){
  const m = document.getElementById('s-msg');
  m.textContent = 'Tesztelés…'; m.className = 'msg muted';
  try { const r = await api('/admin/api/test-connection', { method: 'POST', body: '{}' });
    m.textContent = (r.ok ? '✓ ' : '✗ ') + r.message; m.className = 'msg ' + (r.ok ? 'ok' : 'fail');
  } catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
async function loadTools(){ TOOLS = await api('/admin/api/tools'); renderTools(); }
function renderTools(){
  const q = (document.getElementById('t-filter').value || '').toLowerCase();
  const rows = TOOLS.filter(t => !q || t.name.includes(q) || t.path.toLowerCase().includes(q) || t.toolset.includes(q));
  document.getElementById('t-body').innerHTML = rows.map(t =>
    '<tr title="'+esc(t.description)+'"><td><code>'+esc(t.name)+'</code></td><td>'+esc(t.toolset)+'</td>'+
    '<td><span class="badge '+(t.write?'w':'r')+'">'+(t.write?'WRITE':'READ')+'</span></td>'+
    '<td>'+esc(t.method)+'</td><td><code>'+esc(t.path)+'</code></td><td>'+esc(t.scopes.join(', '))+'</td></tr>').join('');
  document.getElementById('t-count').textContent = rows.length + ' / ' + TOOLS.length + ' tool';
}
async function loadAuditDays(){
  const days = await api('/admin/api/audit/days');
  const sel = document.getElementById('a-day');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Legutóbbi (memória)</option>' + days.map(d=>'<option>'+d+'</option>').join('');
  sel.value = cur;
}
async function loadAudit(){
  const p = new URLSearchParams({ limit: '500' });
  const day = document.getElementById('a-day').value; if (day) p.set('day', day);
  const u = document.getElementById('a-user').value; if (u) p.set('user', u);
  const t = document.getElementById('a-tool').value; if (t) p.set('tool', t);
  const audit = await api('/admin/api/audit?' + p);
  document.getElementById('a-body').innerHTML = audit.map(a =>
    '<tr><td>'+esc((a.timestamp||'').replace('T',' ').slice(0,19))+'</td><td>'+esc(a.user)+'</td><td><code>'+esc(a.tool)+'</code></td>'+
    '<td><span class="badge '+(a.operation==='WRITE'?'w':'r')+'">'+esc(a.operation)+'</span></td>'+
    '<td><code>'+esc(a.httpMethod+' '+a.graphEndpoint)+'</code></td>'+
    '<td class="'+(a.success?'ok':'fail')+'">'+(a.success?'OK':'HIBA')+'</td><td>'+esc(a.durationMs)+'</td>'+
    '<td>'+esc(a.recipients ? a.recipients.join(', ') : (a.error || ''))+'</td></tr>').join('');
  document.getElementById('a-count').textContent = audit.length + ' bejegyzés';
}
async function loadAll(){
  const st = document.getElementById('status');
  try { await loadSettings(); await loadTools(); await loadAuditDays(); await loadAudit(); }
  catch(e){ st.textContent = 'Hiba: ' + e.message; }
}
function saveKey(){ localStorage.adminKey = document.getElementById('key').value; loadAll(); }
if (localStorage.adminKey) loadAll();
</script>
</body>
</html>`;
