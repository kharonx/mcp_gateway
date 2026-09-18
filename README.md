# AV MCP Gateway — v1.0

Vállalati MCP szerver, amelyen keresztül ChatGPT, Claude és más MCP-kompatibilis AI-kliensek
**kontrolláltan** férnek hozzá a Microsoft 365 információforrásaihoz (Outlook, Naptár, Teams,
meeting-átiratok, OneNote, SharePoint, OneDrive, Loop, Search, Users) — és opcionálisan, külön
felhasználói összekötéssel, egy Salesforce orghoz (olvasás + szűk írás, lásd lent).

**Alapelv: read broadly, write narrowly.** Széles READ réteg a bejelentkezett felhasználó
tényleges M365 jogosultságain belül; a WRITE réteg szűk és explicit: Outlook levél
(draft / send / reply / forward), naptáresemény (létrehozás / módosítás / meghívó
megválaszolása), Teams-üzenet (chat / csatorna / válasz) és — ha a Salesforce-integráció
be van kapcsolva — Salesforce feladat/esemény/rekord/Chatter/jegyzet írás. Minden tényleges
küldés/létrehozás külön `confirm=true` kapuval.

## Architektúra

```
ChatGPT / Claude / MCP kliens
        │  MCP over HTTPS (Streamable HTTP) + OAuth bearer token
        ▼
┌──────────────────────────────┐
│  av-mcp-gateway              │   Tool allowlist (86 tool, 11 WRITE = csak mail)
│  · JWT validálás (Entra)     │   Nincs generikus graph-request / $batch passthrough
│  · On-Behalf-Of tokencsere   │   Audit log (JSONL, tartalom nélkül)
│  · Pagination + 429 retry    │   Forráskövetés (_source blokk minden objektumon)
│  · Admin dashboard (/admin)  │
└──────────────┬───────────────┘
               │  OAuth 2.0 OBO → delegated Graph token
               ▼
    Microsoft Entra ID → Microsoft Graph API (v1.0)
```

A szerver **soha nem használ app-only jogosultságot**: minden Graph-hívás a bejelentkezett
felhasználó nevében fut (delegated), így az MCP nem tudja megkerülni a meglévő M365
hozzáférési szabályokat.

## Entra ID app-regisztráció

1. **App registration** létrehozása (single tenant).
2. **Expose an API**: Application ID URI = `api://<CLIENT_ID>`, scope: `access_as_user`.
   Állítsd az `accessTokenAcceptedVersion`-t **2**-re (manifest).
3. **API permissions** (Microsoft Graph, *Delegated*) — a teljes lista a
   [docs/tool-matrix.md](docs/tool-matrix.md) mellékletben; összefoglalva:
   - READ: `Mail.Read`, `Mail.Read.Shared`, `Calendars.Read`, `Calendars.Read.Shared`, `Chat.Read`,
     `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`,
     `TeamMember.Read.All`, `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All`,
     `OnlineMeetingRecording.Read.All`, `OnlineMeetingArtifact.Read.All`,
     `Notes.Read`, `Notes.Read.All`, `Sites.Read.All`, `Files.Read`, `Files.Read.All`,
     `People.Read`, `User.Read`, `User.ReadBasic.All`, `User.Read.All`
   - WRITE (mail + naptár + Teams-üzenet): `Mail.ReadWrite`, `Mail.Send`, `Mail.ReadWrite.Shared`,
     `Mail.Send.Shared`, `Calendars.ReadWrite`, `ChatMessage.Send`, `ChannelMessage.Send`
   - AUDIT (csak olvasás, Entra directory audit napló — `get-user-account-status-history`,
     `list-directory-audits`): `AuditLog.Read.All`, `Directory.Read.All`. Admin consent kell,
     és a hívó felhasználónak olvasó címtárszerepkör: *Reports Reader*, *Security Reader* vagy
     *Global Reader* (írási/címtár-adminisztrációs jog nem szükséges és nem is kerül felhasználásra).
     Az audit napló megőrzése 30 nap (Entra ID P1/P2; Free: 7 nap) — ennél régebbi letiltást a tool
     kifejezetten „nem érhető el a naplóban” eredménnyel jelez, dátumot nem becsül.
   - Admin consent szükséges a `.All` scope-okhoz.
4. HTTP módhoz: **Certificates & secrets** → client secret.
5. stdio/dev módhoz: **Authentication** → „Allow public client flows" = Yes (device code).

> Megjegyzés a spec 11. pontjához: a `Sites.Selected` **application** permissionként létezik;
> delegated (felhasználó nevében futó) modellben a site-szintű szűkítést a felhasználó saját
> SharePoint jogosultsága adja — az MCP delegated `Sites.Read.All`-t használ, ami önmagában
> nem ad hozzáférést olyan site-hoz, amit a felhasználó egyébként nem ér el.

