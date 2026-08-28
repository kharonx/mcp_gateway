/** Landing page: Microsoft login, identity self-check, connector onboarding. */
import type { EndpointDef, Toolset } from "../tools/types.js";
import { CHANGELOG } from "./changelog.js";

export interface PortalState {
  configured: boolean;
  baseUrl: string;
  toolCount: number;
  writeToolCount: number;
  capabilities: string[];
  writeCapabilities: string[];
  user?: { name?: string; mail?: string; upn?: string; jobTitle?: string };
  graphOk?: boolean;
  graphError?: string;
  loginError?: string;
}

/**
 * Derive the human-readable capability list from the ACTUALLY enabled tool
 * profile, so the landing page stays truthful when toolsets are toggled in
 * the admin UI or new toolsets are added later. Unknown (future) toolsets
 * fall back to a generic line instead of being silently hidden.
 */
export function buildCapabilities(enabledDefs: EndpointDef[]): {
  capabilities: string[];
  writeCapabilities: string[];
} {
  const on = new Set<Toolset>(enabledDefs.map((d) => d.toolset));
  const lines: string[] = [];

  if (on.has("mail") || on.has("shared-mail")) {
    lines.push("Outlook: levelek, mappák, mellékletek" + (on.has("shared-mail") ? " és megosztott postaládák" : ""));
  }
  if (on.has("calendar"))
    lines.push("Naptár: események, résztvevők, online meetingek, továbbá mások szabad/foglalt elérhetősége és közös időpontkeresés");
  if (on.has("teams")) lines.push("Teams: chatek, csatornaüzenetek, csapatok és tagok");
  if (on.has("meetings")) lines.push("Meetingek: átiratok, felvételek és jelenléti adatok");
  const drives = [on.has("onedrive") ? "OneDrive" : null, on.has("sharepoint") ? "SharePoint" : null].filter(Boolean);
  if (drives.length) lines.push(`${drives.join(" és ")}: fájlok, mappák, listák, keresés és letöltés`);
  const notes = [on.has("onenote") ? "OneNote" : null, on.has("loop") ? "Loop" : null].filter(Boolean);
  if (notes.length) lines.push(`${notes.join(" és ")}: oldalak, jegyzetfüzetek és komponensek`);
  if (on.has("users")) lines.push("Microsoft 365 felhasználók és személyek");
  if (on.has("search")) lines.push("Több forrást átfogó Microsoft 365-keresés");

  // Future-proofing: any toolset without a curated line above still shows up.
  const covered: Toolset[] = ["mail", "shared-mail", "mail-write", "shared-mail-write", "calendar", "calendar-write", "teams", "teams-write", "meetings", "onedrive", "sharepoint", "onenote", "loop", "users", "search"];
  for (const t of on) {
    if (!covered.includes(t)) {
      const count = enabledDefs.filter((d) => d.toolset === t && !d.write).length;
      if (count) lines.push(`${t}: ${count} további képesség`);
    }
  }

  const writeLines: string[] = [];
  if (on.has("mail-write") || on.has("shared-mail-write")) {
    writeLines.push(
      "Outlook-levél piszkozatként létrehozása, elküldése, megválaszolása vagy továbbítása" +
        (on.has("shared-mail-write") ? " (megosztott postaládából is)" : "")
    );
  }
  if (on.has("calendar-write")) {
    writeLines.push("Naptáresemény létrehozása (Teams-meetingként is), módosítása és meghívó megválaszolása");
  }
  if (on.has("teams-write")) {
    writeLines.push("Teams-üzenet küldése chatbe vagy csatornába, illetve válasz csatornaüzenetre");
  }
  for (const t of on) {
    if (!covered.includes(t)) {
      const count = enabledDefs.filter((d) => d.toolset === t && d.write).length;
      if (count) writeLines.push(`${t}: ${count} írási művelet`);
    }
  }
  return { capabilities: lines, writeCapabilities: writeLines };
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function renderPortal(s: PortalState): string {
  const identityCard = s.user
    ? `
  <div class="card">
    <h2>Bejelentkezve ✓</h2>
    <div class="who">
      <div class="avatar">${esc((s.user.name ?? "?").trim().charAt(0).toUpperCase())}</div>
      <div>
        <div class="name">${esc(s.user.name ?? s.user.upn ?? "Ismeretlen felhasználó")}</div>
        <div class="muted">${esc(s.user.mail ?? s.user.upn ?? "")}${s.user.jobTitle ? " · " + esc(s.user.jobTitle) : ""}</div>
      </div>
    </div>
    ${
      s.graphOk
        ? `<p class="ok">✓ Microsoft Graph elérés működik — az AI ezzel a fiókkal, a te M365 jogosultságaiddal fog dolgozni.</p>`
        : `<p class="fail">✗ Graph-teszt sikertelen: ${esc(s.graphError ?? "ismeretlen hiba")}<br>
           <span class="muted">Jellemző ok: hiányzó admin consent az Entra app jogosultságain.</span></p>`
    }
    <p><a class="btn sec" href="/logout">Kijelentkezés</a></p>
  </div>`
    : `
  <div class="card">
    <h2>Bejelentkezés</h2>
    <p>Jelentkezz be a vállalati Microsoft-fiókoddal, hogy ellenőrizd: a gateway a te nevedben,
    a te Microsoft 365 jogosultságaiddal éri el az adatokat.</p>
    ${s.loginError ? `<p class="fail">Sikertelen bejelentkezés: ${esc(s.loginError)}</p>` : ""}
    ${
      s.configured
        ? `<a class="btn" href="/login">🔑 Bejelentkezés Microsoft-fiókkal</a>`
        : `<p class="fail">⚠ A szerver Entra ID beállítása még hiányzik — először az <a href="/admin">admin felületen</a> kell konfigurálni.</p>`
    }
  </div>`;

  const latest = CHANGELOG[0];
  const whatsNewCard = latest
    ? `
<div class="card">
  <h2>🆕 Újdonságok <span class="muted" style="font-weight:400">· ${esc(latest.date)}</span></h2>
  <p><b>${esc(latest.title)}</b></p>
  <ul>
    ${latest.items.slice(0, 3).map((i) => `<li>${esc(i)}</li>`).join("\n    ")}
  </ul>
  <p><a href="/ujdonsagok">Összes újdonság →</a></p>
</div>`
    : "";

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>M365 Reporting MCP Gateway</title>
${PORTAL_STYLE}
</head>
<body>
${renderNav("/")}
<h1>Microsoft 365 Reporting MCP Gateway</h1>
<div class="muted">Read broadly, write narrowly · ${s.toolCount} tool (${s.writeToolCount} írási — csak Outlook levélküldés)</div>

${identityCard}

${whatsNewCard}
${renderPortalBody(s)}`;
}

/** Top navigation shared by every portal page. */
export function renderNav(active: string): string {
  const items: [string, string][] = [
    ["/", "Kezdőoldal"],
    ["/ujdonsagok", "Újdonságok"],
    ["/admin", "Admin"],
  ];
  return `<nav class="topnav">${items
    .map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`)
    .join("")}</nav>`;
}

/** Stylesheet shared by every portal page. */
export const PORTAL_STYLE = `<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 2rem 1.25rem; max-width: 760px; margin-inline: auto; }
  h1 { font-size: 1.5rem; margin-bottom: .2rem; }
  h2 { font-size: 1.05rem; margin-top: 0; }
  .muted { opacity: .7; font-size: .88rem; }
  .card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .8rem; padding: 1.1rem 1.3rem; margin: 1.1rem 0; }
  .btn { display: inline-block; padding: .55rem 1.2rem; border-radius: .55rem; text-decoration: none; font-weight: 600;
         background: #0067b8; color: #fff; }
  .btn.sec { background: transparent; color: inherit; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); }
  .ok { color: #2e7d32; } .fail { color: #c62828; }
  @media (prefers-color-scheme: dark) { .ok { color: #81c784; } .fail { color: #ef9a9a; } }
  .who { display: flex; gap: .9rem; align-items: center; margin: .6rem 0; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; background: #0067b8; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 700; }
  .name { font-weight: 600; font-size: 1.05rem; }
  code.url { display: inline-block; padding: .3rem .55rem; border-radius: .4rem; background: color-mix(in srgb, currentColor 10%, transparent); user-select: all; }
  h3 { font-size: .95rem; margin: 1.1rem 0 .4rem; }
  button.copy { padding: .25rem .7rem; margin-left: .4rem; cursor: pointer; border-radius: .4rem; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: transparent; color: inherit; font-size: .8rem; }
  pre.cmd { padding: .5rem .7rem; border-radius: .4rem; background: color-mix(in srgb, currentColor 10%, transparent); overflow-x: auto; font-size: .85rem; user-select: all; }
  ol li { margin-bottom: .35rem; }
  footer { margin-top: 1.5rem; }
  nav.topnav { display: flex; gap: 1.2rem; margin-bottom: 1.2rem; font-size: .92rem; }
  nav.topnav a { text-decoration: none; color: inherit; opacity: .75; padding-bottom: .15rem; }
  nav.topnav a.active { opacity: 1; font-weight: 600; border-bottom: 2px solid #0067b8; }
</style>`;

/** Landing page body below the identity card (capabilities + client guides). */
function renderPortalBody(s: PortalState): string {
  return `
<div class="card">
  <h2>Mihez fér hozzá az AI ezen a kapcsolaton?</h2>
  <p>Az mcpgw kapcsolaton keresztül az AI a bejelentkezett Microsoft 365-fiókodhoz fér hozzá,
  a saját jogosultságaid keretein belül:</p>
  <ul>
    ${s.capabilities.map((c) => `<li>${esc(c)}</li>`).join("\n    ")}
  </ul>
  ${
    s.writeCapabilities.length
      ? `<p><b>Írási lehetőség szándékosan szűk:</b></p>
  <ul>
    ${s.writeCapabilities.map((c) => `<li>${esc(c)}</li>`).join("\n    ")}
  </ul>
  <p>Küldéshez mindig külön, kifejezett jóváhagyásod kell. Minden egyéb terület csak olvasható —
  módosítás vagy létrehozás ott nem lehetséges.</p>`
      : `<p><b>A gateway jelenleg csak olvasási módban fut</b> — írási művelet nincs engedélyezve.</p>`
  }
  <p class="muted">Az elérés tényleges tartalma attól is függ, hogy a Microsoft 365-fiókodnak
  mihez van jogosultsága — az AI soha nem lát többet, mint te magad.</p>
</div>

<div class="card">
  <h2>AI-kliens csatlakoztatása</h2>
  <p>MCP szerver URL (ezt kell megadni minden kliensben):</p>
  <p><code class="url" id="mcpurl">${esc(s.baseUrl)}/mcp</code>
     <button class="copy" onclick="navigator.clipboard.writeText(document.getElementById('mcpurl').textContent).then(()=>{this.textContent='Másolva ✓';setTimeout(()=>this.textContent='Másolás',1500)})">Másolás</button></p>
  <p class="muted">A csatlakozáskor felugró bejelentkezés a vállalati Microsoft (Entra ID) login —
  mindenki a <b>saját fiókjával</b> lép be, és csak a saját jogosultságait kapja.</p>

  <h3>🟢 ChatGPT (asztali alkalmazás)</h3>
  <ol>
    <li>Indítsd el a <b>ChatGPT alkalmazást</b>.</li>
    <li><b>Szerkesztés</b> menü → <b>Beállítások</b>.</li>
    <li>Bal oldalt keresd meg a <b>Bővítmények</b> (Connectors) menüpontot.</li>
    <li><b>Hozzáadás</b> → <b>MCP-kiszolgáló hozzáadása</b>.</li>
    <li>Kapcsolat típusa: <b>Közvetíthető HTTP</b> (Streamable HTTP), URL: a fenti cím. Adj neki nevet, pl. <i>M365 Reporting</i>.</li>
    <li>Mentés után nyomd meg az <b>MCP-k és hitelesítés</b> gombot → jelentkezz be a vállalati Microsoft-fiókoddal.</li>
    <li>Siker esetén a bővítmény adatlapján megjelenik az elérhető eszközök (toolok) listája.</li>
  </ol>

  <h3>🟠 Claude (claude.ai vagy Claude Desktop)</h3>
  <ol>
    <li>Bal alsó profilmenü → <b>Settings</b> → <b>Connectors</b>.</li>
    <li><b>Add custom connector</b> → Name: pl. <i>M365 Reporting</i>, Remote MCP server URL: a fenti cím → <b>Add</b>.</li>
    <li>A connector mellett <b>Connect</b> → vállalati Microsoft-bejelentkezés → engedélyezés.</li>
    <li>Új beszélgetésben a keresés/eszközök ikonnál kapcsold be a connectort.</li>
  </ol>

  <h3>🟣 Claude Code (terminál)</h3>
  <pre class="cmd">claude mcp add --transport http m365-reporting ${esc(s.baseUrl)}/mcp</pre>
  <ol>
    <li>Futtasd a fenti parancsot (a <code>--scope user</code> kapcsolóval minden projektedben elérhető lesz).</li>
    <li>A Claude Code-ban add ki a <code>/mcp</code> parancsot → <b>Authenticate</b> → böngészős Microsoft-bejelentkezés.</li>
  </ol>

  <p class="muted">Gyors ellenőrzés csatlakozás után: <i>„Listázd a mai naptáramat”</i> — a hívás azonnal
  megjelenik az <a href="/admin">admin Napló</a> fülén is.</p>
</div>

<footer class="muted">
  <a href="/ujdonsagok">Újdonságok</a> · <a href="/admin">Admin felület</a> · <a href="/healthz">Állapot</a> · m365-reporting-mcp v1.0
  <div style="margin-top:.5rem">By Botha Levente @alphavet 2026</div>
</footer>
</body>
</html>`;
}
