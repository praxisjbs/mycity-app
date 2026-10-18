import type { AccessCatalogue, RoleDetail, RoleGrant, RoleSave } from "@mycity/contract/contract.gen.ts";

/*
 * A module's access as Roles & Permissions shows it: one level with Approve and
 * Export beside it (docs/guides/foundation.md §6.10). The API keeps the six
 * actions; these map them to a level and back when a role is saved, so nothing
 * about levels is stored. Actions that fit no level read Custom and are kept.
 */
export type Action = RoleGrant["actions"][number];
export type Scope = RoleGrant["scope"];
export type HomeView = NonNullable<RoleSave["home_view"]>;
export type Module = AccessCatalogue["modules"][number];
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVELS = ["No Access", "View", "Add", "Edit", "Full"] as const;
export const CORE: Action[][] = [[], ["view"], ["view", "create"], ["view", "create", "edit"], ["view", "create", "edit", "delete"]];
export const ADD_ONS: Action[] = ["approve", "export"];
export const ACTION_WORD: Record<Action, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", export: "Export" };
export const SCOPE_WORD: Record<Scope, string> = { all: "All", team: "Team", own: "Own" };
export const SCOPES: Array<[Scope, string]> = [["all", "All"], ["team", "Team"], ["own", "Own"]];
export const HOMES: Array<[HomeView, string]> = [["staff", "Staff"], ["operations", "Operations"], ["partnerships", "Partnerships"]];
export const AREAS: Array<[string, string]> = [["top", "Everyone"], ["work", "Work"], ["people", "People"], ["business", "Business"], ["system", "System"]];
export const STEPS = ["Name", "Access", "Details", "Review"];
export const SCOPE_HELP = "All: every record. Team: the person's own and those of everyone who reports to them. Own: only their own.";
export const KEY = "T Team · O Own · A Approve · X Export";

export const has = (g: RoleGrant, a: Action) => g.actions.includes(a);
export const coreOf = (g: RoleGrant) => g.actions.filter((a) => !ADD_ONS.includes(a));

/** The level a grant's actions stand for, or null when they fit none (Custom). */
export function levelOf(g: RoleGrant): Level | null {
  if (!g.actions.length) return 0;
  const core = coreOf(g);
  const i = CORE.findIndex((c) => c.length === core.length && c.every((a) => core.includes(a)));
  return i < 0 ? null : (i as Level);
}

/** How much a grant opens, for ordering changes and drawing the meter: its level, or a Custom grant's own actions counted. */
export const rankOf = (g: RoleGrant) => levelOf(g) ?? Math.min(4, coreOf(g).length);

export const levelWord = (g: RoleGrant) => {
  const lv = levelOf(g);
  return lv == null ? "Custom" : LEVELS[lv];
};

/** A grant moved to a level: the level's actions, keeping Approve and Export unless it is No Access. */
export function atLevel(g: RoleGrant, lv: Level, mod: Module, fallback: Scope): RoleGrant {
  if (!lv) return { ...g, actions: [] };
  const was = g.actions.length > 0;
  const scope: Scope = mod.own_only ? "own" : was ? g.scope : fallback;
  return { ...g, scope, actions: [...CORE[lv], ...(was ? g.actions.filter((a) => ADD_ONS.includes(a)) : [])] };
}

export const toggled = (g: RoleGrant, a: Action): RoleGrant => (!g.actions.length ? g : { ...g, actions: has(g, a) ? g.actions.filter((x) => x !== a) : [...g.actions, a] });

export const scopeOf = (g: RoleGrant, mod: Module): Scope => (mod.own_only ? "own" : g.scope);

/** "Edit · Team · Approve" as the review lists a grant. */
export function grantWords(g: RoleGrant, mod: Module): string {
  if (!g.actions.length) return "No Access";
  const lv = levelOf(g);
  const parts = [lv == null ? coreOf(g).map((a) => ACTION_WORD[a]).join(", ") : LEVELS[lv], SCOPE_WORD[scopeOf(g, mod)]];
  for (const a of ADD_ONS) if (has(g, a)) parts.push(ACTION_WORD[a]);
  return parts.join(" · ");
}

/** The letters a module carries where space is short, and what they mean. */
export function lettersOf(g: RoleGrant, mod: Module): { text: string; help: string } | null {
  if (!g.actions.length) return null;
  const out: Array<[string, string]> = [];
  const sc = scopeOf(g, mod);
  if (sc === "team") out.push(["T", "T: their team's records as well as their own."]);
  if (sc === "own") out.push(["O", "O: only their own records."]);
  if (has(g, "approve")) out.push(["A", "A: approves requests here."]);
  if (has(g, "export")) out.push(["X", "X: exports the whole list."]);
  return out.length ? { text: out.map((o) => o[0]).join(" "), help: out.map((o) => o[1]).join(" ") } : null;
}

/* ───────────── A role being read or edited ───────────── */

export interface Draft {
  role_id: string | null;
  code: string | null;
  name: string;
  description: string;
  home: HomeView;
  /** Every catalogue module, with no actions when it is not granted. */
  grants: Record<string, RoleGrant>;
  fields: string[];
  caps: string[];
  is_system: boolean;
  users: number;
}

