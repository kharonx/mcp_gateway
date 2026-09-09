# Hirdetési platformok MCP-integrációja – technikai felmérés

Állapot: 2026-09-09, az öt platform hivatalos dokumentációja alapján ellenőrizve.
Cél: egy egységes **Advertising MCP** réteg az AV MCP Gateway-ben, amelyen keresztül AI-ügynök
szabályozottan olvas és ír Meta Ads, Google Ads, Microsoft Advertising, TikTok Ads és LinkedIn Ads
fiókokat, elkülönített olvasási/írási jogokkal és emberi jóváhagyási ponttal a pénzügyi hatású
műveleteknél.

## 1. Vezetői összefoglaló

- **Mind az öt platform hivatalos API-ja lefedi a kért műveleteket** (fiókok, kampányok, hirdetéscsoportok,
  hirdetések létrehozása és módosítása, indítás/szüneteltetés, költségkeret és licit, célzás és közönség,
  kreatívok, teljesítmény- és konverziós adatok). Technikai akadály nincs; a kockázat a hozzáférés-igénylésben
  és a platformonként eltérő adatmodellben van.
- **A kritikus út nem a fejlesztés, hanem az API-hozzáférés.** Google Ads Basic access ~1 hét, Standard ~2 hét;
  LinkedIn Advertising API Development tier gyors, de Standard tier hónapok; Meta Full Access csak élő forgalom
  után (500 hívás 15 nap alatt); TikTok app-review 2–3 munkanap; Microsoft fejlesztői token saját fiókra azonnal.
  A hozzáférés-igényléseket a fejlesztés első napján el kell indítani.
- **Az Advertising MCP-t a meglévő gateway-re érdemes építeni**, nem külön szolgáltatásként: az Entra-bejelentkezés,
  az MCP-szerver, a toolset-kapcsolók, a `confirm=true` írási kapu és az audit már megvan. Új elem: platform-
  hitelesítő tárolás (szerveroldali szolgáltatás-tokenek), egységes hirdetési adatmodell, és egy **kétlépcsős
  jóváhagyási sor** a pénzügyi hatású műveletekhez.
- **Négy platformnak van hivatalos MCP-szervere** (Meta, Google, Microsoft, TikTok), de a Google és a Microsoft
  csak olvasó, a Meta és a TikTok a saját fiók-OAuth-jával fut, egyik sem ad platformok közötti egységes riportot
  vagy jóváhagyási munkafolyamatot. A saját gateway ezért indokolt; a hivatalos MCP-k kiegészítő felfedező
  eszközként hasznosak.
- **Javasolt sorrend a magyar piac és a Grandopet-use case alapján:** Meta → Google → TikTok → LinkedIn → Microsoft.
  A Microsoft Advertising Magyarországon ~1,6% desktop keresési részesedés; utolsó helyre való, de a Google-import
  funkció miatt olcsón bekapcsolható.
- **Becsült munkaigény:** alapréteg 12–15 nap, Meta 11–13, Google 12–15, TikTok 8–10, LinkedIn 9–11,
  Microsoft 8–10 nap; összesen **60–75 fejlesztői nap** egy senior fejlesztőnek, a hozzáférés-igénylési
  átfutásokat nem számítva.

## 2. Platformonkénti felmérés

### 2.1 Meta Marketing API (Facebook + Instagram)

**API.** Graph/Marketing API **v26.0** (2026-07-29). Évi 2–3 kiadás, egy Marketing API verzió csak
~12–13 hónapig él (a Graph API 2 évével szemben); lejárt verzió hívása csendben a következő verzión fut.
Bázis: `https://graph.facebook.com/v26.0/`.

**Hitelesítés és hozzáférés.** OAuth (Facebook Login for Business) rövid → hosszú élettartamú felhasználói
token (~60 nap), vagy **System User token** a Business Managerből (nem lejáró, vagy 60 naponta forgatott;
gateway-hez ez javasolt). Jogosultságok: `ads_read` (csak Insights), `ads_management` (olvasás+írás),
`business_management`, továbbá `pages_*`, `instagram_basic`, `leads_retrieval`. Advanced Access App Review-t
és **Business Verificationt** igényel. 2026 májusától a hozzáférési szint neve „Marketing API Access Tier”:
**Limited** (alap, fejlesztői rate limit, 1 system user) és **Full** (≥500 API-hívás 15 nap alatt <15%
hibaaránnyal, utána egy kattintással kérhető; 10 system user).

