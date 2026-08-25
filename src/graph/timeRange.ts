export type NamedRange =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "this_month"
  | "last_month";

export const NAMED_RANGES: NamedRange[] = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_week",
  "this_month",
  "last_month",
];

export interface ResolvedRange {
  from: string; // ISO 8601 UTC
  to: string; // ISO 8601 UTC
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Resolve a named range or explicit from/to pair into ISO UTC boundaries.
 * Explicit from/to (ISO date or datetime) win over timeRange.
 */
export function resolveTimeRange(args: {
  timeRange?: string;
  from?: string;
  to?: string;
}): ResolvedRange | null {
  const now = new Date();
  if (args.from || args.to) {
    const from = args.from ? new Date(args.from) : new Date(0);
    const to = args.to ? new Date(args.to) : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error(`Invalid from/to date. Use ISO format, e.g. 2026-07-01 or 2026-07-01T00:00:00Z.`);
    }
    // A bare date in "to" means "end of that day".
    const toAdj = args.to && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? new Date(to.getTime() + 86399999) : to;
    return { from: from.toISOString(), to: toAdj.toISOString() };
  }
  if (!args.timeRange) return null;

  const today0 = startOfDay(now);
  const day = 86400000;
  switch (args.timeRange as NamedRange) {
    case "today":
      return { from: today0.toISOString(), to: now.toISOString() };
    case "yesterday":
      return { from: new Date(today0.getTime() - day).toISOString(), to: today0.toISOString() };
    case "last_7_days":
      return { from: new Date(today0.getTime() - 7 * day).toISOString(), to: now.toISOString() };
    case "last_30_days":
      return { from: new Date(today0.getTime() - 30 * day).toISOString(), to: now.toISOString() };
    case "this_week": {
      const dow = (today0.getUTCDay() + 6) % 7; // Monday = 0
      return { from: new Date(today0.getTime() - dow * day).toISOString(), to: now.toISOString() };
    }
    case "this_month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: first.toISOString(), to: now.toISOString() };
    }
    case "last_month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: first.toISOString(), to: end.toISOString() };
    }
    default:
      throw new Error(
        `Unknown timeRange "${args.timeRange}". Use one of: ${NAMED_RANGES.join(", ")} or explicit from/to.`
      );
  }
}
