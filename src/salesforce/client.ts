/**
 * Minimal Salesforce REST client bound to ONE user's connection (delegated,
 * never app-only). Every call runs with the connected Salesforce user's own
 * permissions; the gateway cannot exceed what that user sees in Salesforce.
 */

export class SalesforceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "SalesforceError";
  }

  toToolMessage(): string {
    switch (this.status) {
      case 401:
        return `Salesforce session invalid (401 ${this.code}): ${this.message}. The stored connection could not be refreshed - the user has to reconnect Salesforce on the gateway landing page.`;
      case 403:
        return `Salesforce permission denied (403 ${this.code}): ${this.message}. The connected Salesforce user has no access to this object/field, or the org API limit is exhausted.`;
      case 404:
        return `Salesforce resource not found (404 ${this.code}): ${this.message}.`;
      default:
        return `Salesforce error (${this.status} ${this.code}): ${this.message}`;
    }
  }
}

export interface SfConnection {
  /** Entra object id of the M365 user the connection belongs to. */
  oid: string;
  upn?: string;
  orgId: string;
  userId: string;
  instanceUrl: string;
  accessToken: string;
  refreshToken: string;
  connectedAt: string;
  lastRefreshAt?: string;
  /** Display data resolved after connecting (best effort). */
  username?: string;
  name?: string;
  email?: string;
}

export interface SfQueryResult {
  records: Record<string, any>[];
  totalSize: number;
  count: number;
  truncated: boolean;
  nextCursor?: string;
}

export interface SfRequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** Strips Salesforce `attributes` wrappers and attaches a _source block. */
export function sfRecord(rec: Record<string, any>, instanceUrl: string): Record<string, any> {
  const type = rec?.attributes?.type as string | undefined;
  const clean = stripAttributes(rec) as Record<string, any>;
  if (!type || !rec.Id) return clean;
  const src: Record<string, unknown> = {
    sourceType: "salesforceRecord",
    sourceId: rec.Id,
    objectType: type,
    sourceUrl: `${instanceUrl}/lightning/r/${encodeURIComponent(type)}/${encodeURIComponent(rec.Id)}/view`,
  };
  const title = rec.Name ?? rec.Subject ?? rec.CaseNumber ?? rec.Title;
  if (title) src.title = title;
  if (rec.CreatedDate) src.createdDateTime = rec.CreatedDate;
  if (rec.LastModifiedDate) src.lastModifiedDateTime = rec.LastModifiedDate;
  if (rec.Owner?.Name) src.owner = rec.Owner.Name;
  return { ...clean, _source: src };
}

function stripAttributes(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAttributes);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "attributes") continue;
      out[k] = stripAttributes(val);
    }
    return out;
  }
  return v;
}

/** Escape SOSL reserved characters inside a FIND {...} term. */
export function escapeSosl(term: string): string {
  return term.replace(/([?&|!{}[\]()^~*:\\"'+-])/g, "\\$1");
}

/** Escape a string literal for SOQL ('...'). */
export function soqlString(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

const SF_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
export function isSfId(s: string): boolean {
  return SF_ID_RE.test(s);
}

export class SalesforceClient {
  private describeCache = new Map<string, any>();

  constructor(
    private conn: SfConnection,
    private refresh: (conn: SfConnection) => Promise<SfConnection>,
    public readonly apiVersion: string
  ) {}

  get instanceUrl(): string {
    return this.conn.instanceUrl;
  }

  get connection(): Readonly<SfConnection> {
    return this.conn;
  }

  /** /services/data/vNN.N prefix. */
  data(path: string): string {
    return `/services/data/${this.apiVersion}${path.startsWith("/") ? path : "/" + path}`;
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : this.conn.instanceUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async request(method: "GET" | "POST" | "PATCH", path: string, opts: SfRequestOptions = {}): Promise<any> {
    const url = this.buildUrl(path, opts.query);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.conn.accessToken}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 401 && attempt === 0) {
        // Salesforce access tokens carry no expiry hint: refresh on INVALID_SESSION_ID and retry once.
        this.conn = await this.refresh(this.conn);
        continue;
      }
      if (res.status === 204) return { ok: true };
      const text = await res.text();
      let data: any = text;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const first = Array.isArray(data) ? data[0] : data;
        throw new SalesforceError(
          res.status,
          String(first?.errorCode ?? first?.error ?? "unknown"),
          String(first?.message ?? first?.error_description ?? res.statusText)
        );
      }
      return data;
    }
    throw new SalesforceError(401, "INVALID_SESSION_ID", "Salesforce session could not be refreshed");
  }

  /**
   * Run a SOQL query and follow nextRecordsUrl up to maxItems. A cursor is a
   * previously returned nextRecordsUrl (relative /services/data/... path).
   */
  async query(
    soql: string,
    opts: { maxItems: number; cursor?: string; includeDeleted?: boolean } = { maxItems: 200 }
  ): Promise<SfQueryResult> {
    const records: Record<string, any>[] = [];
    let totalSize = 0;
    let next: string | undefined;
    let url: string | undefined = opts.cursor;
    let first = true;
    while (first || (url && records.length < opts.maxItems)) {
      const data: any = first && !url
        ? await this.request("GET", this.data(opts.includeDeleted ? "/queryAll" : "/query"), { query: { q: soql } })
        : await this.request("GET", url!);
      first = false;
      records.push(...(data.records ?? []));
      totalSize = Number(data.totalSize ?? records.length);
      next = data.done === false && data.nextRecordsUrl ? String(data.nextRecordsUrl) : undefined;
      url = next;
    }
    return {
      records: records.map((r) => sfRecord(r, this.conn.instanceUrl)),
      totalSize,
      count: records.length,
      truncated: !!next,
      nextCursor: next,
    };
  }

  async describe(object: string): Promise<any> {
    const cached = this.describeCache.get(object);
    if (cached) return cached;
    const d = await this.request("GET", this.data(`/sobjects/${encodeURIComponent(object)}/describe`));
    this.describeCache.set(object, d);
    return d;
  }
}