**Olvasás.** `me/adaccounts`, `business/owned_ad_accounts`; campaigns / adsets / ads / adcreatives /
adimages / advideos edge-ek. **Insights** minden szinten: `spend, impressions, clicks, ctr, cpc, cpm, cpp,
reach, frequency, actions, action_values, cost_per_action_type, purchase_roas, conversions`; `date_preset`,
`time_increment`, attribúciós ablakok, bontások (kor, nem, ország, placement, eszköz, óra, asset).
Nagy riport aszinkron `AdReportRun`-ként. Közönségek (custom/lookalike/saved), targeting search (érdeklődés,
földrajz), pixelek és események, lead formok.

**Írás.** Kampány (ODAX célok: `OUTCOME_AWARENESS/TRAFFIC/ENGAGEMENT/LEADS/APP_PROMOTION/SALES`,
`special_ad_categories` kötelező, CBO költségkeret, `spend_cap`), ad set (napi/lifetime keret, `bid_strategy`,
`optimization_goal`, teljes `targeting` spec, ütemezés, `promoted_object`), kreatív (`object_story_spec`
kép/videó/link, képfeltöltés hash-sel, videófeltöltés), hirdetés; státusz `ACTIVE/PAUSED/ARCHIVED/DELETED`;
custom audience feltöltés SHA-256 hash-elt listával (≤10 000/kérés), lookalike (ratio 1–20%). Batch ≤50
művelet/kérés függőségekkel.

**Korlátok.** Business Use Case rate limit ad accountonként/óránként: `ads_management` Full = 100 000 + 40×aktív
hirdetés pont, Limited = 300 + 40×aktív; írás 3 pont, olvasás 1; Limited szinten 60 pont után 300 mp blokk.
Objektumlimitek: 200 ad set/kampány, 5 000 ad set és 5 000 ad/fiók. Sandbox ad account: nincs kiszállítás,
**nincs Insights**, Ads Managerben nem látszik.

**SDK.** `facebook-nodejs-business-sdk` karbantartott (GitHub v26.0.1), de npm-en elmaradt (24.0.1);
gateway-hez sima Graph HTTP javasolt (a Graph-kliens minta már megvan az M365 oldalon).

**Hivatalos MCP.** `https://mcp.facebook.com/ads` (2026. július): riport, kampány létrehozás/szerkesztés,
közönség, katalógus, diagnosztika; `ads_mcp_management` jogosultság. Közösségi: `pipeboard-co/meta-ads-mcp`.

**Buktatók.** `special_ad_categories` minden kampányon; API-n létrehozott hirdetés is review-ra megy
(`effective_status`, `ad_review_feedback`); több ad account csak Business Manageren keresztül, a system usert
minden assethez hozzá kell rendelni; rövid verzióélet → évi két frissítés betervezése.

### 2.2 Google Ads API

**API.** **v25** (2026-07-22), negyedévente major, havonta minor, ~12 hónap élettartam, egyszerre 3–4 verzió él.
gRPC (elsődleges) és REST/JSON. Lekérdezés **GAQL**-lel (`GoogleAdsService.Search/SearchStream`).

**Hitelesítés és hozzáférés.** OAuth 2.0 scope `adwords`; saját fiókokhoz **service account** javasolt
(domain-wide delegation már nem kell, a service account e-mailje felhasználóként hozzáadva). Fejlesztői
token egy **manager (MCC) fiók** API Centeréből, `login-customer-id` fejléc, `customer_id` a hívásban.
Hozzáférési szintek: Test (csak tesztfiók, 15 000 művelet/nap), **Explorer** (2 880/nap, korlátozott
szolgáltatások), **Basic** (15 000/nap, igénylés ~5 munkanap, minden élő fiók az MCC alatt), **Standard**
(korlátlan, ~10 munkanap, külső felhasználóknál RMF-megfelelés).

**Olvasás.** `ListAccessibleCustomers`, majd GAQL a `customer_client, campaign, ad_group, ad_group_ad,
ad_group_criterion, asset, asset_group, user_list, change_status, recommendation` erőforrásokon. Metrikák:
`cost_micros, impressions, clicks, ctr, average_cpc, average_cpm, conversions, conversions_value,
cost_per_conversion, all_conversions, conversions_value_per_cost` (= ROAS közvetlenül). Szegmensek: dátum,
eszköz, hálózat. Változástörténet 90 napra, Recommendations, Keyword Plan ötletek/előrejelzés.

**Írás.** Erőforrásonkénti `Mutate*` és `GoogleAdsService.Mutate` (atomi, több erőforrás egy kérésben,
ideiglenes ID-kkal: keret + kampány + ad group + ad egyben). `validate_only` (dry run) és `partial_failure`.
Kampánytípusok: Search, Display, Shopping, Performance Max, Demand Gen, Video, App; licit: TargetCpa,
TargetRoas, MaximizeConversions, MaximizeConversionValue, ManualCpc; státusz `ENABLED/PAUSED/REMOVED`.
Assetek (kép base64, YouTube videó ID-val), PMax asset group minimumok (3–15 headline, 1–5 long headline,
2–5 description, fekvő + négyzetes kép, logó). Customer Match (`OfflineUserDataJobService`, SHA-256,
100 000 azonosító/hívás), konverziós akciók és konverziófeltöltés.

