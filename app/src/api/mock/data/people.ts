import { isoDaysAgo, sid } from "../core";
import roster from "./roster.json";

/**
 * The demonstration roster: 25 staff, one reporting tree. Every module's mock
 * reads people from here so a name means the same person on every screen.
 * Demonstration data only (A5); production starts empty.
 */
export interface MockPerson {
  employee_id: string;
  user_key: string;
  staff_number: string;
  first_name: string;
  last_name: string;
  display_name: string;
  job_title: string;
  department: string;
  grade: string;
  manager: string | null; // user_key
  work_email: string;
  phone: string;
  start_date: string;
  date_of_birth: string;
  employment_type: "full_time" | "part_time" | "contractor" | "consultant" | "intern";
  work_pattern: "on_site" | "hybrid" | "remote";
  status: "confirmed" | "probation" | "suspended" | "on_leave";
  worksite: string;
  gross_monthly: string;
  bank_name: string;
  account_last4: string;
  next_of_kin: string;
}

/**
 * The roster itself is plain data in roster.json, shared with the local seed
 * (seeds/build/20_mock_data.js) so `npm run db:seed -- --build` gives a laptop's real
 * API the same people this mock shows.
 */
type RosterPerson = Omit<MockPerson, "employee_id" | "user_key" | "display_name"> & { key: string };

export const PEOPLE: MockPerson[] = (roster.people as RosterPerson[]).map(({ key, ...p }) => ({
  ...p,
  employee_id: sid(`employee:${key}`),
  user_key: key,
  display_name: `${p.first_name} ${p.last_name}`,
}));

export const byKey = (key: string | null | undefined) => PEOPLE.find((p) => p.user_key === key);
export const byId = (id: string | null | undefined) => PEOPLE.find((p) => p.employee_id === id);
export const managerOf = (p: MockPerson) => byKey(p.manager);
export const reportsOf = (key: string) => PEOPLE.filter((p) => p.manager === key);
/** Everyone below a person in the tree. */
export function teamOf(key: string): MockPerson[] {
  const out: MockPerson[] = [];
  const walk = (k: string) => reportsOf(k).forEach((p) => (out.push(p), walk(p.user_key)));
  walk(key);
  return out;
}

/** PersonRef as lists carry it. */
export function ref(p: MockPerson | undefined) {
  if (!p) return null;
  return { employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department, photo_url: null };
}
export const refKey = (key: string) => ref(byKey(key))!;

export const DEPARTMENTS = ["Executive", "Operations & People", "Marketing & Sales", "Content", "Finance", "Engineering", "Support", "Studio"];

/** Who signs in to the mock, and which Home view each sees. */
export const SIGN_INS: Record<string, { view: "operations" | "ceo" | "partnerships" | "staff"; role: string }> = {
  cynthia: { view: "operations", role: "Operations" },
  ifeoma: { view: "ceo", role: "CEO" },
  ngozi: { view: "partnerships", role: "Partnerships" },
  chidera: { view: "staff", role: "Staff" },
};

/**
 * Every module key, for the two accounts that open everything on the mock (the screen
 * gates sign in as one of them). `system_health` holds Settings' Status, Performance and
 * Faults tabs and `integrations` its Integrations tab (app/src/shell/access.ts), so without
 * them the crawl never reaches those.
 */
export const MODULES_ALL = ["home", "workspace", "ess", "community", "mailbox", "people", "performance", "queries", "recruitment", "payroll", "partnerships", "expenses", "knowledge", "praxis_ai", "settings", "system_health", "integrations"];

export function grantsFor(key: string): Record<string, string[]> {
  const all = ["view", "create", "edit", "delete", "approve", "export"];
  const staff = ["home", "workspace", "ess", "community", "mailbox", "performance", "expenses", "knowledge", "praxis_ai"];
  const pick = (mods: string[], acts = all) => Object.fromEntries(mods.map((m) => [m, acts]));
  if (key === "cynthia" || key === "ifeoma") return pick(MODULES_ALL);
  if (key === "ngozi") return { ...pick(staff), ...pick(["partnerships"]), people: ["view"], queries: ["view", "create"] };
  return { ...pick(staff, ["view", "create", "edit"]) };
}

export const isoAgo = isoDaysAgo;
