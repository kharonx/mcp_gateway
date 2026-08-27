/** Landing page: Microsoft login, identity self-check, connector onboarding. */

export interface PortalState {
  configured: boolean;
  baseUrl: string;
  toolCount: number;
  writeToolCount: number;
  user?: { name?: string; mail?: string; upn?: string; jobTitle?: string };
  graphOk?: boolean;
  graphError?: string;
  loginError?: string;
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

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>M365 Reporting MCP Gateway</title>
<style>
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
  ol li { margin-bottom: .35rem; }
  footer { margin-top: 1.5rem; }
</style>
</head>
<body>
<h1>Microsoft 365 Reporting MCP Gateway</h1>
<div class="muted">Read broadly, write narrowly · ${s.toolCount} tool (${s.writeToolCount} írási — csak Outlook levélküldés)</div>

${identityCard}

<div class="card">
  <h2>AI-kliens csatlakoztatása</h2>
  <p>MCP szerver URL a ChatGPT / Claude connectorhoz:</p>
  <p><code class="url">${esc(s.baseUrl)}/mcp</code></p>
  <ol>
    <li>ChatGPT → Settings → <b>Connectors</b> → új MCP connector a fenti URL-lel.</li>
    <li>A felugró bejelentkezés a vállalati Microsoft (Entra ID) login — mindenki a <b>saját fiókjával</b> lép be.</li>
    <li>Az AI ezután csak azt éri el, amit az adott felhasználó az Outlookban / Teamsben / SharePointon amúgy is lát.
        Levelet küldeni kizárólag külön jóváhagyás után tud.</li>
  </ol>
</div>

<footer class="muted">
  <a href="/admin">Admin felület</a> · <a href="/healthz">Állapot</a> · m365-reporting-mcp v1.0
</footer>
</body>
</html>`;
}