**Korlátok.** Napi műveletkeret szintenként; QPS nem publikált, token-bucket → `RESOURCE_TEMPORARILY_EXHAUSTED`;
10 000 mutate művelet/kérés. **Tesztfiókok nem szolgálnak ki és minden metrikájuk üres**, más sandbox nincs:
a riportolás csak élő fiókon tesztelhető.

**SDK.** Hivatalos: Java, .NET, PHP, Python, Ruby, Perl; **Node.js nincs**. Közösségi `google-ads-api`
(Opteo, v24.1) aktív; REST Node-ból működik, de lapozás és field mask kézi.

**Hivatalos MCP.** `googleads/google-ads-mcp` (Python): `list_accessible_customers`, `search` (GAQL),
`get_resource_metadata` – **szigorúan csak olvasó**. Közösségi írós: `FGRibreau/mcp-google-ads` és társai.

**Buktatók.** Fejlesztői token egy MCC-hez kötött; pénz mikróban; PMax létrehozás egy atomi kérésben,
`partial_failure` nélkül; Smart Bidding csak működő konverziómérés mellett; egyes Video altípusok API-n
csak olvashatók; házirend-ellenőrzés aszinkron (`policy_summary`).

### 2.3 Microsoft Advertising API (Bing Ads)

**API.** **v13** (2019 óta, folyamatosan bővítve, SDK 13.0.29 2026. aug.). Szolgáltatások: Campaign Management,
Reporting, Bulk, Ad Insight, Customer Management, Customer Billing. SOAP **és REST/JSON** – minden műveletnek
van REST végpontja. **SOAP-kivezetés: 2026-10-01-től új funkció csak REST-en, 2027-01-31-én a SOAP megszűnik.**
Új fejlesztés csak REST.

**Hitelesítés és hozzáférés.** Microsoft identity platform OAuth 2.0 (MSA vagy Entra munkahelyi fiók, PKCE),
scope `https://ads.microsoft.com/msads.manage offline_access`; access token ~1 óra, refresh token hosszú
(~90 nap), `invalid_grant` esetén újra-consent. Fejlesztői token Super Adminként a DevSettings oldalon,
saját fiókra gyakorlatilag azonnal; sandbox univerzális token. Fejlécek: `DeveloperToken`, `CustomerId`,
`CustomerAccountId`. Mivel a gateway már Entra-bejelentkezéssel megy, ez a platform illeszkedik legjobban
a meglévő OAuth-rétegbe.

**Olvasás.** `GetAccountsInfo`, `GetCampaignsByAccountId`, `GetAdGroupsByCampaignId`, `GetAdsByAdGroupId`,
`GetKeywordsByAdGroupId`, kritériumok. Riport **aszinkron**: `SubmitGenerateReport → Poll → zip CSV letöltés`
(2–15 perces pollozás, letöltő URL 5 percig él). Oszlopok: `Spend, Impressions, Clicks, Ctr, AverageCpc,
AverageCpm, Conversions, ConversionRate, CostPerConversion, Revenue, ReturnOnAdSpend, ImpressionSharePercent,
QualityScore`. Közönségek (`GetAudiencesByIds`: remarketing, in-market, customer list, similar), UET tagek,
konverziós célok, Ad Insight (kulcsszóötlet, licitbecslés).

**Írás.** `AddCampaigns/UpdateCampaigns` (Search, Shopping, Audience, PerformanceMax, Hotel, App), napi
keret vagy megosztott `BudgetId`, licit **csak kampányszinten** (EnhancedCpc, MaxClicks, MaxConversions
[+TargetCpa], MaxConversionValue [+TargetRoas], TargetImpressionShare), ad groupok (1 000/hívás), hirdetések
(Responsive Search Ad, Responsive Ad, 50/hívás), kulcsszavak és negatívok, célzás (`AddAdGroupCriterions`:
hely, kor, nem, eszköz, napszak, LinkedIn-profil), közönség-hozzárendelés; ügyféllista csak Bulk-kal
(SHA-256); `AddMedia` képek. **Google-import API-ból** (`GoogleImportJob`), de az import-credential csak
UI-ból hozható létre.

**Korlátok.** Throttling nem publikált (60 mp-es csúszóablak, hiba 117), Bulk 4204, Reporting 207
párhuzamossági limit. Sandbox külön regisztrációval, de riportadata csak szintetikus.

