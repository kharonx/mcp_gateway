/**
 * Toolset renames of stored settings / per-user access lists.
 *
 * Schema 2 (2026-10): TT is the product-support system (it only *reads* Vectory
 * data), Vectory is the ERP itself. So the TT proxy toolset "vectory" became
 * "tt" and the direct ERP replica toolset "vectory-sql" became "vectory".
 * Both names are mapped in ONE pass, so an old "vectory" never ends up as the ERP.
 */
export const TOOLSET_SCHEMA = 2;

const RENAMES_V2: Record<string, string> = { vectory: "tt", "vectory-sql": "vectory" };

export function migrateToolsetList<T extends string[] | null | undefined>(list: T): T {
  if (!Array.isArray(list)) return list;
  return [...new Set(list.map((t) => RENAMES_V2[t] ?? t))] as T;
}

/** Env lists cannot be rewritten; an old-style list is recognised by "vectory-sql". */
export function migrateEnvToolsetList(list: string[] | null): string[] | null {
  return list && list.includes("vectory-sql") ? migrateToolsetList(list) : list;
}