## Telepítés és futtatás

```bash
npm install
cp .env.example .env      # töltsd ki: TENANT_ID, CLIENT_ID, CLIENT_SECRET, BASE_URL, ADMIN_KEY
npm run build

# Webapp (remote MCP) mód:
npm run start:http

# Lokális/dev (stdio, device code login):
npm run login             # egyszeri bejelentkezés, token cache-elve
npm start
```

Endpointok HTTP módban:

| URL | Leírás |
|---|---|
| `POST /mcp` | MCP endpoint (stateless Streamable HTTP), bearer token kötelező |
| `GET /.well-known/oauth-protected-resource` | MCP OAuth resource metadata → a beépített OAuth-proxyra mutat |
| `GET /.well-known/oauth-authorization-server` | OAuth AS metadata (a proxy) |
| `POST /register`, `GET /authorize`, `POST /token`, `GET /auth/callback` | Beépített OAuth-proxy az Entra ID előtt |
| `GET /admin` | Admin dashboard: Beállítások / Toolok / Napló (X-Admin-Key) |
| `GET /healthz` | Health check |

HTTP módban a szerver **Entra-adatok nélkül is elindul**: az első beállítás elvégezhető a
`/admin` felületen (Tenant ID, Client ID, Client Secret, Base URL, kapcsolat-teszt) — a
mentés azonnal érvénybe lép, a beállítások a `data/settings.json`-ben tárolódnak és
felülírják az `.env` értékeit.

## ChatGPT (és más MCP kliens) csatlakoztatása

A szerver **beépített OAuth-proxyt** tartalmaz az Entra ID előtt, mert a ChatGPT connector
RFC 7591 szerinti *dynamic client registration*-t vár, amit az Entra nem támogat. A proxy a
kliens felé teljes OAuth 2.1 felületet ad (DCR + PKCE), az Entra felé pedig az egyetlen
regisztrált vállalati appot használja; a kliensnek kiadott access token maga az Entra által
az `api://<CLIENT_ID>`-ra kiállított token, így a `/mcp` validálása és az OBO Graph-csere
változatlan — minden hívás a bejelentkezett felhasználó nevében fut.

Csatlakoztatás ChatGPT-ből:
1. Az Entra app **Authentication** részében vedd fel Web redirect URI-ként:
   `https://<BASE_URL>/auth/callback` (a pontos értéket az admin Beállítások fül mutatja).
2. ChatGPT → Settings → Connectors → új MCP connector, URL: `https://<BASE_URL>/mcp`.
3. A megjelenő bejelentkezés a vállalati Entra ID login — a felhasználó a saját fiókjával
   lép be, és csak a saját M365 jogosultságait kapja.

Claude Desktop / Claude Code: ugyanez az URL remote MCP-ként, vagy lokálisan stdio mód
(`claude mcp add av-mcp-gateway -- node dist/index.js --stdio`).

## Vectory / AP2 (TT MCP, opcionális)

Toolset `vectory`, provider `tt` (`src/tt/client.ts`, `src/tools/endpoints/tt.ts`): a gateway MCP-kliensként
csatlakozik a TT MCP-szerverhez (`https://tt.dokiforvet.hu/mcp`, közös `Mcp:ApiKey`), induláskor és a
beállítások mentésekor lekéri a toollistát, és `tt-` előtaggal (aláhúzás → kötőjel) továbbadja: ügyfélkeresés,
teljes ügyfélkép, Vectory-számlák/tételek/termékek, AP2-számlák/tételek/ticketek, befizetések, licenc-audit stb.
Minden TT-tool csak olvasás; a gateway nem éri el közvetlenül a Vectory (meditrade) és az alphavet SQL-t.
Beállítás: admin felület (URL, kulcs, kapcsolatteszt) vagy env `TT_MCP_URL`, `TT_MCP_API_KEY`. A TT-elérés nem
személyes jogosultság, ezért a toolsetet a felhasználói jogosultságokkal érdemes szűkíteni.

## Felhasználói hozzáférési (kilépési) riport

`get-user-access-report` (toolset `users`, csak olvasás): egy felhasználóhoz végigmegy a
címtárszerepeken, csoport- és Teams-tagságokon (közvetlen/örökölt, tulajdonos/tag), a csoportokhoz
kötött SharePoint-oldalakon, majd a hívó által látható oldalakon a dokumentumtár → mappa → fájl
láncon; a megosztási rekorddal rendelkező elemeknél minden jogosultságot és megosztási linket a
felhasználóhoz illeszt (közvetlen, csoporton át, szervezeti/anonim link; örökölt vagy közvetlen).
Hozzáteszi a felhasználó OneDrive-járól másokkal megosztott elemeket és — ahol a Graph engedi — a
vele megosztottakat. Paraméterek: `siteSearch`, `maxSites`, `maxItemsPerDrive`, `maxDepth`,
`includeOneDrive`, `includeSharedWithUser`. A válasz `stats`, `truncated`, `errors` és `notes`
mezői mutatják, mi maradt ki. Ismert korlát: a klasszikus SharePoint-oldalcsoportok tagsága
Graph-ból nem látszik, ezek `unresolvedSiteGroups` alatt jelennek meg.

