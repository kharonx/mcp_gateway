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
    date: "2026-09-02",
    commit: "5226a84+",
    title: "Salesforce: írás is, nem csak lekérdezés",
    items: [
      "Új, opcionális Salesforce írási toolset (salesforce-write): feladat (Task) és esemény (Event) rögzítése a kapcsolódó ügyfélre/lehetőségre, tetszőleges rekord létrehozása és mezőinek módosítása (pl. Case lezárása, Opportunity szakaszváltás), Chatter-bejegyzés a rekord feedjére, jegyzet csatolása. Eddig a Salesforce-elérés kizárólag lekérdezés volt — amit az MCP-oldal nem tudott, azt most a REST API adja.",
      "Minden Salesforce-írás külön jóváhagyáshoz kötött (confirm=true): az AI-nak előbb meg kell kérdeznie téged, és a rekord a Salesforce-ban a saját nevedben jön létre, a saját jogosultságaiddal. Törlés továbbra sincs.",
      "A mezőneveket és az írhatóságot a gateway a Salesforce leírásából (describe) ellenőrzi a hívás előtt: elgépelt, nem létező vagy csak olvasható mező esetén érthető hibaüzenet jön, nem nyers Salesforce-hiba.",
      "Az írás külön ki-be kapcsolható toolset: az admin felület toolset-listájában letiltható, a globális csak-olvasás mód pedig automatikusan kizárja. A kezdőoldal és az admin felület szövegei is jelzik, ha az írás aktív.",
      "Az audit naplóba az írásoknál bekerül a művelet és a létrejött Salesforce-rekord azonosítója is.",
    ],
  },
  {
    date: "2026-08-31",
    commit: "26c9d43+",
    title: "Salesforce-összekötés (opcionális), adminok és felhasználók",
    items: [
      "Salesforce riportfuttatás: az összesítő (summary/matrix) riportok részletsorai is visszajönnek csoportonként; az alapmezők a felhasználó által ténylegesen látható mezőkre szűrve (mezőszintű biztonság), a nem létező objektumok érthető hibával.",
      "Salesforce-lekérdezések: a válasz pontosan legfeljebb maxItems rekordot ad (eddig a Salesforce 2000-es kötege jött vissza), a nextCursor onnan folytat, ahol abbamaradt. A SOSL-keresés kihagyja az orgban nem elérhető objektumokat (pl. nincs Opportunity) hiba helyett. A Salesforce kapcsolatteszt a valós Salesforce-válaszokhoz igazítva (PKCE-s próba, hibaszöveg kiolvasása).",
      "Admin Salesforce-beállítás: a gateway Callback URL-je másolható, csak olvasható mezőben jelenik meg (ezt a Salesforce Connected Appba kell bemásolni), a Login URL mező pedig érthető hibaüzenetet ad, ha nem Salesforce-domaint (pl. a callback címet) adnak meg.",
      "Admin felület Microsoft-belépéssel: aki a kezdőoldalon bejelentkezett és admin, annak nem kell admin kulcs. Új \"Felhasználók\" fül: minden, a portálon vagy MCP-n keresztül már belépett felhasználó látszik (utolsó aktivitás, MCP-hívások, Salesforce-kapcsolat), innen adható vagy vonható vissza az admin jog, és bontható egy felhasználó Salesforce-kapcsolata. Az admin kulcs csak az első admin létrehozásához (bootstrap) és tartaléknak marad.",
      "Salesforce kapcsolatteszt az admin felületen: Consumer Key/Secret és a Callback URL regisztrációjának ellenőrzése felhasználói bejelentkezés nélkül, plusz a saját összekötött fiók próbája.",
      "Új, opcionális Salesforce toolset a Microsoft 365 mellett: fiókok, kapcsolatok, lehetőségek, ügyek és tetszőleges (egyedi) objektumok lekérdezése, SOQL/SOSL, objektumleírás, egy fiók 360°-os áttekintése (kapcsolatok, pipeline, ügyek, aktivitások), legutóbb megnyitott rekordok, mentett riportok listázása és futtatása.",
      "Csak olvasás: rekord-létrehozás, -módosítás vagy -törlés nincs; a gateway a Salesforce-ban is kizárólag a bejelentkezett felhasználó saját jogosultságaival dolgozik.",
      "Összekötés a kezdőoldalon: Microsoft-bejelentkezés után \"Salesforce összekötése\" — mindenki a saját Salesforce-fiókjával lép be a Salesforce oldalán (OAuth 2.0 + PKCE), a jelszót a gateway nem látja; a kapcsolat bármikor bontható.",
      "Beállítás az admin felületen (Salesforce Connected App Consumer Key/Secret, login URL); amíg nincs kitöltve, a Salesforce toolok nem is jelennek meg.",
      "Nagy találati listák lapozása (nextCursor) a Salesforce-lekérdezéseknél is; minden rekord _source blokkot kap (objektum, id, Lightning-link).",
    ],
  },
  {
    date: "2026-08-28",
    commit: "289da22+",
    title: "Entra felhasználó-letiltás időpontja az audit naplóból",
    items: [
      "Új tool: get-user-account-status-history - egy felhasználó (Object ID vagy UPN) letiltásának/visszaengedélyezésének pontos UTC időpontja, a kezdeményező felhasználó vagy alkalmazás, az eredmény és az auditbejegyzés-azonosító az Entra directory audit naplóból. Csak az accountEnabled-változásokat adja vissza (Disable/Enable account, illetve Update user AccountEnabled true->false), a többi user update-et nem.",
      "Új tool: list-directory-audits - az Entra címtár audit napló szabadon szűrhető lekérdezése (kategória, művelet, célfelhasználó, dátumtartomány), lapozással.",
      "Megőrzési időn (30 nap, P1/P2) kívüli eseménynél egyértelmű \"nem érhető el a naplóban\" válasz, becsült dátum nélkül.",
      "Jogosultság: kizárólag olvasás - AuditLog.Read.All + Directory.Read.All (admin consent), olvasó szerepkörrel (Reports/Security/Global Reader).",
    ],
  },
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
