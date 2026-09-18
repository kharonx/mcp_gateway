import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import type { SqlClient } from "../../sql/client.js";

/**
 * Toolset "vectory-sql": direct, READ-ONLY queries on the Vectory replica
 * (meditrade) and the AP2/alphavet database, for what the TT MCP tools do not
 * cover. Every query is parameterised and row-capped; the ad-hoc tool accepts
 * only a single validated SELECT. Customer key everywhere is the TT
 * "vectorykod": meditrade UGYFEL.VEVOKOD (NOT UGYFELKOD!), alphavet
 * UGYFEL.UGYFELKOD. A customer may have two codes (vectorykod, vectorykod_szla):
 * query both and de-duplicate by invoice number.
 */

const SCOPES = ["Vectory SQL (read-only login)"];

export function requireSql(ctx: ToolContext): SqlClient {
  if (!ctx.sql) throw new Error("Vectory SQL is not configured on this gateway (admin: Vectory SQL settings).");
  return ctx.sql;
}

function maxItemsOf(args: Record<string, any>, ctx: ToolContext): number {
  return Math.min(Number(args.maxItems) || ctx.config.defaultPageItems, ctx.config.maxPageItems);
}

function dateArg(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${name} must be YYYY-MM-DD`);
  return s;
}

const src = (id: unknown, type: string) => ({ _source: { sourceType: "vectory", sourceId: String(id ?? ""), objectType: type } });

/** Software product recognition rules from the TT/Vectory guide. */
export function classifySoftware(etk: string, name: string): { isSoftware: boolean; category?: string } {
  const e = (etk ?? "").toUpperCase();
  const n = name ?? "";
  // Guide rule (DV/DFV/ISIT/SZOFTVER) plus the ISDF* codes the category rules themselves rely on (ISDFC = Cloud, ISDFV = TT).
  const isSoftware = /^(DV|DFV|ISIT|ISDF|SZOFTVER)/.test(e);
  if (!isSoftware) return { isSoftware: false };
  let category = "EGYEB";
  if (/cloud/i.test(n) || e.startsWith("ISDFC")) category = "CLOUD";
  else if (/^doki for farm/i.test(n)) category = "FARM";
  else if (/^booked4us/i.test(n) || e === "DFVOITM") category = "B4US";
  else if (/^isdfv/i.test(n)) category = "TT";
  else if (e.startsWith("DFVTT") || e === "DFVCKL") category = "TTREGI";
  else if (e.startsWith("ISIT")) category = "IT";
  return { isSoftware: true, category };
}

export function softwareMonths(etk: string, name: string, qty: number): number | undefined {
  const n = name ?? "";
  const e = (etk ?? "").toUpperCase();
  if (/hónapra/i.test(n) || /cloud/i.test(n) || e.startsWith("ISDFC") || /booked4us/i.test(n)) return Math.max(0, Number(qty) || 0);
  if (/éves díj/i.test(n) || /\b1\s*év/i.test(n)) return 12;
  if (/féléves/i.test(n)) return 6;
  return undefined;
}

export function licenceCounts(name: string): { clients?: number; servers?: number } {
  const c = name?.match(/(\d+)\s*(kliens|munkaállomás)/i);
  const s = name?.match(/(\d+)\s*szerver/i);
  return { clients: c ? Number(c[1]) : undefined, servers: s ? Number(s[1]) : undefined };
}

function tier(netTotal: number): string {
  if (netTotal >= 10_000_000) return "fekete";
  if (netTotal >= 2_000_000) return "arany";
  if (netTotal >= 1_500_000) return "ezüst";
  if (netTotal >= 1_000_000) return "bronz";
  return "-";
}

const INVOICE_SELECT = `
SELECT sz.SZIKTSZAM, sz.SZLASZAM, sz.SZKELTE, sz.SZFIZHAT, sz.SZNETTOERT, sz.SZBRUTTERT, sz.SZFIZERT,
       sz.SZLAJELZO, sz.DEVIZANEM, sz.SZLAALL1, u.UGYFELKOD, u.VEVOKOD,
       CASE WHEN ABS(sz.SZFIZERT) - ABS(sz.SZBRUTTERT) >= -0.01 THEN 1 ELSE 0 END AS Kifizetve,
       CASE
         WHEN EXISTS (SELECT 1 FROM tetel t INNER JOIN tetelssz45 ts ON ts.tetelssz4 = t.tetelssz WHERE t.SZIKTSZAM = sz.SZIKTSZAM) THEN 'Sztornózott'
         WHEN EXISTS (SELECT 1 FROM tetel t INNER JOIN tetelssz45 ts ON ts.tetelssz5 = t.tetelssz WHERE t.SZIKTSZAM = sz.SZIKTSZAM) THEN 'Sztornó'
         ELSE '' END AS SztornoStatusz
FROM SZAMLA sz
INNER JOIN UGYFEL u ON u.UGYFELKOD = sz.UGYFELKOD`;

export const vectorySqlEndpoints: EndpointDef[] = [
  {
    name: "vectory-find-customer",
    description:
      "FIND a customer in Vectory (meditrade) by name fragment, tax number, VEVOKOD (the TT 'vectorykod') or phone-number suffix (digits only, 6-12 from the end; matched against the alphavet contact tables). Returns VEVOKOD - the key every other Vectory/AP2 tool uses - plus name, tax number, city, debt. One customer may have several UGYFELKOD rows under one VEVOKOD. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/customers",
    resourceType: "vectory",
    extraInput: {
      name: z.string().optional().describe("Name fragment (UGYFNEV / UGYFTNEV LIKE %x%)"),
      taxNumber: z.string().optional().describe("Tax number (UGYFADOSZ), prefix match"),
      vevokod: z.string().optional().describe("Exact VEVOKOD (TT vectorykod)"),
      phoneSuffix: z.string().optional().describe("Phone number suffix, digits only (6-12)"),
      maxItems: z.number().int().optional(),
    },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const max = maxItemsOf(args, ctx);
      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (args.vevokod) { where.push("u.VEVOKOD = @vevokod"); params.vevokod = String(args.vevokod); }
      if (args.name) { where.push("(u.UGYFNEV LIKE @name OR u.UGYFTNEV LIKE @name)"); params.name = `%${String(args.name)}%`; }
      if (args.taxNumber) { where.push("u.UGYFADOSZ LIKE @tax"); params.tax = `${String(args.taxNumber).replace(/[^0-9-]/g, "")}%`; }
      if (args.phoneSuffix) {
        const suffix = String(args.phoneSuffix).replace(/\D/g, "").slice(-12);
        if (suffix.length < 6) throw new Error("phoneSuffix must contain at least 6 digits.");
        params.suffix = `%${suffix}`;
        where.push(`u.VEVOKOD IN (
          SELECT DISTINCT au.VEVOKOD FROM alphavet.dbo.UGYFEL au
          LEFT JOIN alphavet.dbo.SZEMELY s ON s.UGYFELKOD = au.UGYFELKOD
          LEFT JOIN alphavet.dbo.SZEMTELE st ON st.SZEMELYKOD = s.SZEMELYKOD
          LEFT JOIN alphavet.dbo.UGYFTELE ut ON ut.UGYFELKOD = au.UGYFELKOD
          WHERE au.VEVOKOD IS NOT NULL AND (
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(st.TELEKOD,''),' ',''),'-',''),'/',''),'+',''),'(','') LIKE @suffix
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(ut.TELEKOD,''),' ',''),'-',''),'/',''),'+',''),'(','') LIKE @suffix))`);
      }
      if (!where.length) throw new Error("Give at least one of name, taxNumber, vevokod or phoneSuffix.");
      const q = `SELECT u.VEVOKOD, u.UGYFELKOD, u.UGYFNEV, u.UGYFTNEV, u.UGYFADOSZ, u.TUTCA, t.TELEPULES, t.PIRKOD, u.PENZNEM, u.HALADEK, u.TARTOZAS, u.HITELKERET
        FROM UGYFEL u LEFT JOIN TCIM t ON t.CIMKOD = u.TCIMKOD
        WHERE ${where.join(" AND ")} ORDER BY u.UGYFTNEV`;
      const r = await db.select(q, params, max);
      return { count: r.rows.length, truncated: r.truncated, items: r.rows.map((x) => ({ ...x, ...src(x.VEVOKOD, "customer") })) };
    },
  },
  {
    name: "vectory-customer",
    description:
      "Vectory customer card by VEVOKOD (TT vectorykod): all UGYFEL rows under that code (name, tax number, address, currency, payment days HALADEK, debt TARTOZAS, credit limit), contacts from alphavet (persons with phone/e-mail, company phone/e-mail), licence counts (ugyfjell 715 server / 716 client) and sales representatives (UGYFUCS: Vet / Pet). Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/customers/{vevokod}",
    pathParamDescriptions: { vevokod: "VEVOKOD (TT vectorykod)" },
    resourceType: "vectory",
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const vevokod = String(args.vevokod);
      const cust = await db.select(
        `SELECT u.UGYFELKOD, u.VEVOKOD, u.UGYFNEV, u.UGYFTNEV, u.UGYFADOSZ, u.TUTCA, t.TELEPULES, t.PIRKOD, u.PENZNEM, u.HALADEK, u.TARTOZAS, u.HITELKERET
         FROM UGYFEL u LEFT JOIN TCIM t ON t.CIMKOD = u.TCIMKOD WHERE u.VEVOKOD = @vevokod`,
        { vevokod },
        50
      );
      if (!cust.rows.length) throw new Error(`No Vectory customer with VEVOKOD ${vevokod}.`);
      const code = Number(vevokod);
      const persons = Number.isFinite(code)
        ? await db.select(
            `SELECT s.szemelykod, s.szemelynev, s.beosztas, s.titulus, s.aktiv, st.komkod, st.telekod
             FROM alphavet.dbo.szemely s LEFT JOIN alphavet.dbo.szemtele st ON st.szemelykod = s.szemelykod
             WHERE s.ugyfelkod = @code ORDER BY s.szemelynev`,
            { code },
            200
          )
        : { rows: [], truncated: false };
      const companyContacts = Number.isFinite(code)
        ? await db.select(
            `SELECT ut.KOMKOD, k.KOMTIPUS, ut.TELEKOD FROM alphavet.dbo.UGYFTELE ut LEFT JOIN alphavet.dbo.KOMJELL k ON k.KOMKOD = ut.KOMKOD WHERE ut.UGYFELKOD = @code`,
            { code },
            50
          )
        : { rows: [], truncated: false };
      const licences = Number.isFinite(code)
        ? await db.select(`SELECT jelkod, ertek FROM alphavet.dbo.ugyfjell WHERE ugyfelkod = @code AND jelkod IN (715, 716)`, { code }, 10)
        : { rows: [], truncated: false };
      const reps = Number.isFinite(code)
        ? await db.select(
            `SELECT cs.UGYFCSNEV1, cs.szulo FROM alphavet.dbo.UGYFUCS uc INNER JOIN alphavet.dbo.UGYFCSOP cs ON cs.UGYFCSOP = uc.UGYFCSOP WHERE uc.UGYFELKOD = @code AND cs.szulo IN (174, 176)`,
            { code },
            20
          )
        : { rows: [], truncated: false };
      const byPerson = new Map<string, any>();
      for (const p of persons.rows) {
        const key = String(p.szemelykod);
        const cur = byPerson.get(key) ?? { szemelykod: p.szemelykod, name: p.szemelynev, position: p.beosztas, title: p.titulus, active: String(p.aktiv) === "1", phones: [] as string[], emails: [] as string[] };
        if (p.telekod) (Number(p.komkod) === 7 ? cur.emails : cur.phones).push(String(p.telekod));
        byPerson.set(key, cur);
      }
      return {
        vevokod,
        customers: cust.rows.map((x) => ({ ...x, ...src(vevokod, "customer") })),
        contacts: [...byPerson.values()],
        companyContacts: companyContacts.rows.map((c) => ({ type: c.KOMTIPUS === "E" ? "email" : "phone", value: c.TELEKOD })),
        licences: { serverLicences: licences.rows.find((l) => Number(l.jelkod) === 715)?.ertek, clientLicences: licences.rows.find((l) => Number(l.jelkod) === 716)?.ertek },
        representatives: reps.rows.map((r) => ({ name: r.UGYFCSNEV1, area: Number(r.szulo) === 174 ? "Vet" : "Pet" })),
        ...src(vevokod, "customer"),
      };
    },
  },
  {
    name: "vectory-invoices",
    description:
      "Vectory outgoing invoices of a customer (VEVOKOD): invoice number, date, due date, net, gross, paid amount, paid flag, type (SZLAJELZO), state (SZLAALL1; 3 = final), currency and storno status (Sztornózott = this invoice was cancelled, Sztornó = this is the cancelling invoice). Optional date range on SZKELTE, newest first. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/customers/{vevokod}/invoices",
    pathParamDescriptions: { vevokod: "VEVOKOD (TT vectorykod)" },
    resourceType: "vectory",
    paginated: true,
    extraInput: {
      from: z.string().optional().describe("SZKELTE >= YYYY-MM-DD"),
      to: z.string().optional().describe("SZKELTE <= YYYY-MM-DD"),
      unpaidOnly: z.boolean().optional().describe("Only invoices that are not fully paid"),
      maxItems: z.number().int().optional(),
    },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const params: Record<string, unknown> = { vevokod: String(args.vevokod) };
      const where = ["u.VEVOKOD = @vevokod"];
      const from = dateArg(args.from, "from"), to = dateArg(args.to, "to");
      if (from) { where.push("sz.SZKELTE >= @from"); params.from = from; }
      if (to) { where.push("sz.SZKELTE < DATEADD(DAY, 1, CAST(@to AS DATE))"); params.to = to; }
      if (args.unpaidOnly) where.push("ABS(sz.SZFIZERT) - ABS(sz.SZBRUTTERT) < -0.01");
      const r = await db.select(`${INVOICE_SELECT} WHERE ${where.join(" AND ")} ORDER BY sz.SZKELTE DESC, sz.SZIKTSZAM DESC`, params, maxItemsOf(args, ctx));
      return { count: r.rows.length, truncated: r.truncated, items: r.rows.map((x) => ({ ...x, Kifizetve: Number(x.Kifizetve) === 1, ...src(x.SZLASZAM, "invoice") })) };
    },
  },
  {
    name: "vectory-invoice-items",
    description:
      "Line items of one Vectory invoice (by SZLASZAM invoice number or SZIKTSZAM id): product code ETK, name, quantity, net unit price, discount %, net line value, purchase value (margin = NTETELERT - BESZERTEK), movement type MOZGNEM (<200 incoming, >200 outgoing), fulfilment date, product group. Software lines are classified (CLOUD / FARM / B4US / TT / TTREGI / IT) with covered months and licence counts. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/invoices/{invoice}/items",
    pathParamDescriptions: { invoice: "SZLASZAM (invoice number, e.g. F005049/25E) or numeric SZIKTSZAM" },
    resourceType: "vectory",
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const key = String(args.invoice);
      const byId = /^\d+$/.test(key);
      const r = await db.select(
        `SELECT t.TETELSSZ, t.ETK, c.CIKKNEV1, t.TETELMENNY, t.TETELAR, t.TETENGEDM, t.NTETELERT, t.BESZERTEK, t.MOZGNEM, t.TETTELJDAT,
                sz.SZLASZAM, sz.SZKELTE, sz.SZIKTSZAM, cs.CIKKCSNEV1
         FROM TETEL t
         INNER JOIN SZAMLA sz ON sz.SZIKTSZAM = t.SZIKTSZAM
         LEFT JOIN CIKK c ON c.ETK = t.ETK
         LEFT JOIN CIKKCCS ccs ON ccs.ETK = t.ETK
         LEFT JOIN CIKKCSOP cs ON cs.CIKKCSOP = ccs.CIKKCSKOD
         WHERE ${byId ? "sz.SZIKTSZAM = @id" : "sz.SZLASZAM = @szlaszam"}
         ORDER BY t.TETELSSZ`,
        byId ? { id: Number(key) } : { szlaszam: key },
        1000
      );
      return {
        invoice: key,
        count: r.rows.length,
        items: r.rows.map((x) => {
          const sw = classifySoftware(String(x.ETK ?? ""), String(x.CIKKNEV1 ?? ""));
          return {
            ...x,
            margin: Number(x.NTETELERT ?? 0) - Number(x.BESZERTEK ?? 0),
            direction: Number(x.MOZGNEM) > 200 ? "outgoing" : "incoming",
            ...(sw.isSoftware ? { software: { category: sw.category, months: softwareMonths(String(x.ETK), String(x.CIKKNEV1), Number(x.TETELMENNY)), ...licenceCounts(String(x.CIKKNEV1)) } } : {}),
            ...src(x.SZLASZAM, "invoiceItem"),
          };
        }),
      };
    },
  },
  {
    name: "vectory-customer-software",
    description:
      "Software subscriptions bought by a customer (VEVOKOD) in Vectory: every software line (ETK DV%/DFV%/ISIT%/SZOFTVER%) with category (CLOUD / FARM / B4US / TT / TTREGI / IT), covered months, licence counts and the coverage end date per invoice (SZKELTE + max months x 30.44 days), newest first; plus the latest coverage end per category - use it to see whether a licence is still covered. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/customers/{vevokod}/software",
    pathParamDescriptions: { vevokod: "VEVOKOD (TT vectorykod)" },
    resourceType: "vectory",
    extraInput: { from: z.string().optional().describe("SZKELTE >= YYYY-MM-DD"), maxItems: z.number().int().optional() },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const params: Record<string, unknown> = { vevokod: String(args.vevokod) };
      const from = dateArg(args.from, "from");
      const r = await db.select(
        `SELECT t.ETK, c.CIKKNEV1, t.NTETELERT, t.TETELMENNY, t.TETELAR, t.MOZGNEM, sz.SZLASZAM, sz.SZKELTE, sz.SZIKTSZAM
         FROM TETEL t
         INNER JOIN SZAMLA sz ON sz.SZIKTSZAM = t.SZIKTSZAM
         INNER JOIN UGYFEL u ON u.UGYFELKOD = sz.UGYFELKOD
         INNER JOIN CIKK c ON c.ETK = t.ETK
         WHERE u.VEVOKOD = @vevokod AND (t.ETK LIKE 'DV%' OR t.ETK LIKE 'DFV%' OR t.ETK LIKE 'ISIT%' OR t.ETK LIKE 'ISDF%' OR t.ETK LIKE 'SZOFTVER%')
         ${from ? "AND sz.SZKELTE >= @from" : ""}
         ORDER BY sz.SZKELTE DESC, t.ETK`,
        from ? { ...params, from } : params,
        maxItemsOf(args, ctx)
      );
      const perInvoiceMonths = new Map<string, number>();
      const items: any[] = r.rows.map((x: any) => {
        const sw = classifySoftware(String(x.ETK), String(x.CIKKNEV1));
        const months = softwareMonths(String(x.ETK), String(x.CIKKNEV1), Number(x.TETELMENNY));
        const inv = String(x.SZLASZAM);
        if (months) perInvoiceMonths.set(inv, Math.max(perInvoiceMonths.get(inv) ?? 0, months));
        return { ...x, category: sw.category, months, ...licenceCounts(String(x.CIKKNEV1)), ...src(inv, "invoiceItem") };
      });
      const coverage = new Map<string, { invoice: string; coverageEnd: string }>();
      for (const it of items) {
        const months = perInvoiceMonths.get(String(it.SZLASZAM));
        if (!months || !it.SZKELTE) continue;
        const end = new Date(new Date(it.SZKELTE as string).getTime() + months * 30.44 * 86_400_000);
        (it as any).coverageEnd = end.toISOString().slice(0, 10);
        const cur = coverage.get(String(it.category));
        if (!cur || cur.coverageEnd < (it as any).coverageEnd) coverage.set(String(it.category), { invoice: String(it.SZLASZAM), coverageEnd: (it as any).coverageEnd });
      }
      return { vevokod: args.vevokod, count: items.length, truncated: r.truncated, latestCoverageByCategory: Object.fromEntries(coverage), items };
    },
  },
  {
    name: "vectory-customer-turnover",
    description:
      "Total net turnover of a customer (VEVOKOD) in Vectory (sum of SZAMLA.SZNETTOERT), the TT customer tier derived from it (bronz >= 1M, ezüst >= 1.5M, arany >= 2M, fekete >= 10M HUF) and a per-year breakdown. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/customers/{vevokod}/turnover",
    pathParamDescriptions: { vevokod: "VEVOKOD (TT vectorykod)" },
    resourceType: "vectory",
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const r = await db.select(
        `SELECT YEAR(sz.SZKELTE) AS ev, SUM(sz.SZNETTOERT) AS netto, COUNT(*) AS szamlak
         FROM SZAMLA sz INNER JOIN UGYFEL u ON u.UGYFELKOD = sz.UGYFELKOD
         WHERE u.VEVOKOD = @vevokod GROUP BY YEAR(sz.SZKELTE) ORDER BY ev DESC`,
        { vevokod: String(args.vevokod) },
        100
      );
      const total = r.rows.reduce((a, x) => a + Number(x.netto ?? 0), 0);
      return { vevokod: args.vevokod, totalNet: total, tier: tier(total), byYear: r.rows, ...src(args.vevokod, "customer") };
    },
  },
  {
    name: "vectory-invoice-payment",
    description:
      "When was a Vectory invoice (SZLASZAM) paid: the last bank entry (banktetel tipus 1,2,4,5) for the invoice, or - when it was settled from an advance (afa_ki.eiktszam <> 0) - the invoice date; null when not fully paid. Also returns the amounts. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/invoices/{invoice}/payment",
    pathParamDescriptions: { invoice: "SZLASZAM invoice number" },
    resourceType: "vectory",
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const r = await db.select(
        `SELECT sz.SZLASZAM, sz.SZKELTE, sz.SZFIZHAT, sz.SZBRUTTERT, sz.SZFIZERT,
           CASE WHEN ABS(sz.SZFIZERT) - ABS(sz.SZBRUTTERT) >= -0.01 THEN 1 ELSE 0 END AS Kifizetve,
           COALESCE(
             (SELECT MAX(b.bizdatum) FROM banktetel b WHERE b.tipus IN (1,2,4,5) AND b.iktatoszam = sz.SZIKTSZAM AND ABS(sz.SZFIZERT) - ABS(sz.SZBRUTTERT) >= -0.01),
             (SELECT TOP 1 sz.SZKELTE FROM afa_ki a WHERE a.sziktszam = sz.SZIKTSZAM AND ISNULL(a.eiktszam,0) <> 0 AND ABS(sz.SZFIZERT) - ABS(sz.SZBRUTTERT) >= -0.01)) AS Befizetve
         FROM SZAMLA sz WHERE sz.SZLASZAM = @szlaszam`,
        { szlaszam: String(args.invoice) },
        5
      );
      if (!r.rows.length) throw new Error(`No Vectory invoice ${args.invoice}.`);
      const x = r.rows[0];
      return { ...x, Kifizetve: Number(x.Kifizetve) === 1, ...src(x.SZLASZAM, "invoice") };
    },
  },
  {
    name: "vectory-product-search",
    description:
      "Search Vectory products (CIKK) by name fragment or ETK code prefix: ETK, name, product group and the current list price (ARTORZS, ARTIPUS 13, latest ARNAPTOL). Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/products",
    resourceType: "vectory",
    extraInput: { query: z.string().min(2).describe("Name fragment or ETK prefix"), maxItems: z.number().int().optional() },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const q = String(args.query);
      const r = await db.select(
        `SELECT c.ETK, c.CIKKNEV1, cs.CIKKCSNEV1,
           (SELECT TOP 1 a.CIKKAR FROM ARTORZS a WHERE a.ETK = c.ETK AND a.ARTIPUS = 13 AND a.ARNAPTOL <= GETDATE() ORDER BY a.ARNAPTOL DESC) AS listaar
         FROM CIKK c
         LEFT JOIN CIKKCCS ccs ON ccs.ETK = c.ETK
         LEFT JOIN CIKKCSOP cs ON cs.CIKKCSOP = ccs.CIKKCSKOD
         WHERE c.CIKKNEV1 LIKE @name OR c.ETK LIKE @etk ORDER BY c.CIKKNEV1`,
        { name: `%${q}%`, etk: `${q}%` },
        maxItemsOf(args, ctx)
      );
      return { count: r.rows.length, truncated: r.truncated, items: r.rows.map((x) => ({ ...x, ...src(x.ETK, "product") })) };
    },
  },
  {
    name: "ap2-invoices",
    description:
      "AP2 / AlphaVet invoices of a customer from the alphavet database (UGYFELKOD = TT vectorykod): invoice number, date, gross, net, payment method, due date; default last 12 months, newest first. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/ap2/customers/{vevokod}/invoices",
    pathParamDescriptions: { vevokod: "alphavet UGYFELKOD = TT vectorykod (number)" },
    resourceType: "vectory",
    paginated: true,
    extraInput: { months: z.number().int().min(1).max(120).optional().describe("Look-back window in months (default 12)"), maxItems: z.number().int().optional() },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const code = Number(args.vevokod);
      if (!Number.isFinite(code)) throw new Error("vevokod must be numeric for the alphavet database.");
      const r = await db.select(
        `SELECT u.UGYFTNEV AS ugyfelnev, sz.SZLASZAM AS szamlaszam, sz.SZKELTE AS keltezes, sz.SZBRUTTERT AS brutto, sz.SZNETTOERT AS netto,
                f.FIZMODNEV1 AS fizmod, sz.SZFIZHAT AS fizhatido, sz.SZIKTSZAM
         FROM alphavet.dbo.UGYFEL u WITH(NOLOCK)
         INNER JOIN alphavet.dbo.SZAMLA sz WITH(NOLOCK) ON sz.UGYFELKOD = u.UGYFELKOD
         LEFT JOIN alphavet.dbo.FIZMOD f WITH(NOLOCK) ON f.FIZMODKOD = sz.FIZMOD
         WHERE u.UGYFELKOD = @code AND sz.SZKELTE >= DATEADD(MONTH, -@months, GETDATE())
         ORDER BY sz.SZKELTE DESC`,
        { code, months: Math.min(Number(args.months) || 12, 120) },
        maxItemsOf(args, ctx)
      );
      return { count: r.rows.length, truncated: r.truncated, items: r.rows.map((x) => ({ ...x, ...src(x.szamlaszam, "ap2Invoice") })) };
    },
  },
  {
    name: "ap2-invoice-items",
    description:
      "Line items of one AP2 / AlphaVet invoice (alphavet database) by invoice number: product code, name, quantity, net value after discount, stock/batch code, EAN barcode, VAT %, unit, batch expiry. Falls back to the delivery-note number (KESZLETF.KBIZSZAM) when the number is not an invoice. Read-only.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/ap2/invoices/{invoice}/items",
    pathParamDescriptions: { invoice: "SZLASZAM invoice number (or KBIZSZAM delivery note number)" },
    resourceType: "vectory",
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const key = String(args.invoice);
      const cols = `SELECT t.TETELSSZ, t.etk AS cikkszam, t.TETELMENNY AS mennyiseg, t.TETELAR - t.TETELAR * t.TETENGEDM/100 AS nettoertek,
           t.GYARTAS AS keszletkod, c.CIKKNEV1 AS cikknev,
           (SELECT TOP 1 j.jellemzo FROM alphavet.dbo.JELLEMZOK j WITH(NOLOCK) WHERE j.JELMEGNEV1 = 'EAN kód' AND j.ETK = t.ETK) AS vonalkod,
           (SELECT TOP 1 a.ADOSZAZ FROM alphavet.dbo.ADOK a WITH(NOLOCK) WHERE a.ADOKOD = t.AFAKOD) AS afa,
           (SELECT TOP 1 m.menev1 FROM alphavet.dbo.MEGYSEG m WITH(NOLOCK) WHERE m.MEGYSEGKOD = t.megys2) AS mennyisegiegyseg,
           (SELECT TOP 1 g.ldatum FROM alphavet.dbo.gytorzs g WITH(NOLOCK) WHERE g.tgyartas = t.GYARTAS) AS lejarat
         FROM alphavet.dbo.tetel t WITH(NOLOCK)
         INNER JOIN alphavet.dbo.cikk c WITH(NOLOCK) ON c.ETK = t.ETK`;
      let r = await db.select(`${cols} INNER JOIN alphavet.dbo.SZAMLA sz WITH(NOLOCK) ON sz.SZIKTSZAM = t.SZIKTSZAM WHERE sz.SZLASZAM = @key ORDER BY t.TETELSSZ`, { key }, 1000);
      let source = "invoice";
      if (!r.rows.length) {
        r = await db.select(`${cols} INNER JOIN alphavet.dbo.KESZLETF k WITH(NOLOCK) ON k.KBIKTSZAM = t.KFIKTSZAM WHERE k.KBIZSZAM = @key ORDER BY t.TETELSSZ`, { key }, 1000);
        source = "deliveryNote";
      }
      return { invoice: key, matchedBy: source, count: r.rows.length, items: r.rows.map((x) => ({ ...x, ...src(key, "ap2InvoiceItem") })) };
    },
  },
  {
    name: "vectory-sql-query",
    description:
      "Run ONE read-only SELECT on the Vectory replica (database meditrade; alphavet tables as alphavet.dbo.X) for anything the curated tools do not cover. Rules enforced by the gateway: single statement, must start with SELECT/WITH, no comments, no DML/DDL/EXEC keywords; rows capped at maxItems. Customer key: meditrade UGYFEL.VEVOKOD = TT vectorykod (NOT UGYFELKOD - join SZAMLA/TETEL/keszletf through UGYFEL); alphavet UGYFEL.UGYFELKOD = TT vectorykod. Use @name parameters with the params object instead of inlining values. Prefer the curated vectory-*/ap2-* tools when they fit.",
    toolset: "vectory-sql",
    provider: "sql",
    scopes: SCOPES,
    method: "GET",
    path: "/vectory/query",
    resourceType: "vectory",
    extraInput: {
      query: z.string().min(8).describe("A single SELECT statement (T-SQL). Named parameters as @name."),
      params: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("Values for the @name parameters"),
      maxItems: z.number().int().optional().describe("Row cap (default and max from gateway limits)"),
    },
    handler: async (args, ctx) => {
      const db = requireSql(ctx);
      const r = await db.select(String(args.query), (args.params as Record<string, unknown>) ?? {}, maxItemsOf(args, ctx));
      return { count: r.rows.length, truncated: r.truncated, rows: r.rows, _source: { sourceType: "vectory", sourceId: "adhoc-query", objectType: "query" } };
    },
  },
];
