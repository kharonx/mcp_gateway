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
  /** True when the opt-in Salesforce DELETE toolset is enabled. */
  salesforceDelete?: boolean;
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
    sfWrite.push("Chatter-bejegyzés a rekord feedjére, jegyzet csatolása");
    sfWrite.push(
      on.has("salesforce-delete")
        ? "Rekord törlése (a Salesforce Lomtárba kerül, onnan 15 napig visszaállítható) — külön, kifejezetten engedélyezett toolset, rekordonkénti jóváhagyással"
        : "Törlés nincs"
    );
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

/** Shared <head> for every portal page (fonts + stylesheet). */
export function renderHead(title: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
${PORTAL_STYLE}`;
}

export function renderPortal(s: PortalState): string {
  if (!s.user) return renderSignedOut(s);
  return renderSignedIn(s);
}

/** Signed-out landing: brand, one sentence, the login button. Nothing else. */
function renderSignedOut(s: PortalState): string {
  return `<!doctype html>
<html lang="hu">
<head>
${renderHead("AV MCP Gateway")}
</head>
<body class="signedout">
${renderNav("/", { minimal: true })}
<main class="hero">
  <div class="mark">AV</div>
  <h1>AV MCP Gateway</h1>
  <p class="lede">Az Alpha-Vet vállalati rendszerei (Microsoft 365, Salesforce) AI-kliensek számára,
  a saját fiókod jogosultságaival, naplózva.</p>
  ${s.loginError ? `<p class="fail">Sikertelen bejelentkezés: ${esc(s.loginError)}</p>` : ""}
  ${
    s.configured
      ? `<p><a class="btn big" href="/login">Bejelentkezés Microsoft-fiókkal</a></p>
  <p class="muted">A bejelentkezés után látod, mihez fér hozzá az AI, és hogyan kötöd be a ChatGPT-t, a Claude-ot vagy a Claude Code-ot.</p>`
      : `<p class="fail">A szerver Entra ID beállítása még hiányzik — először az <a href="/admin">admin felületen</a> kell konfigurálni.</p>`
  }
</main>
<footer class="muted">av-mcp-gateway v1.0 · <a href="/healthz">Állapot</a></footer>
</body>
</html>`;
}

/** Signed-in landing: identity, platform tiles, access description, client setup, what's new. */
function renderSignedIn(s: PortalState): string {
  const u = s.user!;
  const initial = (u.name ?? u.upn ?? "?").trim().charAt(0).toUpperCase();
  const identityCard = `
<section class="card identity">
  <div class="who">
    <div class="avatar">${esc(initial)}</div>
    <div class="grow">
      <div class="name">${esc(u.name ?? u.upn ?? "Ismeretlen felhasználó")}</div>
      <div class="muted">${esc(u.mail ?? u.upn ?? "")}${u.jobTitle ? " · " + esc(u.jobTitle) : ""}</div>
    </div>
    <div class="actions">
      ${u.isAdmin ? `<a class="btn sec" href="/admin">Admin felület</a>` : ""}
      <a class="btn sec" href="/logout">Kijelentkezés</a>
    </div>
  </div>
  ${
    s.graphOk
      ? `<div class="status ok"><span class="dot"></span>Microsoft Graph elérés működik — az AI ezzel a fiókkal, a te jogosultságaiddal dolgozik.</div>`
      : `<div class="status fail"><span class="dot"></span>Graph-teszt sikertelen: ${esc(s.graphError ?? "ismeretlen hiba")}
         <span class="muted">Jellemző ok: hiányzó admin consent az Entra app jogosultságain.</span></div>`
  }
</section>`;

  const platformTiles = `
<section class="tiles">
  <div class="tile">
    <div class="tile-head"><span class="ico m365">M</span><b>Microsoft 365</b><span class="pill ok">bekötve</span></div>
    <p class="muted">A Microsoft-fiókoddal, delegált Graph-hozzáféréssel. Külön összekötés nem kell.</p>
  </div>
  ${renderSalesforceTile(s)}
</section>`;

  const latest = CHANGELOG[0];
  const whatsNewCard = latest
    ? `
<section class="card">
  <div class="card-head"><h2>Újdonságok</h2><span class="muted">${esc(latest.date)}</span></div>
  <p><b>${esc(latest.title)}</b></p>
  <ul>
    ${latest.items.slice(0, 3).map((i) => `<li>${esc(i)}</li>`).join("\n    ")}
  </ul>
  <p><a href="/ujdonsagok">Összes újdonság →</a></p>
</section>`
    : "";

  return `<!doctype html>
<html lang="hu">
<head>
${renderHead("AV MCP Gateway")}
</head>
<body>
${renderNav("/", { isAdmin: u.isAdmin })}
<main>
<header class="pagehead">
  <h1>AV MCP Gateway</h1>
  <p class="muted">Read broadly, write narrowly · ${s.toolCount} tool, ebből ${s.writeToolCount} írási, mind külön jóváhagyáshoz kötve</p>
</header>
${identityCard}
${platformTiles}
${renderAccessCard(s)}
${renderClientCard(s)}
${renderTroubleshootCard()}
${whatsNewCard}
</main>
<footer class="muted">
  <a href="/ujdonsagok">Újdonságok</a>${u.isAdmin ? ` · <a href="/admin">Admin felület</a>` : ""} · <a href="/healthz">Állapot</a> · av-mcp-gateway v1.0
  <div>By Botha Levente @alphavet 2026</div>
</footer>
</body>
</html>`;
}

function renderSalesforceTile(s: PortalState): string {
  const sf = s.salesforce;
  if (!sf) return "";
  const flash = [
    sf.error ? `<p class="fail">Salesforce-összekötés sikertelen: ${esc(sf.error)}</p>` : "",
    sf.justConnected ? `<p class="ok">✓ Salesforce összekötve.</p>` : "",
    sf.justDisconnected ? `<p class="muted">Salesforce-kapcsolat bontva.</p>` : "",
  ].join("");
  if (sf.connected && sf.info) {
    return `
  <div class="tile">
    <div class="tile-head"><span class="ico sf">S</span><b>Salesforce</b><span class="pill ok">bekötve</span></div>
    ${flash}
    <p><b>${esc(sf.info.name ?? sf.info.username ?? "Salesforce-felhasználó")}</b>
      ${sf.info.username ? `<span class="muted">(${esc(sf.info.username)})</span>` : ""}<br>
      <span class="muted">${esc(sf.info.instanceUrl)} · összekötve ${esc(sf.info.connectedAt.slice(0, 16).replace("T", " "))} UTC</span></p>
    <p class="muted">${s.salesforceWrite ? `Olvasás és írás a te jogosultságaiddal, minden írás külön jóváhagyással. ${s.salesforceDelete ? "Törlés is engedélyezve (Lomtárba, 15 napig visszaállítható)." : "Törlés nincs."}` : "Csak olvasás a te jogosultságaiddal."}</p>
    <p class="cta"><a class="btn sec small" href="/auth/salesforce/disconnect">Kapcsolat bontása</a></p>
  </div>`;
  }
  return `
  <div class="tile">
    <div class="tile-head"><span class="ico sf">S</span><b>Salesforce</b><span class="pill">nincs bekötve</span></div>
    ${flash}
    <p class="muted">Kösd össze a saját Salesforce-fiókodat, hogy az AI a Salesforce-adataidat is elérje — csak azt, amit te is látsz.
    A bejelentkezés a Salesforce oldalán történik, a gateway a jelszavadat nem látja.</p>
    <p class="cta"><a class="btn" href="/auth/salesforce/connect">Salesforce összekötése</a></p>
  </div>`;
}

/** "Mihez fér hozzá az AI" — one block per integrated platform, read and write side by side. */
function renderAccessCard(s: PortalState): string {
  return `
<section class="card">
  <div class="card-head"><h2>Mihez fér hozzá az AI?</h2><span class="muted">${s.platforms.map((p) => esc(p.name)).join(" · ")}</span></div>
  <p>Egy MCP-kapcsolaton keresztül több vállalati rendszer, mindenhol <b>csak az, amit te magad is látsz</b>.
  A lista a ténylegesen engedélyezett toolkészletekből áll össze.</p>
  ${s.platforms.map(renderPlatformCapabilities).join("\n")}
  <p class="muted">Minden hívás naplózva van (ki, mikor, melyik eszközt, mely erőforráson — tartalom nélkül).
  Az elérés tényleges tartalma attól is függ, hogy az adott platformon a fiókodnak mihez van jogosultsága.</p>
</section>`;
}

/** One platform block inside the access card. */
function renderPlatformCapabilities(p: PlatformCapabilities): string {
  const ico = p.key === "salesforce" ? `<span class="ico sf">S</span>` : `<span class="ico m365">M</span>`;
  return `
  <div class="platform">
    <h3>${ico}${esc(p.name)}</h3>
    <p class="muted">${esc(p.access)}</p>
    <div class="cols">
      <div>
        <div class="eyebrow">Olvasás</div>
        ${p.read.length ? `<ul>${p.read.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : `<p class="muted">Nincs engedélyezve.</p>`}
      </div>
      <div>
        <div class="eyebrow">Írás <span class="pill gate">külön jóváhagyással</span></div>
        ${p.write.length ? `<ul>${p.write.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : `<p class="muted">${esc(p.readOnlyNote ?? "Csak olvasás.")}</p>`}
      </div>
    </div>
  </div>`;
}

function renderClientCard(s: PortalState): string {
  const url = `${s.baseUrl}/mcp`;
  return `
<section class="card">
  <div class="card-head"><h2>AI-kliens csatlakoztatása</h2></div>
  <p>MCP szerver URL, ezt kell megadni minden kliensben:</p>
  <div class="urlbox"><code id="mcpurl">${esc(url)}</code>
    <button class="copy" onclick="navigator.clipboard.writeText(document.getElementById('mcpurl').textContent).then(()=>{this.textContent='Másolva ✓';setTimeout(()=>this.textContent='Másolás',1500)})">Másolás</button></div>
  <p class="muted">A csatlakozáskor felugró bejelentkezés a vállalati Microsoft (Entra ID) login — mindenki a saját fiókjával lép be,
  és csak a saját jogosultságait kapja. Ha a kliens rákérdez a hitelesítés módjára, mindig az <b>OAuth</b> lehetőséget válaszd.</p>

  <details>
    <summary>ChatGPT (asztali alkalmazás)</summary>
    <ol>
      <li>Indítsd el a <b>ChatGPT alkalmazást</b>.</li>
      <li><b>Szerkesztés</b> menü → <b>Beállítások</b>.</li>
      <li>Bal oldalt keresd meg a <b>Bővítmények</b> (Connectors) menüpontot.</li>
      <li><b>Hozzáadás</b> → <b>MCP-kiszolgáló hozzáadása</b>.</li>
      <li>Kapcsolat típusa: <b>Közvetíthető HTTP</b> (Streamable HTTP), URL: a fenti cím. Adj neki nevet, pl. <i>AV MCP Gateway</i>.</li>
      <li>Mentés után nyomd meg az <b>MCP-k és hitelesítés</b> gombot → jelentkezz be a vállalati Microsoft-fiókoddal.</li>
      <li>Siker esetén a bővítmény adatlapján megjelenik az elérhető eszközök (toolok) listája.</li>
    </ol>
  </details>

  <details>
    <summary>Claude (claude.ai vagy Claude Desktop)</summary>
    <ol>
      <li>Bal alsó profilmenü → <b>Settings</b> → <b>Connectors</b>.</li>
      <li><b>Add custom connector</b> → Name: pl. <i>AV MCP Gateway</i>, Remote MCP server URL: a fenti cím → <b>Add</b>.</li>
      <li>A connector mellett <b>Connect</b> → vállalati Microsoft-bejelentkezés → engedélyezés.</li>
      <li>Új beszélgetésben a keresés/eszközök ikonnál kapcsold be a connectort.</li>
    </ol>
  </details>

  <details>
    <summary>Claude Code (terminál)</summary>
    <pre class="cmd">claude mcp add --transport http av-mcp-gateway ${esc(url)}</pre>
    <ol>
      <li>Futtasd a fenti parancsot (a <code>--scope user</code> kapcsolóval minden projektedben elérhető lesz).</li>
      <li>A Claude Code-ban add ki a <code>/mcp</code> parancsot → <b>Authenticate</b> → böngészős Microsoft-bejelentkezés.</li>
    </ol>
  </details>

  <p class="muted">Gyors ellenőrzés csatlakozás után: <i>„Listázd a mai naptáramat”</i> — a hívás azonnal megjelenik az admin Napló fülén is.</p>
</section>`;
}

function renderTroubleshootCard(): string {
  return `
<section class="card">
  <details>
    <summary class="h2">Ha valamelyik szolgáltatás nem érhető el</summary>
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
    <p class="muted">Ha az újracsatlakozás után is hiányzik valami: ellenőrizd fent, hogy a Microsoft Graph elérés zöld,
    illetve — ha a Salesforce-t is használod — hogy a Salesforce-fiókod össze van-e kötve. Ha mindez rendben van, és mégsem működik, szólj az IT-nek.</p>
  </details>
</section>`;
}

/** Top bar shared by every portal page: brand + navigation. */
export function renderNav(active: string, opts: { isAdmin?: boolean; minimal?: boolean } = {}): string {
  const items: [string, string][] = [["/", "Kezdőoldal"], ["/ujdonsagok", "Újdonságok"]];
  if (opts.isAdmin) items.push(["/admin", "Admin"]);
  const links = opts.minimal
    ? ""
    : items.map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`).join("");
  return `<nav class="topbar">
  <a class="brand" href="/"><span class="mark">AV</span><span>AV MCP Gateway</span></a>
  <div class="links">${links}</div>
</nav>`;
}

