export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "GraphError";
  }

  /** Human/AI friendly explanation for common Graph failure modes. */
  toToolMessage(): string {
    switch (this.status) {
      case 401:
        return `Authentication failed or token expired (401 ${this.code}): ${this.message}. Re-authenticate and retry.`;
      case 403:
        return `Permission denied (403 ${this.code}): ${this.message}. The signed-in user does not have access to this resource in Microsoft 365, or the required Graph scope was not consented.`;
      case 404:
        return `Resource not found (404 ${this.code}): ${this.message}. It may have been deleted, moved, or the id is wrong.`;
      case 429:
        return `Microsoft Graph throttling persisted after retries (429): ${this.message}. Wait and try again.`;
      default:
        return `Microsoft Graph error (${this.status} ${this.code}): ${this.message}`;
    }
  }
}

export interface GraphRequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
  /** Return raw binary content instead of JSON. */
  binary?: boolean;
  maxBytes?: number;
}

export interface BinaryResult {
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
  truncated: boolean;
}

export interface PagedResult {
  items: unknown[];
  count: number;
  truncated: boolean;
  nextLink?: string;
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphClient {
  constructor(private getToken: () => Promise<string>) {}

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : GRAPH_BASE + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
    return url.toString();
  }

  private async rawFetch(method: string, url: string, opts: GraphRequestOptions): Promise<Response> {
    const token = await this.getToken();
    let lastError: GraphError | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: opts.accept ?? "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        const retryAfter = Number(res.headers.get("Retry-After")) || Math.min(2 ** attempt * 2, 30);
        lastError = new GraphError(res.status, "throttled", `HTTP ${res.status} from Graph`, retryAfter);
        if (attempt < MAX_RETRIES) {
          await sleep(retryAfter * 1000);
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        let code = "unknown";
        let message = res.statusText;
        try {
          const err = (await res.json()) as { error?: { code?: string; message?: string } };
          code = err.error?.code ?? code;
          message = err.error?.message ?? message;
        } catch {
          /* non-JSON error body */
        }
        throw new GraphError(res.status, code, message);
      }
      return res;
    }
    throw lastError ?? new GraphError(500, "unknown", "Unexpected Graph client state");
  }

  async request(method: "GET" | "POST", path: string, opts: GraphRequestOptions = {}): Promise<unknown> {
    const res = await this.rawFetch(method, this.buildUrl(path, opts.query), opts);
    if (res.status === 202 || res.status === 204) {
      return { status: res.status, ok: true };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return res.json();
    return res.text();
  }

  async requestBinary(path: string, opts: GraphRequestOptions = {}): Promise<BinaryResult> {
    const res = await this.rawFetch("GET", this.buildUrl(path, opts.query), { ...opts, accept: "*/*" });
    const maxBytes = opts.maxBytes ?? Infinity;
    const ab = await res.arrayBuffer();
    let buffer = Buffer.from(ab);
    let truncated = false;
    if (buffer.length > maxBytes) {
      buffer = buffer.subarray(0, maxBytes);
      truncated = true;
    }
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      sizeBytes: ab.byteLength,
      buffer,
      truncated,
    };
  }

  /** GET with @odata.nextLink pagination up to maxItems. */
  async getPaged(
    path: string,
    query: Record<string, string | undefined>,
    maxItems: number,
    headers?: Record<string, string>
  ): Promise<PagedResult> {
    const items: unknown[] = [];
    let url: string | undefined = this.buildUrl(path, query);
    let nextLink: string | undefined;
    while (url && items.length < maxItems) {
      const res = await this.rawFetch("GET", url, { headers });
      const data = (await res.json()) as { value?: unknown[]; "@odata.nextLink"?: string };
      items.push(...(data.value ?? []));
      nextLink = data["@odata.nextLink"];
      url = nextLink;
    }
    const truncated = items.length > maxItems || !!nextLink;
    return {
      items: items.slice(0, maxItems),
      count: Math.min(items.length, maxItems),
      truncated,
      nextLink: truncated ? nextLink : undefined,
    };
  }
}