**SDK.** .NET, Java, PHP, Python; **Node.js nincs**. REST + fetch Node-ból járható és egyben az egyetlen
jövőbiztos út.

**Hivatalos MCP.** Microsoft Advertising MCP Server (béta, Entra OAuth), **csak olvasó**. Közösségi: több kis repo.

**Buktatók.** REST dokumentáció automatikusan generált és szűkszavú, a SOAP-szemantika (PartialErrors,
`ReturnAdditionalFields`) átöröklődik; Customer Management teljes objektumot ír felül; magyar nyelvcélzás
„nem mindenkinek elérhető”; Magyarországon Bing ≈1,6% desktop / 0,2% mobil részesedés.

### 2.4 TikTok Marketing API

**API.** **v1.3** (2022 óta, v1.4 nincs bejelentve), bázis `https://business-api.tiktok.com/open_api/v1.3/`,
sandbox `https://sandbox-ads.tiktok.com/…`. Válaszboríték `code/message/request_id/data`, HTTP 200 hibánál is.

**Hitelesítés és hozzáférés.** Fejlesztői app a TikTok for Business portálon, review **2–3 munkanap**,
max 5 app. OAuth auth-code → `POST /oauth2/access_token/`; a **hosszú élettartamú advertiser token nem jár le**
(csak visszavonható). Scope-ok háromszintű hierarchiában (Ad Account, Ads Mgmt, Audience, Reporting,
Measurement, Creative, Pixel, Catalog, Lead, Automated Rules, Business Center); írás külön al-scope,
nincs külön „advanced access”. Magyarország 2025 novembere óta önkiszolgáló ad account-létrehozásra elérhető.

**Olvasás.** `/oauth2/advertiser/get/`, `/advertiser/info/`, `/campaign|adgroup|ad/get/`.
Riport `GET /report/integrated/get/`: `data_level` ADVERTISER/CAMPAIGN/ADGROUP/AD, dimenziók (nap, óra, kor,
nem, ország, placement), metrikák `spend, impressions, clicks, ctr, cpc, cpm, reach, conversion,
cost_per_conversion, conversion_rate, complete_payment_roas`; max 365 nap (napi bontásnál 30), aszinkron
`report/task/*`. Közönségek, pixelek és eseménystatisztika, kreatív-keresés, katalógus.

**Írás.** `/campaign/create|update|status/update/` (REACH, TRAFFIC, VIDEO_VIEWS, ENGAGEMENT, LEAD_GENERATION,
APP_PROMOTION, WEB_CONVERSIONS, PRODUCT_SALES [allowlist]; `budget_mode` DAY/TOTAL/DYNAMIC_DAILY; CBO),
`/adgroup/create|update|budget/update|status/update/` (placement, hely, kor, nem, nyelv, érdeklődés,
közönség, `optimization_goal`, `bid_type`, ütemezés, pacing), videó/kép feltöltés, `/ad/create/`
(Spark Ads identitással, CTA, landing URL), `/ad/status/update/` ENABLE/DISABLE/DELETE; custom audience
fájlfeltöltés (SHA-256), lookalike (≥1 000 forrás); Smart+ végpontok.

**Korlátok.** App-szintű Basic 10 QPS / 864 000 hívás/nap (Advanced 20, Premium 30, Ultimate 50 QPS,
szintenként kérhető); `/ad/create/` 5 QPS; aszinkron riport 4 500/nap. Sandbox: egy fiók, mock riportadat
fix 2020-as ablakból, CRUD és feltöltés működik. Hirdetés-review ~24 óra, kreatív/hely módosítás új review.
Riport késleltetés ~11 óra.

**SDK.** Hivatalos `tiktok-business-api-sdk` JS/Python/Java (open beta, Swagger-generált). Node-ból a
sima HTTP is egyszerű.

**Hivatalos MCP.** **TikTok for Business MCP Server** (2026. július): remote HTTP, DCR + PKCE OAuth, ~400 tool
(flat) vagy ~40 core tool (layer), 3 QPS/tool/felhasználó. Közösségi: kis Python olvasó szerverek.

**Buktatók.** Sok funkció allowlist mögött (PRODUCT_SALES, Search Ads, speciális kategóriák EU-ban);
videóspec 9:16 ≥540×960; GDPR: kampány-végpontok használata a TikTok Online Data Terms elfogadását jelenti,
EU-adatkezelő TikTok Technology Ltd (Dublin).

### 2.5 LinkedIn Marketing API

**API.** Verziózott REST `https://api.linkedin.com/rest/`, kötelező `Linkedin-Version: YYYYMM` fejléc
(hiányzó vagy lejárt verzió hibát ad). **Aktuális 202608**, havi kiadás, ≥1 év támogatás → **évente kötelező
verzióváltás**. Rest.li 2.0 protokoll: `List(...)` és `(key:value)` paraméter-szintaxis, szelektív URL-kódolás,
batch fejlécek, `$set` patch, létrehozott ID az `x-restli-id` fejlécben.