## Adminok és felhasználók

- **Admin = bejelentkezett Microsoft-felhasználó admin joggal.** A `/admin` felület a kezdőoldali
  Microsoft-belépés sütijét használja; adminként nem kell kulcsot megadni.
- **Első admin (bootstrap):** belépés a kezdőoldalon → `/admin` → az admin kulcs (`ADMIN_KEY`)
  megadásával „Adminná válok". Utána a *Felhasználók* fülön bármely, már belépett (portál vagy
  MCP-hívás) felhasználó adminná tehető / az admin jog visszavonható (az utolsó admin nem vehető el).
- Az `x-admin-key` fejléc továbbra is működik tartalékként (headless konfiguráció, scriptek).
- A *Felhasználók* fül mutatja a Salesforce-összekötést is, és adminként bontható egy felhasználó
  Salesforce-kapcsolata (token revoke). Tároló: `data/users.json`.
- **Felhasználónkénti jogosultság** (*Felhasználók* fül → *Szerkesztés*): toolset-allowlist a
  gateway-szintű kapcsolókon belül, „csak olvasás” (minden írási tool tiltva), vagy az MCP-hozzáférés
  teljes letiltása (403 a `/mcp`-n; portál és admin elérhető marad). Akinek nincs egyéni profilja, arra a
  *Beállítások* fülön megadott **alapértelmezett felhasználói jogosultság** vonatkozik (env:
  `DEFAULT_USER_TOOLSETS`, `DEFAULT_USER_READ_ONLY`). Az érvényesítés egy helyen történik
  (`isToolEnabled(def, cfg, access)`), így az MCP tool-lista, a bemutatkozó szöveg, a `get-gateway-info`
  és a kezdőoldal ugyanazt mutatja. A kliens cache-elt tool-listája miatt a változás után a connectort
  újra kell kötni.

## Salesforce-összekötés (opcionális)

A gateway a Microsoft 365 mellett **fakultatívan** egy Salesforce orgot is elér — ugyanazzal az
elvvel: *delegált, sosem több, mint amit a felhasználó maga lát* — és írásnál sosem több,
mint amit ő maga meg is tehetne a Salesforce-ban.

- **Bekapcsolás:** `/admin` → *Salesforce (opcionális)* → a Connected App **Consumer Key / Secret**
  és a login URL (`https://login.salesforce.com`, sandboxnál `https://test.salesforce.com`).
  Amíg a Consumer Key üres, a `salesforce` toolset nem is regisztrálódik (env: `SF_CLIENT_ID`, …).
- **Connected App követelmények:** OAuth engedélyezve; **Callback URL** =
  `https://<BASE_URL>/auth/salesforce/callback` (az admin felület mutatja); OAuth scope-ok:
  *Manage user data via APIs (api)* és *Perform requests at any time (refresh_token, offline_access)*.
  PKCE támogatott (a gateway mindig küld code_challenge-et). Külön írási vagy admin scope nem kell:
  az `api` scope fedi az írást is, a tényleges jogot a felhasználó Salesforce-profilja dönti el.
  Az admin felületen a *Salesforce kapcsolat tesztelése* gomb felhasználói belépés nélkül ellenőrzi a
  Consumer Key/Secret párost és a Callback URL regisztrációját, és — ha a te fiókod össze van kötve —
  a saját kapcsolatodat is.
- **Felhasználói összekötés:** a kezdőoldalon Microsoft-bejelentkezés után *„Salesforce összekötése”* →
  a felhasználó a Salesforce oldalán, a **saját** fiókjával lép be. A refresh token Entra object id-hoz
  kötve a `data/salesforce-tokens.json`-ben tárolódik (0600), a kapcsolat a kezdőoldalon bontható
  (token revoke). Minden Salesforce-hívás ezzel a felhasználói tokennel fut — integrációs/app-only
  felhasználó nincs.
- **Toolok (READ):** `salesforce-connection-status`, `salesforce-soql-query`, `salesforce-sosl-search`,
  `list-salesforce-objects`, `describe-salesforce-object`, `get-salesforce-record`,
  `list-salesforce-records`, `get-salesforce-recent-items`, `get-salesforce-account-overview`,
  `list-salesforce-reports`, `run-salesforce-report`.
