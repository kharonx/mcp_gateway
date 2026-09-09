/** Landing page: Microsoft login, identity self-check, connector onboarding. */
import type { EndpointDef, Toolset } from "../tools/types.js";
import { CHANGELOG } from "./changelog.js";

export interface PortalState {
  configured: boolean;
  baseUrl: string;
  toolCount: number;
  writeToolCount: number;
  /** Per-platform access description (Microsoft 365, Salesforce, ...) derived from the enabled tool profile. */
  platforms: PlatformCapabilities[];
  user?: { name?: string; mail?: string; upn?: string; jobTitle?: string; isAdmin?: boolean };
  graphOk?: boolean;
  graphError?: string;
  loginError?: string;
  /** True when the optional Salesforce WRITE toolset is enabled (changes what we promise on this page). */
  salesforceWrite?: boolean;
  /** Present only when the optional Salesforce Connected App is configured. */
  salesforce?: {
    connected: boolean;
    info?: { instanceUrl: string; username?: string; name?: string; email?: string; connectedAt: string };
    loginUrl: string;
    error?: string;
    justConnected?: boolean;
    justDisconnected?: boolean;
  };
}

/** One integrated platform as shown on the landing page. */
export interface PlatformCapabilities {
  key: "m365" | "salesforce";
  name: string;
  /** How the AI gets access on this platform (login model). */
  access: string;
  read: string[];
  write: string[];
  /** Shown when the platform has no write toolset enabled. */
  readOnlyNote?: string;
}

/**
 * Derive the human-readable, per-platform access description from the
 * ACTUALLY enabled tool profile, so the landing page stays truthful when
 * toolsets are toggled in the admin UI or new platforms are added later.
 * Unknown (future) toolsets fall back to a generic line instead of being
 * silently hidden.
 */