/** Stylesheet shared by every portal page. */
export const PORTAL_STYLE = `<style>
  :root {
    color-scheme: light dark;
    --bg: #f3f5f8; --surface: #ffffff; --surface-2: #e9edf3; --ink: #1b2130; --muted: #5b6474; --line: #d5dae3;
    --accent: #1f5f8b; --accent-ink: #ffffff; --accent-soft: #e3eef7;
    --ok: #2e7d4f; --ok-soft: #e1f1e7; --fail: #a3332e; --fail-soft: #f8e2e0; --gate: #b25e0e; --gate-soft: #fbeedd;
    --sf: #0d9dda; --m365: #d83b01;
    font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #11151c; --surface: #181d26; --surface-2: #1f2530; --ink: #e5e9f0; --muted: #98a2b3; --line: #2b3340;
      --accent: #6fb0df; --accent-ink: #0e1620; --accent-soft: #1b2a3a;
      --ok: #6cc391; --ok-soft: #173023; --fail: #e5766f; --fail-soft: #3b1d1c; --gate: #e39b4c; --gate-soft: #3a2812;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5; font-size: 15.5px; }
  main { max-width: 860px; margin: 0 auto; padding: 0 1.25rem 3rem; }
  a { color: var(--accent); }
  h1, h2, h3, summary.h2 { font-family: "Archivo", "IBM Plex Sans", system-ui, sans-serif; margin: 0; line-height: 1.2; text-wrap: balance; }
  h1 { font-size: 1.7rem; font-weight: 700; letter-spacing: -.01em; }
  h2 { font-size: 1.1rem; font-weight: 700; }
  h3 { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; margin-bottom: .2rem; }
  p { margin: .6rem 0; }
  ul, ol { padding-left: 1.2rem; margin: .4rem 0; }
  li { margin: .25rem 0; }
  .muted { color: var(--muted); font-size: .9rem; }
  .eyebrow { font-family: "Archivo", sans-serif; font-size: .72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: .25rem; display: flex; align-items: center; gap: .5rem; }
  code { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; font-size: .9em; background: var(--surface-2); padding: .05em .35em; border-radius: 3px; }
  pre.cmd { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; padding: .6rem .8rem; border-radius: 6px; background: var(--surface-2); overflow-x: auto; font-size: .85rem; user-select: all; margin: .5rem 0; }

  nav.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; max-width: 860px; margin: 0 auto; padding: 1rem 1.25rem; }
  nav.topbar .brand { display: flex; align-items: center; gap: .6rem; text-decoration: none; color: var(--ink); font-family: "Archivo", sans-serif; font-weight: 700; font-size: 1rem; }
  .mark { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font-family: "Archivo", sans-serif; font-weight: 700; font-size: .85rem; letter-spacing: .02em; }
  nav.topbar .links { display: flex; gap: 1.1rem; font-size: .92rem; }
  nav.topbar .links a { text-decoration: none; color: var(--muted); padding: .2rem 0; border-bottom: 2px solid transparent; }
  nav.topbar .links a.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--accent); }
  nav.topbar .links a:hover { color: var(--ink); }

  .pagehead { padding: .6rem 0 1rem; border-bottom: 1px solid var(--line); margin-bottom: 1.2rem; }
  .pagehead .muted { margin: .3rem 0 0; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem 1.3rem; margin: 1rem 0; }
  .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: .3rem; }
  .card > p:first-of-type { margin-top: .4rem; }

  .btn { display: inline-block; padding: .55rem 1.15rem; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: .92rem; background: var(--accent); color: var(--accent-ink); border: 1px solid transparent; }
  .btn.sec { background: transparent; color: var(--ink); border-color: var(--line); }
  .btn.sec:hover { border-color: var(--accent); }
  .btn.small { padding: .35rem .8rem; font-size: .85rem; }
  .btn.big { padding: .8rem 1.5rem; font-size: 1.02rem; }
  .ok { color: var(--ok); } .fail { color: var(--fail); }

  .identity .who { display: flex; gap: .9rem; align-items: center; flex-wrap: wrap; }
  .identity .grow { flex: 1 1 200px; }
  .identity .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 700; font-family: "Archivo", sans-serif; flex: none; }
  .name { font-weight: 600; font-size: 1.05rem; }
  .status { display: flex; align-items: baseline; gap: .5rem; margin-top: .9rem; padding: .55rem .8rem; border-radius: 8px; font-size: .9rem; flex-wrap: wrap; }
  .status.ok { background: var(--ok-soft); color: var(--ok); }
  .status.fail { background: var(--fail-soft); color: var(--fail); }
  .status .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; align-self: center; }
  .status .muted { flex-basis: 100%; }

  .tiles { display: grid; grid-template-columns: 1fr; gap: 1rem; margin: 1rem 0; }
  @media (min-width: 640px) { .tiles { grid-template-columns: 1fr 1fr; } }
  .tile { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.2rem; display: flex; flex-direction: column; }
  .tile p { margin: .4rem 0; }
  .tile .cta { margin-top: auto; padding-top: .4rem; }
  .tile-head { display: flex; align-items: center; gap: .55rem; }
  .tile-head b { font-family: "Archivo", sans-serif; font-size: 1rem; }
  .tile-head .pill { margin-left: auto; }
  .ico { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; color: #fff; font-family: "Archivo", sans-serif; font-weight: 700; font-size: .75rem; flex: none; }
  .ico.m365 { background: var(--m365); } .ico.sf { background: var(--sf); }
  .pill { display: inline-block; font-family: "Archivo", sans-serif; font-size: .7rem; font-weight: 600; letter-spacing: .04em; padding: .1rem .5rem; border-radius: 999px; background: var(--surface-2); color: var(--muted); white-space: nowrap; }
  .pill.ok { background: var(--ok-soft); color: var(--ok); }
  .pill.gate { background: var(--gate-soft); color: var(--gate); text-transform: none; letter-spacing: 0; }

  .platform { border-top: 1px solid var(--line); padding-top: .9rem; margin-top: .9rem; }
  .platform .cols { display: grid; grid-template-columns: 1fr; gap: .6rem 1.5rem; margin-top: .5rem; }
  @media (min-width: 700px) { .platform .cols { grid-template-columns: 1fr 1fr; } }
  .platform ul { margin: 0; font-size: .92rem; }

  .urlbox { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; background: var(--surface-2); border-radius: 8px; padding: .5rem .7rem; }
  .urlbox code { background: transparent; padding: 0; font-size: .92rem; user-select: all; word-break: break-all; }
  button.copy { padding: .3rem .75rem; cursor: pointer; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: inherit; font-size: .8rem; margin-left: auto; }
  button.copy:hover { border-color: var(--accent); }

  details { border-top: 1px solid var(--line); padding: .5rem 0; }
  details:last-of-type { border-bottom: 1px solid var(--line); }
  summary { cursor: pointer; font-weight: 600; padding: .3rem 0; list-style: none; display: flex; align-items: center; gap: .5rem; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: ""; width: 7px; height: 7px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; flex: none; margin-right: .2rem; }
  details[open] > summary::before { transform: rotate(45deg); }
  .card details:first-child { border-top: 0; padding-top: 0; }
  .card details:first-child:last-of-type { border-bottom: 0; padding-bottom: 0; }

  body.signedout { min-height: 100vh; display: flex; flex-direction: column; }
  body.signedout main.hero { text-align: center; padding-top: 3.5rem; max-width: 560px; flex: 1; }
  body.signedout .hero .mark { width: 56px; height: 56px; border-radius: 14px; font-size: 1.3rem; margin-bottom: 1rem; }
  body.signedout .hero h1 { font-size: 2rem; }
  body.signedout .lede { font-size: 1.05rem; margin: .8rem auto 1.4rem; max-width: 46ch; }

  footer { max-width: 860px; margin: 0 auto; padding: 0 1.25rem 2rem; font-size: .85rem; color: var(--muted); }
  footer a { color: inherit; }
  @media (prefers-reduced-motion: reduce) { summary::before { transition: none; } }
</style>`;
