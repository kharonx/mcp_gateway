/**
 * "Újdonságok" (what's new) - one entry per deployment, newest first.
 *
 * RULE: every deploy adds an entry here (date, commit of the deployed HEAD,
 * user-facing bullet points in Hungarian). The landing page shows the latest
 * entry and links to /ujdonsagok, which renders the whole list.
 */

export interface ChangelogEntry {
  /** ISO date of the deployment. */
  date: string;
  /** Short git hash of the deployed commit. */
  commit: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-08-28",
    commit: "f6d6c30",
    title: "Nagy címtárak és nagy OneNote-jegyzetfüzetek",
    items: [
      "Új \"Újdonságok\" menü: minden telepítés változásai itt, a kezdőoldalon a legfrissebb kivonattal.",
      "Lapozás minden listázó toolban: ha egy válasz csonkolt (truncated), a visszaadott nextCursor értékkel a következő hívás onnan folytatja - így az 500 feletti gyűjtemények (pl. a teljes felhasználói címtár, 2700+ fiók) is végigolvashatók.",
      "list-users: a letiltott fiókok és vendégek is felismerhetők (accountEnabled, userType mezők), 999 elemes Graph-oldalak, szűrés pl. \"accountEnabled eq false\".",
      "OneNote: a szakasz- és jegyzetfüzet-listák túljutnak a 100-as Graph-plafonon ($skip lapozás), és a legutóbb módosított szakasz kerül előre.",
      "OneNote: szakaszcsoportok bejárása (jegyzetfüzet -> szakaszcsoport -> szakaszok) személyes és SharePoint-jegyzetfüzeteknél; a szakaszok hozzák a szülő jegyzetfüzetet és csoportot.",
      "OneNote SharePoint-oldalakon: új toolok a jegyzetfüzet szakaszaihoz, egy szakasz oldalaihoz és az oldal összes szakaszához (list-site-onenote-sections).",
      "OneNote-oldalkeresés: a Graph v1.0 nem támogat teljes szöveges keresést - a tool leírása most a működő utat (címszűrés, szakaszonkénti listázás) ajánlja.",
    ],
  },
  {
    date: "2026-08-27",
    commit: "9007baf",
    title: "Kezdőoldal és írási toolkészletek",
    items: [
      "Kezdőoldal Microsoft-bejelentkezéssel és identitás-önellenőrzéssel; lépésenkénti csatlakozási útmutató ChatGPT, Claude és Claude Code klienshez.",
      "A képességlista az engedélyezett toolprofilból generálódik.",
      "Új írási toolkészletek: naptáresemény létrehozása/módosítása, Teams-üzenetküldés, szabad időpont keresése.",
    ],
  },
  {
    date: "2026-08-25",
    commit: "daf8132",
    title: "Microsoft 365 Reporting MCP v1.0",
    items: ["Első kiadás: Outlook, naptár, Teams, meetingek, OneNote, SharePoint, OneDrive, Loop, keresés és felhasználók olvasása; auditnapló és admin felület."],
  },
];

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function renderChangelogEntry(e: ChangelogEntry): string {
  return `
  <div class="card">
    <h2>${esc(e.title)}</h2>
    <div class="muted">${esc(e.date)} · <code>${esc(e.commit)}</code></div>
    <ul>
      ${e.items.map((i) => `<li>${esc(i)}</li>`).join("\n      ")}
    </ul>
  </div>`;
}

/** Full /ujdonsagok page. `nav` is the shared top navigation markup, `style` the shared stylesheet. */
export function renderChangelogPage(nav: string, style: string): string {
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Újdonságok · M365 Reporting MCP Gateway</title>
${style}
</head>
<body>
${nav}
<h1>Újdonságok</h1>
<div class="muted">Minden telepítéskor ide kerülnek a felhasználók számára látható változások, a legfrissebb elöl.</div>
${CHANGELOG.map(renderChangelogEntry).join("\n")}
<footer class="muted"><a href="/">Vissza a kezdőoldalra</a></footer>
</body>
</html>`;
}