**Hitelesítés és hozzáférés.** LinkedIn Page + fejlesztői app, „Advertising API” termékigénylés. Minden app
**Development tierben** indul: korlátlan olvasás a saját adminisztrált fiókokon, **legfeljebb 5 ad account
írása**, 1 API-n létrehozott tesztfiók. **Standard tier** support-ticket + videódemó, átfutás nem publikált
(közösségi tapasztalat 1–4 hónap), diszkrecionális. **Nincs sandbox, minden tier éles adaton fut.**
OAuth csak 3-legged; scope-ok `r_ads, rw_ads, r_ads_reporting, r_organization_social, rw_organization_admin`;
külön termékigénylés a Matched Audiences (`rw_dmp_segments`), Conversions API (`rw_conversions`) és Lead Sync
funkciókhoz. Access token 60 nap, programozott refresh token 365 nap (elfogadott partnereknek). `rw_ads`-hez
ACCOUNT_MANAGER / CAMPAIGN_MANAGER szerep kell az ad accounton.

**Olvasás.** `adAccounts`, `adAccountUsers`, campaign groups, campaigns, creatives (kritériumszűréssel).
`adAnalytics`: pivot ACCOUNT/CAMPAIGN_GROUP/CAMPAIGN/CREATIVE/CONVERSION/MEMBER_*, `timeGranularity`
DAILY/MONTHLY; **max 20 metrika/kérés**, nincs lapozás (≤15 000 elem), napi adat 6 hónapig; metrikák
`impressions, clicks, costInLocalCurrency, externalWebsiteConversions, landingPageClicks, oneClickLeads,
videoViews`. Targeting facetek és typeahead, DMP szegmensek, konverziók, Insight Tag, Lead Gen formok és válaszok
(webhook 2026. márciustól kötelezően validált HTTPS).

**Írás.** Campaign group, campaign (`objectiveType` BRAND_AWARENESS / ENGAGEMENT / LEAD_GENERATION /
WEBSITE_CONVERSIONS / WEBSITE_VISITS / VIDEO_VIEWS / JOB_APPLICANTS; `type` SPONSORED_UPDATES / TEXT_AD /
SPONSORED_INMAILS / DYNAMIC; `costType` CPC/CPM/CPV; `dailyBudget`/`totalBudget`; `unitCost`; `runSchedule`;
`targetingCriteria`; `optimizationTargetType`; státusz ACTIVE/PAUSED/ARCHIVED/COMPLETED/CANCELED/DRAFT),
kreatívok (posts + images/videos API, `intendedStatus`; review alatt nem szüneteltethető), DMP szegmens
létrehozás és feltöltés, konverziós szabályok, Insight Tag. Batch create/update támogatott.

**Korlátok.** App- és tagonkénti napi kvóta, **nem publikált**, csak a Developer Portal Analytics fülén látszik;
429 túllépésnél, throttling fejléc nincs. Min. napi keret ~10 USD. Max 1 000 aktív kampány/fiók,
100 kreatív/kampány; a LinkedIn napi keret 150%-áig költhet.

**SDK.** Hivatalos `linkedin-api-client` (npm) generikus Rest.li wrapper, béta, 2024 óta nem frissült.
Sima HTTP kézi Rest.li-kódolással járható.

**Hivatalos MCP.** **Nincs.** Közösségi: `danielpopamd/linkedin-ads-mcp` (TS, 25 tool, R/W), hosted fizetős
variánsok; mind kicsi.

**Buktatók.** Hozzáférés lassú és diszkrecionális; évente kötelező verzióváltás; Rest.li kódolási furcsaságok
(414 → query tunneling); analitika 20 metrika, nincs lapozás; tagadat 24–48 óráig tárolható, targetingre/CRM-
dúsításra nem használható; EGT-ben a csoportcélzás tiltva; B2B-fókusz, magas CPC.

## 3. Összehasonlítás