export function buildCapabilities(enabledDefs: EndpointDef[]): { platforms: PlatformCapabilities[] } {
  const on = new Set<Toolset>(enabledDefs.map((d) => d.toolset));

  // --- Microsoft 365 (Graph) ---------------------------------------------
  const m365Read: string[] = [];
  if (on.has("mail") || on.has("shared-mail")) {
    m365Read.push(
      "Outlook: levelek, mappák, mellékletek (tartalomkinyeréssel)" +
        (on.has("shared-mail") ? ", továbbá a megosztott postaládák, amelyekhez jogod van" : "")
    );
  }
  if (on.has("calendar"))
    m365Read.push("Naptár: események, résztvevők, online meetingek, mások szabad/foglalt elérhetősége és közös időpontkeresés");
  if (on.has("teams")) m365Read.push("Teams: chatek, csatornaüzenetek, csapatok és tagok");
  if (on.has("meetings")) m365Read.push("Meetingek: átiratok, felvételek és jelenléti adatok");
  const drives = [on.has("onedrive") ? "OneDrive" : null, on.has("sharepoint") ? "SharePoint" : null].filter(Boolean);
  if (drives.length) m365Read.push(`${drives.join(" és ")}: fájlok, mappák, listák, keresés és letöltés (Word, Excel, PDF tartalom szövegként)`);
  const notes = [on.has("onenote") ? "OneNote" : null, on.has("loop") ? "Loop" : null].filter(Boolean);
  if (notes.length) m365Read.push(`${notes.join(" és ")}: jegyzetfüzetek, szakaszok, oldalak és komponensek`);
  if (on.has("users")) m365Read.push("Címtár: Microsoft 365 felhasználók, személyek, szervezeti adatok");
  if (on.has("search")) m365Read.push("Több forrást átfogó Microsoft 365-keresés (levél, fájl, esemény, chat egy lekérdezéssel)");

  const m365Write: string[] = [];
  if (on.has("mail-write") || on.has("shared-mail-write")) {
    m365Write.push(
      "Outlook-levél piszkozatként létrehozása, elküldése, megválaszolása vagy továbbítása" +
        (on.has("shared-mail-write") ? " (megosztott postaládából is)" : "")
    );
  }
  if (on.has("calendar-write")) m365Write.push("Naptáresemény létrehozása (Teams-meetingként is), módosítása és meghívó megválaszolása");
  if (on.has("teams-write")) m365Write.push("Teams-üzenet küldése chatbe vagy csatornába, illetve válasz csatornaüzenetre");

  // --- Salesforce ---------------------------------------------------------
  const sfRead: string[] = [];
  if (on.has("salesforce")) {
    sfRead.push("Standard és egyedi objektumok (Account, Contact, Opportunity, Lead, Case, Task, Event, __c objektumok): rekordok, mezők, kapcsolódó rekordok");
    sfRead.push("SOQL-lekérdezés és SOSL szabadszöveges keresés, objektum- és mezőleírás (picklist-értékek, lookup-célok)");
    sfRead.push("Ügyfél-áttekintés egy lapon (kapcsolatok, lehetőségek, ügyek, tevékenységek), nemrég megnyitott elemek");
    sfRead.push("Riportok listázása és futtatása (összegző és mátrix riportok is), API-kvóta állapota");
  }
  const sfWrite: string[] = [];
  if (on.has("salesforce-write")) {
    sfWrite.push("Feladat (Task) és esemény (Event) rögzítése ügyfélhez, kapcsolathoz vagy lehetőséghez");
    sfWrite.push("Tetszőleges rekord létrehozása és mezőinek módosítása (pl. Case lezárása, Opportunity szakaszváltás) — csak írható mezők, describe alapján ellenőrizve");
    sfWrite.push("Chatter-bejegyzés a rekord feedjére, jegyzet csatolása — törlés nincs");
  }

  const platforms: PlatformCapabilities[] = [];
  if (m365Read.length || m365Write.length) {
    platforms.push({
      key: "m365",
      name: "Microsoft 365",
      access: "A bejelentkezett Microsoft-fiókoddal, a saját jogosultságaid keretein belül (delegált Graph-hozzáférés). Az AI soha nem lát többet, mint te magad az Outlookban, Teamsben vagy SharePointon.",
      read: m365Read,
      write: m365Write,
      readOnlyNote: "A Microsoft 365-elérés jelenleg csak olvasás — küldés, létrehozás vagy módosítás nincs engedélyezve.",
    });
  }
  if (sfRead.length || sfWrite.length) {
    platforms.push({
      key: "salesforce",
      name: "Salesforce",
      access: "Opcionális: a saját Salesforce-fiókod egyszeri összekötése után (lent). Minden hívás a te Salesforce-jogosultságaiddal fut, a Salesforce-ban a te neveden.",
      read: sfRead,
      write: sfWrite,
      readOnlyNote: "A Salesforce-elérés jelenleg csak olvasás — rekord létrehozása vagy módosítása nincs engedélyezve.",
    });
  }

  // Future-proofing: any toolset without a curated line above still shows up.
  const covered: Toolset[] = ["mail", "shared-mail", "mail-write", "shared-mail-write", "calendar", "calendar-write", "teams", "teams-write", "meetings", "onedrive", "sharepoint", "onenote", "loop", "users", "search", "salesforce", "salesforce-write"];
  for (const t of on) {
    if (covered.includes(t)) continue;
    const reads = enabledDefs.filter((d) => d.toolset === t && !d.write).length;
    const writes = enabledDefs.filter((d) => d.toolset === t && d.write).length;
    const target = platforms[0];
    if (!target) continue;
    if (reads) target.read.push(`${t}: ${reads} további képesség`);
    if (writes) target.write.push(`${t}: ${writes} írási művelet`);
  }
  return { platforms };
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
        <div class="muted">${esc(s.user.mail ?? s.user.upn ?? "")}${s.user.jobTitle ? " · " + esc(s.user.jobTitle) : ""}${s.user.isAdmin ? ' · <b>gateway admin</b> (<a href="/admin">admin felület</a>)' : ""}</div>
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

  const sf = s.salesforce;
  const salesforceCard = sf
    ? `
<div class="card">
  <h2>☁️ Salesforce <span class="muted" style="font-weight:400">· opcionális</span></h2>
  ${sf.error ? `<p class="fail">Salesforce-összekötés sikertelen: ${esc(sf.error)}</p>` : ""}
  ${sf.justConnected ? `<p class="ok">✓ Salesforce összekötve.</p>` : ""}
  ${sf.justDisconnected ? `<p class="muted">Salesforce-kapcsolat bontva.</p>` : ""}
  ${
    !s.user
      ? `<p>A Salesforce-fiókod összekötéséhez előbb jelentkezz be a Microsoft-fiókoddal (fent).</p>`
      : sf.connected && sf.info
        ? `<p class="ok">✓ Összekötve: <b>${esc(sf.info.name ?? sf.info.username ?? "Salesforce-felhasználó")}</b>
           ${sf.info.username ? `<span class="muted">(${esc(sf.info.username)})</span>` : ""}<br>
           <span class="muted">Org: ${esc(sf.info.instanceUrl)} · összekötve: ${esc(sf.info.connectedAt.slice(0, 16).replace("T", " "))} UTC</span></p>
           <p>Az AI a Salesforce-ban is <b>a te jogosultságaiddal</b> dolgozik (SOQL/SOSL, rekordok, riportok).
           ${s.salesforceWrite
             ? `<br><b>Írás is engedélyezve:</b> feladat/esemény rögzítése, rekord létrehozása és módosítása, Chatter, jegyzet — mindegyikhez az AI-nak
                külön a te jóváhagyásodat kell kérnie, és a Salesforce-ban a <b>te neveden</b> jelenik meg. Törlés nincs.`
             : "<br>Csak olvasás — rekord létrehozása vagy módosítása nem lehetséges."}</p>
           <p><a class="btn sec" href="/auth/salesforce/disconnect">Salesforce-kapcsolat bontása</a></p>`
        : `<p>Kösd össze a <b>saját</b> Salesforce-fiókodat, hogy az AI a Salesforce-adataidat is elérje — csak azt,
           amit te is látsz a Salesforce-ban. A bejelentkezés a Salesforce oldalán történik (${esc(sf.loginUrl)}),
           a gateway a jelszavadat nem látja.</p>
           <p class="muted">${s.salesforceWrite
             ? "Olvasás mellett <b>írás is engedélyezve</b> ezen a gatewayen (feladat, esemény, rekord, Chatter, jegyzet) — minden íráshoz az AI-nak külön a te jóváhagyásodat kell kérnie, és a Salesforce-ban a te neveden jelenik meg. Törlés nincs."
             : "Az elérés kizárólag olvasás — az AI nem hoz létre és nem módosít Salesforce-rekordot."}</p>
           <p><a class="btn" href="/auth/salesforce/connect">☁️ Salesforce összekötése</a></p>`
  }
</div>`
    : "";

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
<title>AV MCP Gateway</title>
${PORTAL_STYLE}
</head>
<body>
${renderNav("/")}
<h1>AV MCP Gateway</h1>
<div class="muted">Read broadly, write narrowly · ${s.toolCount} tool (${s.writeToolCount} írási, mind külön jóváhagyáshoz kötve)</div>

${identityCard}
${salesforceCard}
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

/** One platform block inside the "Mihez fér hozzá" card. */
function renderPlatformCapabilities(p: PlatformCapabilities): string {
  const icon = p.key === "salesforce" ? "☁️" : "🟦";
  return `
  <h3>${icon} ${esc(p.name)}</h3>
  <p class="muted">${esc(p.access)}</p>
  ${p.read.length ? `<p><b>Olvasás:</b></p>
  <ul>
    ${p.read.map((c) => `<li>${esc(c)}</li>`).join("\n    ")}
  </ul>` : ""}
  ${
    p.write.length
      ? `<p><b>Írás (szándékosan szűk, minden művelethez külön jóváhagyásod kell):</b></p>
  <ul>
    ${p.write.map((c) => `<li>${esc(c)}</li>`).join("\n    ")}
  </ul>`
      : `<p class="muted">${esc(p.readOnlyNote ?? "Csak olvasás.")}</p>`
  }`;
}

/** Landing page body below the identity card (capabilities + client guides). */
function renderPortalBody(s: PortalState): string {
  return `
<div class="card">
  <h2>Mihez fér hozzá az AI ezen a kapcsolaton?</h2>
  <p>Az AV MCP Gateway egyetlen MCP-kapcsolaton keresztül több vállalati rendszert nyit meg az AI-kliensek
  (ChatGPT, Claude) felé. A belépés mindig a vállalati Microsoft-fiókoddal történik, és minden platformon
  <b>csak azt éri el az AI, amit te magad is látsz</b>. Jelenleg bekötött platformok:
  ${s.platforms.map((p) => `<b>${esc(p.name)}</b>`).join(", ")}.</p>
  ${s.platforms.map(renderPlatformCapabilities).join("\n")}
  <p class="muted">Minden hívás naplózva van (ki, mikor, melyik eszközt, mely erőforráson — tartalom nélkül); az
  admin felületen a toolkészletek egyenként ki-be kapcsolhatók, és a gateway globálisan csak-olvasó módba is tehető.
  Az elérés tényleges tartalma attól is függ, hogy az adott platformon a fiókodnak mihez van jogosultsága.</p>
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
    <li>Kapcsolat típusa: <b>Közvetíthető HTTP</b> (Streamable HTTP), URL: a fenti cím. Adj neki nevet, pl. <i>AV MCP Gateway</i>.</li>
    <li>Mentés után nyomd meg az <b>MCP-k és hitelesítés</b> gombot → jelentkezz be a vállalati Microsoft-fiókoddal.</li>
    <li>Siker esetén a bővítmény adatlapján megjelenik az elérhető eszközök (toolok) listája.</li>
  </ol>

  <h3>🟠 Claude (claude.ai vagy Claude Desktop)</h3>
  <ol>
    <li>Bal alsó profilmenü → <b>Settings</b> → <b>Connectors</b>.</li>
    <li><b>Add custom connector</b> → Name: pl. <i>AV MCP Gateway</i>, Remote MCP server URL: a fenti cím → <b>Add</b>.</li>
    <li>A connector mellett <b>Connect</b> → vállalati Microsoft-bejelentkezés → engedélyezés.</li>
    <li>Új beszélgetésben a keresés/eszközök ikonnál kapcsold be a connectort.</li>
  </ol>

  <h3>🟣 Claude Code (terminál)</h3>
  <pre class="cmd">claude mcp add --transport http av-mcp-gateway ${esc(s.baseUrl)}/mcp</pre>
  <ol>
    <li>Futtasd a fenti parancsot (a <code>--scope user</code> kapcsolóval minden projektedben elérhető lesz).</li>
    <li>A Claude Code-ban add ki a <code>/mcp</code> parancsot → <b>Authenticate</b> → böngészős Microsoft-bejelentkezés.</li>
  </ol>

  <p class="muted">Gyors ellenőrzés csatlakozás után: <i>„Listázd a mai naptáramat”</i> — a hívás azonnal
  megjelenik az <a href="/admin">admin Napló</a> fülén is.</p>
</div>

<div class="card">
  <h2>⚙️ Ha valamelyik szolgáltatás nem érhető el</h2>
  <p>Előfordulhat, hogy az AI a kapcsolat egy részét látja, egy másikat viszont nem — például
  az M365-ös lekérdezések (Outlook, naptár, fájlok) működnek, a Salesforce-adatok viszont nem
  jönnek. Ilyenkor jellemzően nem a gateway a hibás, hanem a kliensben (ChatGPT vagy Claude)
  tárolt kapcsolat avult el — például mert az adott szolgáltatás még nem szerepelt benne,
  amikor bejelentkeztél.</p>
  <p><b>A megoldás: kapcsold újra az MCP-t a kliensben.</b></p>
  <ol>
    <li><b>ChatGPT:</b> Beállítások → Bővítmények → a kapcsolatnál bontsd a kapcsolatot
    (<b>Disconnect</b>), majd csatlakozz újra (<b>Connect</b>) — vagy töröld a bővítményt és vedd
    fel újra a fenti URL-lel.</li>
    <li><b>Claude (claude.ai / Desktop):</b> Settings → Connectors → a connectornál <b>Disconnect</b>,
    majd újra <b>Connect</b>.</li>
    <li><b>Claude Code:</b> add ki a <code>/mcp</code> parancsot → válaszd ki a szervert →
    <b>Clear authentication</b>, majd <b>Authenticate</b>.</li>
  </ol>
  <p>Ha közben a kliens rákérdez a hitelesítés módjára, <b>mindig az OAuth lehetőséget válaszd</b>
  (ne API-kulcsot vagy tokent) — a gateway kizárólag a vállalati Microsoft (Entra ID)
  OAuth-bejelentkezést használja.</p>
  <p class="muted">Ha az újracsatlakozás után is hiányzik valami: ellenőrizd fent, hogy be vagy-e
  jelentkezve, hogy a Microsoft Graph elérés zöld pipát mutat-e, illetve — ha a Salesforce-t is
  használod — hogy a Salesforce-fiókod össze van-e kötve. Ha mindez rendben van, és mégsem működik, szólj az IT-nek.</p>
</div>

<footer class="muted">
  <a href="/ujdonsagok">Újdonságok</a> · <a href="/admin">Admin felület</a> · <a href="/healthz">Állapot</a> · av-mcp-gateway v1.0
  <div style="margin-top:.5rem">By Botha Levente @alphavet 2026</div>
</footer>
</body>
</html>`;
}
