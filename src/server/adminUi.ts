/** Self-contained Hungarian admin dashboard: Beallitasok / Toolok / Naplo. */
export const ADMIN_HTML = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AV MCP Gateway – Admin</title>
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
  dialog { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: .7rem; padding: 1rem 1.2rem; max-width: 620px; width: calc(100% - 2rem); background: Canvas; color: inherit; }
  dialog::backdrop { background: rgba(0,0,0,.35); }
  .acc-summary { font-size: .8rem; line-height: 1.35; }
  .badge.b { background: #6d4c4122; color: #6d4c41; } @media (prefers-color-scheme: dark) { .badge.b { color: #d7ccc8; } }
</style>
</head>
<body>
<h1>AV MCP Gateway – Admin</h1>
<div class="muted">Read broadly, write narrowly · <a href="/">← Kezdőoldal</a> · <a href="/ujdonsagok">Újdonságok</a></div>
<div class="keybar" id="authbar">
  <span class="muted">Betöltés…</span>
</div>
<div class="keybar" id="keybar" style="display:none">
  <input id="key" type="password" placeholder="Admin kulcs (ADMIN_KEY)">
  <button class="sec" id="keybtn" onclick="saveKey()">Belépés kulccsal</button>
  <span id="status" class="muted"></span>
</div>

<nav>
  <button data-tab="settings" class="active" onclick="showTab('settings')">⚙️ Beállítások</button>
  <button data-tab="users" onclick="showTab('users')">👥 Felhasználók</button>
  <button data-tab="tools" onclick="showTab('tools')">🧰 Toolok</button>
  <button data-tab="audit" onclick="showTab('audit')">📜 Napló</button>
</nav>

<section id="tab-users">
  <div class="filters">
    <input id="u-filter" placeholder="Szűrés névre / e-mailre…" oninput="renderUsers()">
    <button class="sec" onclick="loadUsers()">Frissítés</button>
    <span class="muted" id="u-count"></span>
  </div>
  <div class="wrap"><table><thead>
  <tr><th>Név</th><th>Felhasználó (UPN)</th><th>Első belépés</th><th>Utolsó aktivitás</th><th>MCP-hívás</th><th>Jogosultság</th><th>Salesforce</th><th>Admin</th></tr>
  </thead><tbody id="u-body"></tbody></table></div>
  <p class="muted">Itt mindenki megjelenik, aki a kezdőoldalon Microsoft-fiókkal bejelentkezett vagy MCP-kliensből hívta a gatewayt.
  Admin jogot csak már belépett felhasználó kaphat; az utolsó admin joga nem vonható vissza. A Salesforce-oszlopban egy felhasználó
  összekötése bontható (a Salesforce refresh token visszavonásra kerül) — újra összekötni csak ő maga tudja a kezdőoldalon.</p>
  <p class="muted"><b>Jogosultság:</b> felhasználónként szűkíthető, mely toolseteket használhatja az AI a nevében (a gateway-szintű
  toolset-kapcsolókon belül), tiltható nála minden írás, vagy letiltható az MCP-hozzáférése teljesen. Akinek nincs egyéni profilja,
  arra a Beállítások fülön megadott <b>alapértelmezett felhasználói jogosultság</b> vonatkozik. A változás a következő MCP-hívástól él;
  a kliens cache-elt tool-listája miatt az AI-nak újra kell kötnie a connectort, hogy az új listát lássa.</p>

  <dialog id="u-dialog">
    <h3 style="margin:0 0 .2rem" id="ua-title">Jogosultság</h3>
    <div class="muted" id="ua-sub" style="margin-bottom:.8rem"></div>
    <label class="f"><input type="radio" name="ua-mode" value="all" checked> Minden, a gatewayen engedélyezett toolset</label>
    <label class="f"><input type="radio" name="ua-mode" value="custom"> Csak a kijelölt toolsetek:</label>
    <div class="checks" id="ua-toolsets" style="margin:.2rem 0 .8rem 1.4rem"></div>
    <label class="f"><input type="checkbox" id="ua-readOnly"> Csak olvasás — minden írási tool tiltva ennél a felhasználónál</label>
    <label class="f"><input type="checkbox" id="ua-blocked"> MCP-hozzáférés letiltva — az AI-kliens hívásai 403-mal elutasítva</label>
    <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.8rem; align-items:center">
      <button class="primary" onclick="saveAccess()">Mentés</button>
      <button class="sec" onclick="resetAccess()">Alapértelmezettre állítás</button>
      <button class="sec" onclick="document.getElementById('u-dialog').close()">Mégse</button>
      <span class="msg" id="ua-msg"></span>
    </div>
  </dialog>
</section>

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
    <label class="f"><input type="checkbox" id="s-readOnly"> Read-only mód (minden írási tool letiltva az egész gatewayen)</label>
    <div class="muted" style="margin:.3rem 0">Gateway-szinten engedélyezett toolsetek (mind kikapcsolva = az összes engedélyezett; a <code>salesforce-delete</code> csak bepipálva él):</div>
    <div class="checks" id="s-toolsets"></div>
    <div class="muted" style="margin:1rem 0 .3rem"><b>Alapértelmezett felhasználói jogosultság</b> — azokra vonatkozik, akiknek a Felhasználók fülön nincs egyéni profiljuk (új belépők is):</div>
    <label class="f"><input type="radio" name="s-dua-mode" value="all" checked> Minden, a gatewayen engedélyezett toolset</label>
    <label class="f"><input type="radio" name="s-dua-mode" value="custom"> Csak a kijelölt toolsetek:</label>
    <div class="checks" id="s-dua-toolsets" style="margin:.2rem 0 .6rem 1.4rem"></div>
    <label class="f"><input type="checkbox" id="s-duaReadOnly"> Csak olvasás alapból (írási toolt csak egyéni profillal kap valaki)</label>
    <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-top:.8rem">
      <label class="f">Alapért. listaelem <input type="number" id="s-defaultPageItems" min="1"></label>
      <label class="f">Max. listaelem <input type="number" id="s-maxPageItems" min="1"></label>
      <label class="f">Max. letöltés (byte) <input type="number" id="s-maxDownloadBytes" min="1024"></label>
    </div>
  </fieldset>
  <fieldset>
    <legend>Salesforce (opcionális)</legend>
    <p class="muted" style="margin-top:0">Ha kitöltöd, megjelenik a <code>salesforce</code> (olvasás: SOQL/SOSL, rekordok, riportok)
    és a <code>salesforce-write</code> toolset (írás: feladat, esemény, rekord létrehozása és módosítása, Chatter, jegyzet — minden írás <code>confirm=true</code>-hoz kötött).
    A <code>salesforce-delete</code> toolset (rekord törlése a Lomtárba) <b>alapból ki van kapcsolva</b>: csak akkor él, ha a fenti toolset-listában kifejezetten bepipálod — ugyanúgy, ahogy a Salesforce saját hosted MCP-jében az „SObject Deletes” szerver külön kapcsolható.
    Az írás a fenti toolset-listában külön ki-be kapcsolható, a globális csak-olvasás mód pedig letiltja.
    Minden felhasználó a kezdőoldalon a <b>saját</b> Salesforce-fiókját köti össze — a gateway sosem lát többet, mint az adott felhasználó.
    Üresen hagyott Consumer Key = integráció kikapcsolva.</p>
    <div class="pill" style="display:block; max-width:640px">
      <b>1. lépés — ezt másold a Salesforce Connected App „Callback URL” mezőjébe</b> (a gateway saját címe, itt nem szerkeszthető):<br>
      <input type="text" id="s-sfCallback" readonly value="–" style="width:100%; max-width:520px; margin-top:.3rem; padding:.35rem .5rem; box-sizing:border-box" onclick="this.select()">
      <button class="sec" type="button" onclick="navigator.clipboard.writeText(document.getElementById('s-sfCallback').value).then(()=>{this.textContent='Másolva ✓';setTimeout(()=>this.textContent='Másolás',1500)})">Másolás</button>
    </div>
    <p class="muted" style="margin:.6rem 0 .4rem"><b>2. lépés — a Connected App adatai:</b></p>
    <label class="f">Consumer Key (Connected App) <input type="text" id="s-sfClientId" placeholder="Consumer Key"></label>
    <label class="f">Consumer Secret <input type="password" id="s-sfClientSecret" placeholder="(változatlan, ha üresen hagyod)"></label>
    <label class="f">Salesforce Login URL <span class="muted">— a Salesforce bejelentkezési domainje, <u>nem</u> a callback</span>
      <input type="text" id="s-sfLoginUrl" placeholder="https://login.salesforce.com (sandbox: https://test.salesforce.com, My Domain: https://ceg.my.salesforce.com)"></label>
    <label class="f">OAuth scope-ok <input type="text" id="s-sfScopes" placeholder="api refresh_token"></label>
    <label class="f">REST API verzió <input type="text" id="s-sfApiVersion" placeholder="v62.0"></label>
    <div class="pill">Összekötött felhasználók: <b id="s-sfUsers">0</b></div>
    <div class="pill" id="s-sfState">–</div>
    <div style="margin-top:.6rem"><button class="sec" onclick="testSalesforce()">Salesforce kapcsolat tesztelése</button> <span id="s-sfmsg" class="msg"></span></div>
    <ul id="s-sfchecks" class="muted" style="margin:.4rem 0 0; padding-left:1.2rem"></ul>
  </fieldset>
  <fieldset>
    <legend>TT MCP — Vectory / AP2 (opcionális)</legend>
    <p class="muted" style="margin-top:0">Ha kitöltöd, megjelenik a <code>vectory</code> toolset: a TT MCP-szerver (tt.dokiforvet.hu) tooljai a gatewayen keresztül —
    ügyfélkeresés, teljes ügyfélkép, Vectory-számlák és tételek, AP2-számlák, Alphaportal ticketek, befizetések, licenc-audit. <b>Csak olvasás.</b>
    A TT-t közös API-kulccsal éri el a gateway (nem személyes jogosultság), ezért a toolsetet a Felhasználók fülön érdemes név szerint kiosztani.
    A toollista a TT-ről töltődik be induláskor és mentéskor. Üresen hagyott kulcs = integráció kikapcsolva.</p>
    <label class="f">TT MCP URL <input type="text" id="s-ttUrl" placeholder="https://tt.dokiforvet.hu/mcp"></label>
    <label class="f">TT API-kulcs (Mcp:ApiKey) <input type="password" id="s-ttKey" placeholder="(változatlan, ha üresen hagyod)"></label>
    <div class="pill" id="s-ttState">–</div>
    <div style="margin-top:.6rem"><button class="sec" onclick="testTt()">TT kapcsolat tesztelése</button> <span id="s-ttmsg" class="msg"></span></div>
    <div id="s-tttools" class="muted" style="margin-top:.4rem; font-size:.8rem"></div>
  </fieldset>
  <fieldset>
    <legend>Vectory SQL replika — közvetlen, csak olvasás (opcionális)</legend>
    <p class="muted" style="margin-top:0">Ha kitöltöd, megjelenik a <code>vectory-sql</code> toolset: paraméterezett lekérdezések közvetlenül a Vectory replikán
    (<code>meditrade</code>, ugyanazon a kapcsolaton az <code>alphavet.dbo.*</code> táblák is): ügyfélkeresés, ügyfélkártya kontaktokkal és licencekkel, számlák sztornó-státusszal,
    számlatételek szoftver-kategóriával, szoftver-lefedettség, forgalom és ügyfélszint, befizetés dátuma, termékkeresés, AP2-számlák és tételek, plusz egy ellenőrzött szabad SELECT.
    <b>Csak olvasás:</b> a gateway minden lekérdezést ellenőriz (egyetlen SELECT, tiltott kulcsszavak nélkül, sorlimit), de a védelem alapja a
    <b>csak olvasó SQL-felhasználó</b> (db_datareader) — a TT <code>sysdba</code> loginját ne add meg ide. Belső hálón <code>Encrypt</code> kikapcsolva.</p>
    <div style="display:flex; gap:1rem; flex-wrap:wrap">
      <label class="f">SQL szerver <input type="text" id="s-sqlServer" placeholder="sqlreplica.alpha-vet.hu"></label>
      <label class="f">Port <input type="number" id="s-sqlPort" placeholder="1433" min="1" max="65535"></label>
      <label class="f">Adatbázis <input type="text" id="s-sqlDatabase" placeholder="meditrade"></label>
    </div>
    <label class="f">SQL felhasználó (csak olvasó) <input type="text" id="s-sqlUser" placeholder="mcp_reader"></label>
    <label class="f">SQL jelszó <input type="password" id="s-sqlPassword" placeholder="(változatlan, ha üresen hagyod)"></label>
    <label class="f"><input type="checkbox" id="s-sqlEncrypt"> Titkosított kapcsolat (Encrypt=true; belső hálón általában ki)</label>
    <div class="pill" id="s-sqlState">–</div>
    <div style="margin-top:.6rem"><button class="sec" onclick="testSql()">SQL kapcsolat tesztelése</button> <span id="s-sqlmsg" class="msg"></span></div>
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

<footer class="muted" style="margin-top:1.5rem">By Botha Levente @alphavet 2026</footer>

<script>
let TOOLS = [];
let ME = {};
let USERS = [];
let TOOLSETS_AVAILABLE = [];
let EDIT_OID = null;
function renderToolsetChecks(el, name, selected){
  el.innerHTML = TOOLSETS_AVAILABLE.map(t => '<label><input type="checkbox" name="'+name+'" value="'+t+'"'+(selected && selected.includes(t)?' checked':'')+'> '+t+'</label>').join('');
}
function accessSummary(u){
  const a = u.access, e = u.effectiveAccess || {};
  if (e.blocked) return '<span class="badge b">LETILTVA</span>';
  const parts = [];
  parts.push(e.toolsets ? e.toolsets.length + ' toolset' : 'minden toolset');
  if (e.readOnly) parts.push('csak olvasás');
  return '<span class="acc-summary">'+(a ? '<b>egyéni</b>' : '<span class="muted">alapértelmezett</span>')+'<br>'+esc(parts.join(', '))+'<br><span class="muted">'+esc(u.effectiveToolCount)+' tool</span></span>';
}
function editAccess(oid){
  const u = USERS.find(x => x.oid === oid); if (!u) return; EDIT_OID = oid;
  const a = u.access || u.effectiveAccess || { toolsets: null, readOnly: false };
  document.getElementById('ua-title').textContent = 'Jogosultság: ' + (u.name || u.upn || oid);
  document.getElementById('ua-sub').textContent = (u.upn || '') + (u.access ? ' · egyéni profil, beállította: ' + (u.access.setBy || '?') + ' ' + fmt(u.access.setAt) : ' · jelenleg az alapértelmezett profil vonatkozik rá');
  document.querySelector('input[name=ua-mode][value=' + (a.toolsets ? 'custom' : 'all') + ']').checked = true;
  renderToolsetChecks(document.getElementById('ua-toolsets'), 'ua-ts', a.toolsets || []);
  document.getElementById('ua-readOnly').checked = !!a.readOnly;
  document.getElementById('ua-blocked').checked = !!a.blocked;
  document.getElementById('ua-msg').textContent = '';
  document.getElementById('u-dialog').showModal();
}
async function saveAccess(){
  const custom = document.querySelector('input[name=ua-mode]:checked').value === 'custom';
  const toolsets = custom ? [...document.querySelectorAll('input[name=ua-ts]:checked')].map(c => c.value) : null;
  const body = { access: { toolsets, readOnly: document.getElementById('ua-readOnly').checked, blocked: document.getElementById('ua-blocked').checked } };
  const m = document.getElementById('ua-msg');
  try { await api('/admin/api/users/' + encodeURIComponent(EDIT_OID), { method: 'PUT', body: JSON.stringify(body) }); document.getElementById('u-dialog').close(); await loadUsers(); }
  catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
async function resetAccess(){
  const m = document.getElementById('ua-msg');
  try { await api('/admin/api/users/' + encodeURIComponent(EDIT_OID), { method: 'PUT', body: JSON.stringify({ access: null }) }); document.getElementById('u-dialog').close(); await loadUsers(); }
  catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(d){ return d ? String(d).replace('T',' ').slice(0,16) : '–'; }
async function api(p, opts){
  const r = await fetch(p, Object.assign({ credentials: 'same-origin', headers: { 'x-admin-key': localStorage.adminKey || '', 'content-type': 'application/json' } }, opts||{}));
  if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j.error) m = j.error; } catch(e){} throw new Error(m); }
  return r.json();
}
async function loadMe(){
  ME = await api('/admin/api/me');
  const bar = document.getElementById('authbar'); const kb = document.getElementById('keybar');
  if (ME.isAdmin) {
    bar.innerHTML = '<span class="ok">Bejelentkezve adminként: ' + esc(ME.name || ME.upn) + '</span> <span class="muted">(' + esc(ME.upn||'') + ')</span> · <a href="/logout">Kijelentkezés</a>';
    kb.style.display = 'none';
  } else if (ME.loggedIn) {
    bar.innerHTML = '<span>Bejelentkezve: <b>' + esc(ME.name || ME.upn) + '</b> — <span class="fail">nem admin</span>.</span> <span class="muted">Kérj admin jogot egy admintól, vagy add meg az admin kulcsot, és adminná válsz:</span>';
    kb.style.display = 'flex'; document.getElementById('keybtn').textContent = 'Adminná válok az admin kulccsal';
  } else {
    bar.innerHTML = (ME.entraConfigured ? '<a class="sec" style="padding:.4rem .9rem;border:1px solid currentColor;border-radius:.5rem;text-decoration:none;color:inherit" href="/login?next=/admin">🔑 Bejelentkezés Microsoft-fiókkal</a> <span class="muted">(adminként nem kell kulcs)</span>' : '<span class="muted">Entra ID még nincs beállítva — első beállítás az admin kulccsal:</span>');
    kb.style.display = 'flex'; document.getElementById('keybtn').textContent = 'Belépés kulccsal';
  }
  return ME;
}
async function saveKey(){
  const key = document.getElementById('key').value;
  const st = document.getElementById('status');
  if (ME.loggedIn && !ME.isAdmin) {
    try { await api('/admin/api/claim-admin', { method: 'POST', body: JSON.stringify({ key }) }); st.textContent = 'Admin jog megadva ✓'; st.className = 'ok'; document.getElementById('key').value=''; await loadMe(); await loadAll(); }
    catch(e){ st.textContent = e.message; st.className = 'fail'; }
    return;
  }
  localStorage.adminKey = key; loadAll();
}
async function loadUsers(){ USERS = await api('/admin/api/users'); renderUsers(); }
function renderUsers(){
  const q = (document.getElementById('u-filter').value || '').toLowerCase();
  const rows = USERS.filter(u => !q || (u.name||'').toLowerCase().includes(q) || (u.upn||'').toLowerCase().includes(q));
  document.getElementById('u-body').innerHTML = rows.map(u =>
    '<tr><td>'+esc(u.name||'–')+'</td><td>'+esc(u.upn||u.oid)+'</td><td>'+esc(fmt(u.firstSeenAt))+'</td><td>'+esc(fmt(u.lastSeenAt))+'</td><td>'+esc(u.mcpRequests||0)+'</td>'+
    '<td>'+accessSummary(u)+'<br><button class="sec" data-oid="'+esc(u.oid)+'" onclick="editAccess(this.dataset.oid)">Szerkesztés</button></td>'+
    '<td>'+(u.salesforce ? '<span class="ok">✓</span> '+esc(u.salesforce.username||u.salesforce.userId)+'<br><span class="muted">'+esc(u.salesforce.instanceUrl)+' · '+esc(fmt(u.salesforce.connectedAt))+'</span><br><button class="sec" onclick="disconnectSf(\\''+u.oid+'\\')">Kapcsolat bontása</button>' : '<span class="muted">nincs</span>')+'</td>'+
    '<td>'+(u.isAdmin ? '<span class="badge w">ADMIN</span><br><span class="muted">'+esc(u.adminGrantedBy||'')+'</span><br><button class="sec" onclick="setAdmin(\\''+u.oid+'\\',false)">Admin jog elvétele</button>' : '<button class="sec" onclick="setAdmin(\\''+u.oid+'\\',true)">Adminná tesz</button>')+'</td></tr>').join('');
  document.getElementById('u-count').textContent = rows.length + ' / ' + USERS.length + ' felhasználó';
}
async function setAdmin(oid, isAdmin){
  try { await api('/admin/api/users/' + encodeURIComponent(oid), { method: 'PUT', body: JSON.stringify({ isAdmin }) }); await loadUsers(); await loadMe(); }
  catch(e){ alert('Hiba: ' + e.message); }
}
async function disconnectSf(oid){
  try { await api('/admin/api/users/' + encodeURIComponent(oid) + '/salesforce', { method: 'DELETE' }); await loadUsers(); }
  catch(e){ alert('Hiba: ' + e.message); }
}
async function testSql(){
  const m = document.getElementById('s-sqlmsg');
  m.textContent = 'Tesztelés…'; m.className = 'msg muted';
  try { const r = await api('/admin/api/test-sql', { method: 'POST', body: '{}' });
    m.textContent = (r.ok ? '✓ ' : '✗ ') + r.message; m.className = 'msg ' + (r.ok ? 'ok' : 'fail');
  } catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
async function testTt(){
  const m = document.getElementById('s-ttmsg');
  m.textContent = 'Tesztelés…'; m.className = 'msg muted';
  try { const r = await api('/admin/api/test-tt', { method: 'POST', body: '{}' });
    m.textContent = (r.ok ? '✓ ' : '✗ ') + r.message; m.className = 'msg ' + (r.ok ? 'ok' : 'fail');
    document.getElementById('s-tttools').textContent = (r.tools || []).join(', ');
    await loadTools();
  } catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
}
async function testSalesforce(){
  const m = document.getElementById('s-sfmsg'); const ul = document.getElementById('s-sfchecks');
  m.textContent = 'Tesztelés…'; m.className = 'msg muted'; ul.innerHTML = '';
  try { const r = await api('/admin/api/test-salesforce', { method: 'POST', body: '{}' });
    m.textContent = r.ok ? '✓ Salesforce Connected App rendben' : '✗ Hiba a Salesforce-beállításban'; m.className = 'msg ' + (r.ok ? 'ok' : 'fail');
    ul.innerHTML = r.checks.map(c => '<li class="'+(c.ok===true?'ok':c.ok===false?'fail':'muted')+'">'+(c.ok===true?'✓ ':c.ok===false?'✗ ':'• ')+esc(c.message)+'</li>').join('');
  } catch(e){ m.textContent = 'Hiba: ' + e.message; m.className = 'msg fail'; }
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
  const sf = s.salesforce || {};
  document.getElementById('s-sfClientId').value = sf.clientId || '';
  document.getElementById('s-sfClientSecret').placeholder = sf.clientSecretSet ? '******** (változatlan, ha üresen hagyod)' : 'Consumer Secret';
  document.getElementById('s-sfLoginUrl').value = sf.loginUrl || '';
  document.getElementById('s-sfScopes').value = sf.scopes || '';
  document.getElementById('s-sfApiVersion').value = sf.apiVersion || '';
  document.getElementById('s-sfCallback').value = sf.callbackUrl || '–';
  document.getElementById('s-sfUsers').textContent = sf.connectedUsers || 0;
  document.getElementById('s-sfState').textContent = sf.configured ? 'Salesforce toolset aktív ✓' : 'Salesforce integráció kikapcsolva';
  const tt = s.tt || {};
  document.getElementById('s-ttUrl').value = tt.url || '';
  document.getElementById('s-ttKey').placeholder = tt.apiKeySet ? '******** (változatlan, ha üresen hagyod)' : 'Mcp:ApiKey';
  document.getElementById('s-ttState').textContent = !tt.configured ? 'TT integráció kikapcsolva' : tt.error ? 'TT hiba: ' + tt.error : 'vectory toolset aktív ✓ (' + (tt.toolCount||0) + ' tool)';
  document.getElementById('s-tttools').textContent = (tt.tools || []).join(', ');
  const sq = s.sql || {};
  document.getElementById('s-sqlServer').value = sq.server || '';
  document.getElementById('s-sqlPort').value = sq.port || 1433;
  document.getElementById('s-sqlDatabase').value = sq.database || '';
  document.getElementById('s-sqlUser').value = sq.user || '';
  document.getElementById('s-sqlPassword').placeholder = sq.passwordSet ? '******** (változatlan, ha üresen hagyod)' : 'jelszó';
  document.getElementById('s-sqlEncrypt').checked = !!sq.encrypt;
  document.getElementById('s-sqlState').textContent = sq.configured ? 'vectory-sql toolset aktív ✓' : 'Vectory SQL integráció kikapcsolva';
  TOOLSETS_AVAILABLE = s.toolsetsAvailable || [];
  renderToolsetChecks(document.getElementById('s-toolsets'), 'ts', s.enabledToolsets || []);
  const dua = s.defaultUserAccess || { toolsets: null, readOnly: false };
  document.querySelector('input[name=s-dua-mode][value=' + (dua.toolsets ? 'custom' : 'all') + ']').checked = true;
  renderToolsetChecks(document.getElementById('s-dua-toolsets'), 'dua-ts', dua.toolsets || []);
  document.getElementById('s-duaReadOnly').checked = !!dua.readOnly;
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
    defaultUserToolsets: document.querySelector('input[name=s-dua-mode]:checked').value === 'custom' ? [...document.querySelectorAll('input[name=dua-ts]:checked')].map(c=>c.value) : null,
    defaultUserReadOnly: document.getElementById('s-duaReadOnly').checked,
    defaultPageItems: +document.getElementById('s-defaultPageItems').value,
    maxPageItems: +document.getElementById('s-maxPageItems').value,
    maxDownloadBytes: +document.getElementById('s-maxDownloadBytes').value,
    salesforceClientId: document.getElementById('s-sfClientId').value,
    salesforceClientSecret: document.getElementById('s-sfClientSecret').value,
    salesforceLoginUrl: document.getElementById('s-sfLoginUrl').value,
    salesforceScopes: document.getElementById('s-sfScopes').value,
    salesforceApiVersion: document.getElementById('s-sfApiVersion').value,
    ttMcpUrl: document.getElementById('s-ttUrl').value,
    ttMcpApiKey: document.getElementById('s-ttKey').value,
    sqlServer: document.getElementById('s-sqlServer').value,
    sqlPort: +document.getElementById('s-sqlPort').value || 1433,
    sqlDatabase: document.getElementById('s-sqlDatabase').value,
    sqlUser: document.getElementById('s-sqlUser').value,
    sqlPassword: document.getElementById('s-sqlPassword').value,
    sqlEncrypt: document.getElementById('s-sqlEncrypt').checked,
  };
  const m = document.getElementById('s-msg');
  try { await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    m.textContent = 'Mentve ✓'; m.className = 'msg ok';
    document.getElementById('s-clientSecret').value = '';
    document.getElementById('s-sfClientSecret').value = '';
    document.getElementById('s-ttKey').value = '';
    document.getElementById('s-sqlPassword').value = '';
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
  try { await loadSettings(); await loadUsers(); await loadTools(); await loadAuditDays(); await loadAudit(); st.textContent = ''; }
  catch(e){ st.textContent = e.message; st.className = 'fail'; }
}
loadMe().then(me => { if (me.isAdmin || me.viaKey || localStorage.adminKey) loadAll(); }).catch(e => { document.getElementById('authbar').textContent = 'Hiba: ' + e.message; });
</script>
</body>
</html>`;