| Szempont | Meta | Google Ads | Microsoft Ads | TikTok | LinkedIn |
|---|---|---|---|---|---|
| Verzió (2026-09) | v26.0 | v25 | v13 (REST) | v1.3 | 202608 |
| Verzióélet | ~12 hó | ~12 hó | folyamatos | évek | 12 hó, kötelező váltás |
| Gépi hitelesítés | System User token | Service account + dev token (MCC) | OAuth refresh (Entra) | nem lejáró advertiser token | csak 3-legged, 60 napos token, refresh 365 nap |
| Hozzáférés-igénylés | App Review + Business Verification; Full tier forgalom után | Basic ~5 mn, Standard ~10 mn | azonnal (saját fiók) | app review 2–3 mn | Dev tier gyors (5 fiók), Standard hónapok |
| Írás API-ból | teljes | teljes, atomi mutate, `validate_only` | teljes (REST) | teljes | teljes, 5 fiókig Dev tierben |
| Riport | Insights, szinkron + async | GAQL, szinkron stream | async job + CSV | szinkron + async | `adAnalytics`, 20 metrika, nincs lapozás |
| ROAS közvetlenül | `purchase_roas` | `conversions_value_per_cost` | `ReturnOnAdSpend` | `complete_payment_roas` | nincs (bevétel-pivotból számítandó) |
| Sandbox | van, Insights nélkül | tesztfiók, metrika nélkül | van, szintetikus riport | van, mock riport | **nincs** |
| Node SDK | hivatalos (npm lemarad) | nincs hivatalos | nincs | hivatalos (béta) | hivatalos (béta, elavult) |
| Hivatalos MCP | van, R/W | van, csak R | van, csak R (béta) | van, R/W, ~400 tool | nincs |
| HU relevancia | magas | magas | alacsony | közepes, növekvő | B2B-niche |

## 4. Javasolt egységes MCP-architektúra

### 4.1 Elhelyezés

Az Advertising MCP az **AV MCP Gateway új provider-családja**, nem külön szolgáltatás. Amit örököl:
Entra-bejelentkezés és OAuth-proxy a kliensek felé, deklaratív `EndpointDef` toolok, toolset-kapcsolók az
admin felületen, globális read-only mód, `confirmRequired` írási kapu, audit-napló, Újdonságok oldal.
A Salesforce-integráció mintája (opcionális provider, csak konfigurálva regisztrálódik) egy az egyben
átvehető.

```
ChatGPT / Claude / ügynök
        │  MCP (Streamable HTTP) + Entra OAuth
        ▼
AV MCP Gateway
  ├─ graph (M365)            – meglévő
  ├─ salesforce              – meglévő
  └─ ads                     – ÚJ
       ├─ ads-core            egységes modell, KPI-számítás, összehasonlítás
       ├─ ads-approvals       jóváhagyási sor + admin UI
       ├─ ads-credentials     platform-tokenek (titkosítva, data/ads-credentials.json)
       └─ adapterek: meta | google | microsoft | tiktok | linkedin
                     (mindegyik: auth, read, write, report, normalize)
```

### 4.2 Hitelesítési modell

A hirdetési platformoknál a hozzáférés jellemzően **fiók-, nem személyalapú** (system user, service account,
advertiser token). Ezért a Salesforce-tól eltérően nem felhasználónként kötnek össze fiókot, hanem:

- A platform-hitelesítők **szerveroldalon**, titkosítva tárolódnak, az admin felületen adhatók meg
  (Meta system user token, Google service account JSON + dev token + MCC ID, TikTok advertiser token,
  Microsoft és LinkedIn refresh token egy technikai felhasználó egyszeri OAuth-jából).
- Az **Entra-felhasználó** a jogosultsági egység: az admin felületen adható meg, ki mely hirdetési fiókokhoz
  fér hozzá, és olvasó vagy író szinten. Minden hívás auditálva a hívó Entra-identitásával.
- Token-frissítés és lejárat-figyelés adapterenként (Meta 60 napos rotáció, Microsoft/LinkedIn refresh,
  LinkedIn 365 napos refresh-lejárat előtti figyelmeztetés a portálon).

### 4.3 Egységes adatmodell

Öt közös entitás, mindegyiken `platform`, `platformId`, `accountId`, `url`, plus a platform nyers objektuma
`raw` alatt, hogy semmi ne vesszen el:

- **AdAccount** – id, név, pénznem, időzóna, státusz, költéslimit.
- **Campaign** – cél (egységes enum: awareness / traffic / engagement / leads / sales / app + a platform nyers
  célja), státusz (active / paused / ended / draft / review), keret (napi vagy lifetime, összeg, pénznem),
  licitstratégia (egységes enum + nyers), ütemezés.
- **AdGroup** (Meta ad set, Google ad group, TikTok adgroup, LinkedIn campaign, Microsoft ad group) –
  célzás egységes vázzal (földrajz, kor, nem, nyelv, közönségek, placementek) + nyers spec.
- **Ad / Creative** – formátum, szöveg-elemek, média-hivatkozások, landing URL, review-státusz.
- **Audience** – típus (custom list / website / lookalike / platform-szegmens), méret, forrás.