export function draftOf(cat: AccessCatalogue, role: RoleDetail | null): Draft {
  return {
    role_id: role?.role_id ?? null,
    code: role?.code ?? null,
    name: role?.name ?? "",
    description: role?.description ?? "",
    home: HOMES.find(([v]) => v === role?.home_view)?.[0] ?? "staff",
    grants: Object.fromEntries(cat.modules.map((m) => [m.key, role?.grants.find((g) => g.module_key === m.key) ?? { module_key: m.key, actions: [], scope: "own" }])),
    fields: role ? [...role.visible_fields] : [],
    caps: role ? [...role.capabilities] : [],
    is_system: role?.is_system ?? false,
    users: role?.users ?? 0,
  };
}

export const bodyOf = (d: Draft): RoleSave => ({
  name: d.name.trim(),
  description: d.description.trim() || null,
  home_view: d.home,
  grants: Object.values(d.grants).filter((g) => g.actions.length),
  visible_fields: d.fields as RoleSave["visible_fields"],
  capabilities: d.caps,
});

/** The record scope most of a role's grants use, the wider on a tie: what a newly granted module starts with. */
export function usualScope(cat: AccessCatalogue, d: Draft): Scope {
  const n = { all: 0, team: 0, own: 0 };
  for (const m of cat.modules) if (!m.own_only && d.grants[m.key].actions.length) n[d.grants[m.key].scope] += 1;
  if (!n.all && !n.team && !n.own) return "own";
  return n.all >= n.team && n.all >= n.own ? "all" : n.team >= n.own ? "team" : "own";
}

export interface Change {
  kind: "Gains" | "Loses" | "Changes";
  what: string;
  from: string;
  to: string;
}
export const KIND_TONE = { Gains: "ok", Loses: "err", Changes: "info" } as const;

/** What saving `after` over `before` changes: per module, field and capability, then the role's own details. */
export function changesOf(cat: AccessCatalogue, before: Draft, after: Draft): Change[] {
  const out: Change[] = [];
  for (const m of cat.modules) {
    const a = before.grants[m.key];
    const b = after.grants[m.key];
    const same = a.actions.length === b.actions.length && a.actions.every((x) => b.actions.includes(x)) && (!a.actions.length || scopeOf(a, m) === scopeOf(b, m));
    if (same) continue;
    const kind = rankOf(b) > rankOf(a) ? "Gains" : rankOf(b) < rankOf(a) ? "Loses" : "Changes";
    out.push({ kind, what: m.label, from: grantWords(a, m), to: grantWords(b, m) });
  }
  for (const f of cat.fields) {
    const was = before.fields.includes(f.key);
    const now = after.fields.includes(f.key);
    if (was !== now) out.push({ kind: now ? "Gains" : "Loses", what: f.label, from: was ? "Visible" : "Masked", to: now ? "Visible" : "Masked" });
  }
  for (const c of cat.capabilities) {
    const was = before.caps.includes(c.code);
    const now = after.caps.includes(c.code);
    if (was !== now) out.push({ kind: now ? "Gains" : "Loses", what: c.name, from: was ? "Held" : "Not Held", to: now ? "Held" : "Not Held" });
  }
  const home = (v: HomeView) => HOMES.find(([k]) => k === v)?.[1] ?? v;
  if (before.home !== after.home) out.push({ kind: "Changes", what: "Home", from: home(before.home), to: home(after.home) });
  if (before.role_id && before.name.trim() !== after.name.trim()) out.push({ kind: "Changes", what: "Role Name", from: before.name, to: after.name.trim() });
  if (before.description.trim() !== after.description.trim()) out.push({ kind: "Changes", what: "What It Is For", from: before.description.trim() || "Not Set", to: after.description.trim() || "Not Set" });
  return out;
}

export const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

/** The role in plain words, at most 35 (a help text): what it changes, approves and reads, and whether salary is masked. */
export function summaryOf(cat: AccessCatalogue, d: Draft): string {
  const granted = cat.modules.filter((m) => d.grants[m.key].actions.length);
  if (!granted.length) return "Opens nothing yet.";
  const where = { all: "across the company", team: "for their team", own: "for their own records" }[usualScope(cat, d)];
  const names = (keep: (g: RoleGrant) => boolean) => granted.filter((m) => keep(d.grants[m.key])).map((m) => m.label);
  const list = (a: string[]) => (a.length > 3 ? `${a.slice(0, 2).join(", ")} and ${a.length - 2} more` : a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
  const changes = names((g) => rankOf(g) >= 3);
  const approves = names((g) => has(g, "approve"));
  const reads = names((g) => rankOf(g) > 0 && rankOf(g) < 3);
  const parts: string[] = [];
  if (changes.length) parts.push(`Changes ${list(changes)} ${where}.`);
  if (approves.length) parts.push(`Approves in ${list(approves)}.`);
  if (reads.length) parts.push(`Reads ${list(reads)}.`);
  parts.push(d.fields.includes("employee.salary") ? "Sees salary." : "Salary stays masked.");
  while (words(parts.join(" ")) > 35 && parts.length > 2) parts.splice(parts.length - 2, 1);
  return parts.join(" ");
}