- **Toolok (WRITE, `salesforce-write` toolset):** `create-salesforce-task`, `create-salesforce-event`,
  `create-salesforce-record`, `update-salesforce-record`, `post-salesforce-chatter`,
  `create-salesforce-note`. Mindegyik `confirm=true`-hoz kötött, és a mezőket a hívás előtt a
  `describe` alapján ellenőrzi (nem létező vagy nem írható mező érthető hibát ad, nem 400-at).
  Nincs Apex, Bulk vagy Metadata API. A toolset a szokásos módon kikapcsolható
  (`ENABLED_TOOLSETS`, admin felület), és a `READ_ONLY=true` mód is letiltja.
- **Toolok (DELETE, `salesforce-delete` toolset, alapból kikapcsolva):** `delete-salesforce-record` —
  egy rekord törlése a Salesforce Lomtárba (15 napig visszaállítható), a törlés előtt a rekord nevét
  lekérdezi és az auditnaplóba írja. Csak akkor él, ha az `ENABLED_TOOLSETS` / admin toolset-lista
  kifejezetten tartalmazza — ugyanúgy, ahogy a Salesforce saját hosted MCP-jében az „SObject Deletes”
  szerver külön aktiválható a Mutations mellett.
  Az auditnaplóban a Salesforce-hívások `salesforce:` előtaggal jelennek meg; írásnál a létrejött
  rekord azonosítója is bekerül a naplóba.

## Biztonsági réteg (spec 19–20)

- **Nincs** generikus `graph_request(method, url, body)` tool és nincs `$batch` passthrough —
  csak a 86 allowlistelt endpoint érhető el.
- **Nincs** Files/Sites/OneNote/User/Group write és nincs delete sehol — a Salesforce-írás is
  kizárólag létrehozás/módosítás.
- Draft létrehozása ≠ küldési engedély: minden send/reply/forward `confirm=true`-t követel,
  és a tool-leírás utasítja az AI-t, hogy előbb kérjen explicit felhasználói jóváhagyást.
- `READ_ONLY=true` env-vel az összes write tool lekapcsolható; `ENABLED_TOOLSETS`-szel
  toolset-szintű profil szűkíthető (pl. `mail,calendar,meetings`).

## Audit (spec 21)

Minden hívás JSONL-ben naplózódik (`logs/audit-YYYY-MM-DD.jsonl`):
`timestamp, user, session, tool, operation (READ/WRITE), resourceType, graphEndpoint,
httpMethod, success, durationMs`, WRITE esetén továbbá `sender, recipients, cc, subject,
messageId, result`. **Tartalom (body, transcript, dokumentum, token) soha nem kerül a logba.**

## Hibatűrés (spec 22–23)

- HTTP 429/503/504: automatikus retry, `Retry-After` tiszteletben tartva (max 4 próbálkozás);
- `@odata.nextLink` pagination minden lista toolnál (`maxItems` paraméter, jelzett truncation);
- lejárt token / permission denied / hiányzó erőforrás: AI-nak érthető, akcionálható hibaüzenet;
- fájlletöltés méretlimittel (`MAX_DOWNLOAD_BYTES`), DOCX/XLSX/PPTX/PDF/TXT/CSV → szöveg-
  kinyerés, egyéb bináris → base64.

## Tool-mátrix (fejlesztői melléklet)

A teljes *MCP tool → Graph endpoint → HTTP method → delegated permission → READ/WRITE →
enabled* mátrix generált dokumentumként: **[docs/tool-matrix.md](docs/tool-matrix.md)**
(`npm run matrix` frissíti a `src/tools/endpoints/*.ts` definíciókból).

## Loop-adapter korlátai (spec 13)

Nincs általánosan elérhető dedikált Graph Loop workspace API, ezért a Loop-adapter **nem
fiktív endpointokat** használ: a `.loop`/`.fluid` komponenseket a Search API-n és a
SharePoint/OneDrive drive-okon keresztül éri el. A SharePoint Embedded konténerben tárolt
Loop workspace-ek delegated Graphon nem feltétlenül elérhetők — ezt a tool-leírás jelzi az
AI-nak, hogy a korlátot a felhasználónak is jelezze.

## Acceptance teszt (spec 26)

Csatlakoztatott kliensből természetes nyelven: *„Vizsgáld meg az elmúlt 30 nap levelezésemet,
naptáramat, Teams beszélgetéseimet és meetingátirataimat… Készíts összefoglalót az X projektről…
Készíts belőle e-mailt, majd külön jóváhagyás után küldd el."* — a várt tool-lánc:
`get-calendar-view` → `find-online-meeting-by-join-url` → `list-meeting-transcripts` →
`get-meeting-transcript-content` + `list-mail-messages` + `list-chat-messages` +
`search-onenote-pages` + `search-m365` → `create-draft-email` → (felhasználói jóváhagyás) →
`send-draft-email(confirm=true)`.