**Metrikák** egységes névvel, platformonként leképezve: `spend, impressions, clicks, ctr, cpc, cpm, reach,
conversions, conversionValue, cpa, roas`. Ahol a platform nem ad közvetlen ROAS-t (LinkedIn), a gateway
számolja; ahol a pénz mikróban jön (Google), a gateway konvertál. Minden metrikasor viszi az attribúciós
beállítást és az adatfrissesség-időbélyeget (TikTok ~11 óra, Microsoft async riport).

### 4.4 Toolsetek és jogosultsági szintek

Három, egymástól függetlenül kapcsolható toolset, a meglévő `WRITE_TOOLSETS` mintára:

| Toolset | Tartalom | Kapu |
|---|---|---|
| `ads` (olvasó) | fiókok, kampányhierarchia, kreatívok, közönségek, targeting-keresés, riportok, platformok közti összehasonlítás, ajánlások | nincs |
| `ads-write` | kampány/ad group/ad létrehozás **szüneteltetett** állapotban, módosítás, szüneteltetés, kreatív feltöltés, közönség létrehozás, negatív kulcsszavak | `confirm=true` (mint ma) |
| `ads-finance` | kampány **aktiválása**, költségkeret **emelése**, licit emelése, lifetime keret vagy `spend_cap` módosítása, ügyféllista feltöltés | `confirm=true` **+ jóváhagyási sor** |

A `create-*` toolok alapból `PAUSED` állapotban hoznak létre mindent, az AI így teljes kampánystruktúrát tud
előkészíteni pénzügyi kockázat nélkül; az élesítés külön `ads-finance` művelet.

### 4.5 Emberi jóváhagyási pont

Az `ads-finance` toolok nem hajtják végre a műveletet, hanem **jóváhagyási kérelmet** hoznak létre
(`data/ads-approvals.jsonl`): platform, fiók, művelet, előtte/utána érték, becsült havi költéshatás, a kérő
Entra-felhasználó, az AI által megadott indoklás. A tool válasza a kérelem azonosítója és a jóváhagyó URL.
A jóváhagyás a **portálon** történik (meglévő Entra-bejelentkezés), egy admin felületen kijelölt jóváhagyói
körrel; szabály szerint a kérő nem hagyhatja jóvá a sajátját. Jóváhagyás után a gateway végrehajtja, az
eredményt visszaírja a kérelemre, és az AI a `get-ads-approval` toollal lekérdezheti. Lejárat 72 óra.
Az admin felületen küszöb állítható (pl. 50 000 Ft/hó alatti keretemelés nem igényel második jóváhagyást).

### 4.6 Biztonsági és üzemeltetési elemek

- **Dry run** minden írás előtt, ahol a platform adja (Google `validate_only`), máshol séma-validáció a
  gateway-ben (kötelező mezők, Meta `special_ad_categories`, PMax asset-minimumok).
- **Rate limit adapterenként** token-bucket, a platform saját fejléceinek olvasásával (Meta BUC, TikTok 40100,
  Google RESOURCE_EXHAUSTED); riportok cache-elése 15 percre.
- **Aszinkron riport-minta** egységesen: `cursor`/`nextCursor` mint ma, plus `jobId` pollozás (Meta AdReportRun,
  Microsoft SubmitGenerateReport, TikTok report/task).
- **Verzió-naptár**: Meta és Google évi két, LinkedIn évi egy kötelező verzióváltás; a verzió konfigurálható,
  a portál figyelmeztet a lejárat előtt 60 nappal.
- **Audit**: minden írás és minden jóváhagyás a meglévő JSONL-naplóba, platform-rekordazonosítóval.
- **Hivatalos MCP-k** (Meta, TikTok, Google, Microsoft) opcionálisan **upstream proxyként** beköthetők a
  felfedező munkához; ez egy külön, kisebb feladat, és nem helyettesíti a saját írási és riport-réteget.

### 4.7 Tool-lista vázlat (első kör)

Olvasó: `list-ad-accounts`, `list-ad-campaigns`, `get-ad-campaign`, `list-ad-groups`, `list-ads`,
`get-ad-creative`, `list-ad-audiences`, `search-ad-targeting`, `get-ads-performance` (bármely szint, egységes
KPI-k, időtartomány, bontás), `compare-ads-performance` (több platform/kampány egy táblában),
`list-ad-recommendations` (Google Recommendations, Meta issues, TikTok diagnosztika),
`get-ads-approval`.

Író (`ads-write`): `create-ad-campaign`, `update-ad-campaign`, `pause-ad-campaign`, `create-ad-group`,
`update-ad-group`, `upload-ad-media`, `create-ad`, `update-ad`, `create-ad-audience`, `add-negative-keywords`.

Pénzügyi (`ads-finance`): `activate-ad-campaign`, `set-ad-budget`, `set-ad-bid`, `end-ad-campaign`
(lezárás visszafordíthatatlan egyes platformokon), `upload-ad-customer-list`.

