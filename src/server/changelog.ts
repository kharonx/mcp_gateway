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

/** Semantic version of the gateway - bump together with package.json. */
export const APP_VERSION = "1.0.1";

/** Version stamp of the running build: APP_VERSION plus the deployed commit. */
export function buildInfo(): { version: string; commit: string; date: string } {
  const latest = CHANGELOG[0];
  const commit = (process.env.SOURCE_COMMIT || latest?.commit || "dev").replace(/\+$/, "").slice(0, 7);
  return { version: `${APP_VERSION}+${commit}`, commit, date: latest?.date ?? "" };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-18",
    commit: "7215f7c",
    title: "Új platform: Vectory / AP2 a TT MCP-szerveren keresztül",
    items: [
      "Új, opcionális vectory toolset: a TT MCP-szerver (tt.dokiforvet.hu) tooljai a gatewayen keresztül is elérhetők — ügyfélkeresés név, település, Vectory-kód, adószám, e-mail vagy telefon alapján, teljes ügyfélkép egy hívással, Vectory-számlák és tételek sztornó-státusszal, termékek, AP2 (AlphaVet) számlák és tételek, Alphaportal ticketek és kommentek, befizetések, lejáró fordulónapok, licenc-audit, ügyfélstatisztika, csapatjegyzetek. A toolok tt- előtaggal jelennek meg (pl. tt-ugyfel-kereses); a menet mindig ügyfélkereséssel kezdődik, a kapott clinicId-vel jönnek a többiek.",
      "Csak olvasás: a gateway nem nyúl a Vectory (meditrade) és az alphavet adatbázishoz, mindent a TT MCP lekérdező tooljain keresztül kér; írás nincs.",
      "Beállítás az admin felületen (TT MCP URL és API-kulcs, kapcsolatteszt); a toollista a TT-ről töltődik be induláskor és mentéskor, így követi, amit a TT közzétesz. A TT-elérés közös kulccsal történik, nem személyes jogosultság, ezért a vectory toolsetet a Felhasználók fülön érdemes név szerint kiosztani; minden hívás a hívó nevével kerül az auditnaplóba.",
      "A kezdőoldalon új Vectory / AP2 csempe és a „Mihez fér hozzá az AI” blokkban külön platform-szakasz; a get-gateway-info és a generált bemutatkozó szöveg is mutatja a toolsetet.",
    ],
  },
  {
    date: "2026-09-18",
    commit: "d64b722",
    title: "Felhasználói hozzáférési (kilépési) riport",
    items: [
      "Új tool: get-user-access-report. Egy felhasználóhoz (UPN vagy azonosító) összegyűjti: címtárszerepek, csoport- és Teams-tagságok (közvetlen vagy örökölt, tulajdonos vagy tag), a csoportokhoz tartozó SharePoint-oldalak, majd a hívó által látható SharePoint-oldalakon végigmegy a dokumentumtárakon és mappákon, és minden megosztott elemnél megnézi, hogy a felhasználó közvetlenül, csoporton keresztül vagy szervezeti/anonim linkkel fér-e hozzá, jelölve, hogy a jog örökölt vagy közvetlen.",
      "A riport tartalmazza a felhasználó saját OneDrive-járól másokkal megosztott elemeket, és — ahol a Graph engedi — a vele megosztott elemeket (sharedWithMe, Insights). Minden futás a hívó saját jogosultságával történik: csak az általa olvasható oldalak kerülnek átvizsgálásra.",
      "Korlátok a riportban jelölve: a klasszikus SharePoint-oldalcsoportok (Owners/Members/Visitors) tagságát a Graph delegált jogosultsággal nem adja ki, ezek „feloldatlan oldalcsoport” listában jelennek meg; csak a megosztási rekorddal rendelkező elemek kerülnek jogosultság-ellenőrzésre; a futás siteSearch, maxSites, maxItemsPerDrive és maxDepth paraméterekkel szűkíthető, a statisztika és a csonkolás jelzi, mi maradt ki.",
      "Nem kell új Entra-jogosultság: a meglévő Directory.Read.All, Sites.Read.All, Files.Read.All és Team.ReadBasic.All scope-okkal fut.",
    ],
  },
  {
    date: "2026-09-14",
    commit: "80a3345",
    title: "Verzió 1.0.1 — frissítés-észlelési teszt",
    items: [
      "A gateway verziója 1.0.0-ról 1.0.1-re emelkedett. Ez egy szándékos, funkció nélküli kiadás: azt teszteljük vele, hogy az AI-kliensek (ChatGPT, Claude) észreveszik-e a gateway frissítését a generált bemutatkozó szöveg, a get-gateway-info tool és a verziójel alapján.",
      "Ha az AI-tól megkérdezed, milyen verzió fut a gatewayen, a helyes válasz: 1.0.1, a legfrissebb commit hash-ével, dátum 2026-09-14.",
      "A verzió mostantól egyetlen helyen (APP_VERSION) van megadva, a kezdőoldal lábléce, a /healthz és az MCP-szerver neve is innen veszi.",
    ],
  },
  {
    date: "2026-09-14",
    commit: "69714a1",
    title: "Felhasználónkénti jogosultságok az admin felületen",
    items: [
      "Az admin felület Felhasználók fülén minden felhasználóhoz külön beállítható, mely toolseteket használhatja az AI a nevében (a gateway-szintű kapcsolókon belül), tiltható nála minden írás (csak olvasás), vagy letiltható az MCP-hozzáférése teljesen. A táblázat mutatja az egyéni vagy alapértelmezett profilt és a ténylegesen elérhető toolok számát.",
      "Új beállítás: alapértelmezett felhasználói jogosultság. Erre esik vissza mindenki, akinek nincs egyéni profilja — így beállítható például, hogy új belépők alapból csak olvasni tudjanak, és írási jogot csak név szerint kapjon valaki.",
      "A szűkítés az MCP-szerver tool-listájában, a bemutatkozó szövegében, a get-gateway-info válaszában és a kezdőoldal „Mihez fér hozzá az AI” blokkjában is megjelenik, a kezdőoldalon egy sor jelzi, ha egyéni vagy szűkített profil vonatkozik rád. Letiltott felhasználó MCP-hívásait a gateway 403-mal, magyar hibaüzenettel utasítja el; a portál és az admin felület elérhető marad.",
      "A jogosultság-változás a következő MCP-hívástól él, de a kliens által cache-elt tool-lista miatt az AI-nak újra kell kötnie a connectort, hogy az új listát lássa.",
    ],
  },
  {
    date: "2026-09-14",
    commit: "0f5c6f3",
    title: "Az AI könnyebben észreveszi a frissítéseket",
    items: [
      "Az MCP-szerver bemutatkozó szövege (instructions) mostantól a ténylegesen engedélyezett toolkészletekből és a legfrissebb Újdonságok-bejegyzésből generálódik, így minden új beszélgetés elején pontosan azt látja az AI, ami a gatewayen éppen elérhető, és mi változott legutóbb. Eddig ez kézzel írt szöveg volt, ami el tudott csúszni a valóságtól.",
      "Új tool: get-gateway-info. Visszaadja a build-verziót, az engedélyezett toolkészleteket és toolokat, a Salesforce-összekötés állapotát és az utolsó Újdonságok-bejegyzéseket. Az AI-nak szóló útmutatás szerint ezt hívja először, ha frissítést említesz, vagy egy képesség hiányozni látszik — és ha olyan toolt lát a listában, ami neki nincs, jelzi, hogy újra kell kötni a connectort.",
      "A szerver verziója a build commitját is tartalmazza (pl. 1.0.0+abc1234), ez a kliensek connector-adatlapján és a /healthz végponton is látszik, így ránézésre eldönthető, hogy a kliens a friss gatewayt látja-e.",
      "Emlékeztető: ha új tool kerül a gatewaybe, a ChatGPT-ben a connectort újra kell kötni (Disconnect, majd Connect), a claude.ai új beszélgetésnél frissít, a Claude Code-ban a /mcp parancsban kell újracsatlakozni.",
    ],
  },
  {
    date: "2026-09-11",
    commit: "239df52",
    title: "Salesforce: törlés külön, kikapcsolt toolsetben",
    items: [
      "A Salesforce saját hosted MCP-szervere (2026 áprilisa óta GA) az írást három külön szerverre bontja: olvasás, létrehozás/módosítás (SObject Mutations) és törlés (SObject Deletes). A gateway ugyanezt a felosztást követi: a meglévő salesforce-write toolset mellett új salesforce-delete toolset egyetlen toollal (delete-salesforce-record).",
      "A törlés alapból ki van kapcsolva, és csak akkor él, ha az admin a toolset-listában kifejezetten bepipálja. A rekord a Salesforce Lomtárba kerül, onnan 15 napig visszaállítható; a gateway törlés előtt lekérdezi a rekord nevét, hogy az AI pontosan meg tudja nevezni, mit töröl, és a név az auditnaplóba is bekerül. Minden törlés rekordonként külön jóváhagyáshoz kötött.",
      "Admin felület: a salesforce-write és a salesforce-delete toolset mostantól megjelenik a toolset-listában, így külön ki-be kapcsolható (eddig a Salesforce-írás hiányzott a listából).",
      "A kezdőoldal, az MCP-szerver leírása és a dokumentáció jelzi, ha a törlés engedélyezve van.",
    ],
  },
  {
    date: "2026-09-09",
    commit: "3125d95",
    title: "Megújult kezdőoldal",
    items: [
      "Új kinézet: fejléc a navigációval, platform-csempék (Microsoft 365, Salesforce) a bekötés állapotával, a hozzáférés-leírásban az olvasás és az írás egymás mellett, a kliens-útmutatók (ChatGPT, Claude, Claude Code) és a hibaelhárítás összecsukható szakaszokban.",
      "Bejelentkezés nélkül a kezdőoldal csak a bejelentkezés gombot mutatja; a részletek (mihez fér hozzá az AI, MCP URL, kliensbeállítás, újdonságok) kizárólag bejelentkezés után látszanak.",
      "Az Admin menüpont csak gateway-adminoknak jelenik meg; az admin felületről és az Újdonságok oldalról vissza lehet lépni a kezdőoldalra.",
    ],
  },
  {
    date: "2026-09-09",
    commit: "2e98dbb",
    title: "Kezdőoldal: platformonként mit ér el az AI",
    items: [
      "A kezdőoldal „Mihez fér hozzá az AI” blokkja platformonként bontva mutatja a bekötött rendszereket. Jelenleg két platform van: Microsoft 365 (Outlook, naptár, Teams, meetingek, OneDrive, SharePoint, OneNote, Loop, címtár, keresés) és Salesforce (standard és egyedi objektumok, SOQL/SOSL, ügyfél-áttekintés, riportok).",
      "Minden platformnál külön látszik a hozzáférés módja (a Microsoft-fiókoddal, illetve a saját Salesforce-fiókod összekötésével), az olvasási kör és az írási kör — az írás mindenhol csak a te külön jóváhagyásoddal fut, és a Salesforce-ban a te neveden jelenik meg.",
      "A leírás a ténylegesen engedélyezett toolkészletekből áll össze: ha az admin felületen egy toolkészletet kikapcsolsz, vagy a gateway csak-olvasó módban fut, a kezdőoldal ezt azonnal tükrözi.",
      "Következő tervezett platformcsalád: online hirdetési rendszerek (Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads, Microsoft Advertising) — a technikai felmérés elkészült, a fejlesztés még nem indult el.",
    ],
  },
  {
    date: "2026-09-09",
    commit: "8933524",
    title: "Új név: AV MCP Gateway",
    items: [
      "A szolgáltatás neve mostantól AV MCP Gateway (korábban Microsoft 365 Reporting MCP Gateway), mert már nem csak a Microsoft 365-öt, hanem a Salesforce-ot is kiszolgálja, és további rendszerek bekötése is tervben van.",
      "A kezdőoldal, az admin felület, az Újdonságok oldal, az MCP-szerver neve és a dokumentáció is az új nevet viseli. A kliensbeállítások (URL, bejelentkezés) nem változtak, újracsatlakozás nem szükséges.",
    ],
  },
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
    <div class="card-head"><h2>${esc(e.title)}</h2><span class="muted">${esc(e.date)} · <code>${esc(e.commit)}</code></span></div>
    <ul>
      ${e.items.map((i) => `<li>${esc(i)}</li>`).join("\n      ")}
    </ul>
  </div>`;
}

/** Full /ujdonsagok page. `nav` is the shared top navigation markup, `head` the shared <head> content (renderHead). */
export function renderChangelogPage(nav: string, head: string): string {
  return `<!doctype html>
<html lang="hu">
<head>
${head}
</head>
<body>
${nav}
<main>
<header class="pagehead">
  <h1>Újdonságok</h1>
  <p class="muted">Minden telepítéskor ide kerülnek a felhasználók számára látható változások, a legfrissebb elöl.</p>
</header>
${CHANGELOG.map(renderChangelogEntry).join("\n")}
</main>
<footer class="muted"><a href="/">← Vissza a kezdőoldalra</a></footer>
</body>
</html>`;
}
