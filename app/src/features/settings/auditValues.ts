/**
 * An audit entry's stored value as a person reads it (Settings · Audit Log, docs/guides/foundation.md
 * §10): one line each, never JSON. An object (a role's grants, its masked fields) reads as
 * "employee bank: masked" per key; a list as its items; nothing at all as no line.
 */
export function valueLines(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "object" && !Array.isArray(v)) return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k.replace(/[._]/g, " ")}: ${flat(x)}`);
  return [flat(v)];
}

/** One value in words: a list as its items, anything deeper as its own words. */
function flat(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(flat).join(", ");
  if (typeof v === "object") return valueLines(v).join("; ");
  return String(v);
}