Első körben ~30 tool; a platformspecifikus paraméterek (`platformOptions`) nyersen átadhatók, hogy a közös
modell ne legyen szűk keresztmetszet.

## 5. Munkaigény-becslés

Egy senior TypeScript-fejlesztő, a meglévő gateway-re építve, tesztekkel és dokumentációval; a platformok
hozzáférés-igénylési átfutása külön sor.

| Munkacsomag | Tartalom | Nap |
|---|---|---|
| Alapréteg | egységes modell, adapter-interfész, credential-tár + admin UI, jogosultság fiókonként, jóváhagyási sor + portál UI, KPI-normalizálás, összehasonlító tool, riport-cache, rate-limit keret | 12–15 |
| Meta | system user auth, olvasás, Insights (sync+async), kampány/ad set/ad/kreatív írás, közönségek, review-státusz | 11–13 |
| Google Ads | service account + MCC, GAQL riport, atomi mutate (keret+kampány+ad group+RSA), PMax asset group, Customer Match, `validate_only` | 12–15 |
| TikTok | app + token, olvasás, riport (sync+async), kampány/adgroup/ad írás, videófeltöltés, Spark Ads, közönség | 8–10 |
| LinkedIn | 3-legged OAuth + refresh, Rest.li réteg, olvasás, `adAnalytics`, campaign/creative írás, verzió-kezelés | 9–11 |
| Microsoft Ads | Entra OAuth, REST réteg, olvasás, async riport, kampány/ad group/ad/kulcsszó írás, Google-import kiváltó | 8–10 |
| **Összesen** | | **60–74** |

Átfutási idők a kritikus úton (a fejlesztéssel párhuzamosan indítandó):

| Platform | Igénylés | Várható átfutás |
|---|---|---|
| Google Ads | MCC + dev token, Basic access; később Standard | 1 hét; +2 hét |
| Meta | App, Business Verification, App Review (`ads_management` Advanced); Full tier forgalom után | 1–3 hét; +15 nap forgalom |
| TikTok | fejlesztői app + scope review | 2–3 munkanap |
| LinkedIn | Advertising API Development tier; Standard csak ha >5 fiók | napok; hónapok |
| Microsoft | dev token saját fiókra | azonnal |

Javasolt ütemezés: **1. ütem** alapréteg + Meta + Google (~6–8 hét, a Grandopet-példa ezzel már működik),
**2. ütem** TikTok + LinkedIn (~4 hét), **3. ütem** Microsoft (~2 hét) és a további platformok felmérése.

## 6. Kockázatok és nyitott kérdések

- **Melyik fiókok?** Tisztázandó, hogy a Grandopet és a többi márka hirdetési fiókjai mely Business
  Manager / MCC / Business Center alatt vannak, és van-e admin-jogosultságunk system user, illetve service
  account létrehozására. Ügynökségi kezelésű fiók esetén az ügynökséggel kell egyeztetni.
- **Meta Full Access** csak élő forgalom után adható; az első hetekben Limited tier rate limitjével kell
  számolni (60 pont / 300 mp blokk), ami egy közös gateway-en gyorsan elfogy.
- **LinkedIn Standard tier** diszkrecionális; ha ötnél több ad accountot kell írni, ez hónapokig húzódhat.
- **Riport-tesztelés** csak éles fiókon lehetséges (Google tesztfiók és Meta sandbox nem ad metrikát).
- **Kreatív-review** minden platformon aszinkron; az AI által létrehozott hirdetés elutasítása kezelendő
  állapot, nem hiba.
- **Adatvédelem**: ügyféllista-feltöltés (Customer Match, Custom Audience, DMP segment) hash-elt személyes
  adat; jogalap és adatkezelési tájékoztató szükséges, ezért került az `ads-finance` szintre.
- **Második ütem**: a felmérés a további platformokra (pl. Criteo, Pinterest, Snapchat, programmatic DSP-k,
  Árukereső/marketplace-hirdetések) az első ütem tapasztalataival készíthető el; adapter-interfész miatt
  platformonként 5–10 nap.

## Források

A platformonkénti fejezetek a hivatalos fejlesztői dokumentációra épülnek: developers.facebook.com
(Marketing API), developers.google.com/google-ads/api, learn.microsoft.com/advertising,
business-api.tiktok.com/portal/docs, learn.microsoft.com/linkedin/marketing; a hivatalos MCP-szerverek
bejelentései a platformok fejlesztői blogjain (Meta 2026-07-16, TikTok 2026-07, Google googleads/google-ads-mcp,
Microsoft mcp-setup útmutató). Piaci részesedés: StatCounter (Magyarország, 2024. október).
