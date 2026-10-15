import { isoDaysAgo, sid } from "../core";

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

type Row = [key: string, first: string, last: string, title: string, dept: string, grade: string, mgr: string | null,
  start: string, dob: string, pattern: MockPerson["work_pattern"], status: MockPerson["status"], gross: string];

const ROWS: Row[] = [
  ["ifeoma", "Ifeoma", "Chukwu", "Chief Executive Officer", "Executive", "G6 · Executive", null, "2019-03-04", "1984-05-21", "hybrid", "confirmed", "1800000.00"],
  ["cynthia", "Cynthia", "Osakunih", "Operations and People Lead", "Operations & People", "G5 · Head", "ifeoma", "2024-02-12", "1990-10-16", "hybrid", "confirmed", "550000.00"],
  ["tolu", "Tolu", "Adeyemi", "Content Lead", "Content", "G4 · Lead", "ifeoma", "2024-05-02", "1993-07-09", "hybrid", "confirmed", "520000.00"],
  ["bashir", "Bashir", "Lawal", "Partnerships Manager", "Marketing & Sales", "G3 · Senior", "cynthia", "2025-01-14", "1991-11-30", "hybrid", "confirmed", "450000.00"],
  ["amara", "Amara", "Okafor", "Finance Officer", "Finance", "G3 · Senior", "ngozi", "2025-03-03", "1995-02-14", "remote", "confirmed", "430000.00"],
  ["seyi", "Seyi", "Balogun", "Backend Engineer", "Engineering", "G4 · Lead", "ifeoma", "2024-08-19", "1992-09-03", "remote", "confirmed", "610000.00"],
  ["hauwa", "Hauwa", "Yusuf", "Support Officer", "Support", "G2 · Officer", "cynthia", "2024-11-11", "1997-12-01", "hybrid", "confirmed", "280000.00"],
  ["emeka", "Emeka", "Obi", "Studio Producer", "Studio", "G3 · Senior", "ngozi", "2025-06-05", "1994-04-18", "on_site", "confirmed", "390000.00"],
  ["ngozi", "Ngozi", "Eze", "Head of Marketing and Sales", "Marketing & Sales", "G5 · Head", "ifeoma", "2024-02-22", "1988-08-27", "hybrid", "confirmed", "720000.00"],
  ["chidera", "Chidera", "Nwosu", "Content Producer", "Content", "G2 · Officer", "cynthia", "2026-07-24", "1999-01-25", "hybrid", "probation", "260000.00"],
  ["adedotun", "Adedotun", "Oyinloye", "Brand and Design Lead", "Marketing & Sales", "G4 · Lead", "ngozi", "2024-09-09", "1993-03-12", "hybrid", "confirmed", "480000.00"],
  ["kemi", "Kemi", "Adebayo", "Content Writer", "Content", "G2 · Officer", "tolu", "2025-04-07", "1998-06-02", "remote", "confirmed", "240000.00"],
  ["obinna", "Obinna", "Ike", "Frontend Engineer", "Engineering", "G3 · Senior", "seyi", "2025-02-17", "1996-10-21", "remote", "confirmed", "520000.00"],
  ["funke", "Funke", "Bello", "Accounts Officer", "Finance", "G2 · Officer", "amara", "2025-08-04", "1997-05-15", "on_site", "confirmed", "250000.00"],
  ["yusuf", "Yusuf", "Musa", "Videographer", "Studio", "G2 · Officer", "emeka", "2025-09-01", "1998-11-08", "on_site", "confirmed", "230000.00"],
  ["tobi", "Tobi", "Ojo", "Sales Executive", "Marketing & Sales", "G2 · Officer", "ngozi", "2025-05-12", "1996-02-28", "hybrid", "on_leave", "260000.00"],
  ["zainab", "Zainab", "Abubakar", "Support Officer", "Support", "G2 · Officer", "hauwa", "2025-10-06", "1999-09-19", "on_site", "confirmed", "220000.00"],
  ["damilola", "Damilola", "Eke", "People Officer", "Operations & People", "G2 · Officer", "cynthia", "2025-03-24", "1995-12-11", "on_site", "confirmed", "270000.00"],
  ["ibrahim", "Ibrahim", "Umar", "Mobile Engineer", "Engineering", "G3 · Senior", "seyi", "2025-07-14", "1994-07-30", "remote", "confirmed", "500000.00"],
  ["precious", "Precious", "Nnaji", "Social Media Officer", "Content", "G2 · Officer", "tolu", "2026-01-12", "2000-03-06", "hybrid", "confirmed", "220000.00"],
  ["rotimi", "Rotimi", "Alade", "Photographer", "Studio", "G2 · Officer", "emeka", "2025-11-03", "1997-08-24", "on_site", "confirmed", "230000.00"],
  ["grace", "Grace", "Okon", "Partnerships Officer", "Marketing & Sales", "G2 · Officer", "bashir", "2026-02-02", "1998-04-10", "hybrid", "confirmed", "250000.00"],
  ["samuel", "Samuel", "Akpan", "Support Officer", "Support", "G2 · Officer", "hauwa", "2026-04-13", "1999-10-14", "on_site", "probation", "210000.00"],
  ["blessing", "Blessing", "Udo", "Payroll Officer", "Finance", "G2 · Officer", "amara", "2025-06-23", "1996-01-17", "on_site", "confirmed", "260000.00"],
  ["musa", "Musa", "Olawale", "Facilities Officer", "Operations & People", "G1 · Associate", "cynthia", "2024-12-02", "1992-06-05", "on_site", "suspended", "180000.00"],
];

const BANKS = ["GTBank", "Zenith Bank", "Access Bank", "Providus Bank", "UBA", "First Bank"];
const SITES = ["MTN Head Office, Ikoyi", "MyCity Studio, Yaba", "Remote", "MyCity Office, Lekki"];

export const PEOPLE: MockPerson[] = ROWS.map((r, i) => {
  const [key, first, last, title, dept, grade, mgr, start, dob, pattern, status, gross] = r;
  return {
    employee_id: sid(`employee:${key}`),
    user_key: key,
    staff_number: `MCA-${String(i + 1).padStart(4, "0")}`,
    first_name: first,
    last_name: last,
    display_name: `${first} ${last}`,
    job_title: title,
    department: dept,
    grade,
    manager: mgr,
    work_email: `${key}@mycityapp.io`,
    phone: `+234 80${(i * 7) % 10} ${String(100 + ((i * 37) % 900)).padStart(3, "0")} ${String(1000 + ((i * 731) % 9000))}`,
    start_date: start,
    date_of_birth: dob,
    employment_type: i % 6 === 4 ? "contractor" : i % 9 === 5 ? "consultant" : "full_time",
    work_pattern: pattern,
    status,
    worksite: pattern === "remote" ? "Remote" : SITES[i % 2 === 0 ? 0 : i % 3 === 0 ? 3 : 1],
    gross_monthly: gross,
    bank_name: BANKS[i % BANKS.length],
    account_last4: String(1000 + ((i * 2741) % 9000)),
    next_of_kin: `${["Folake", "Amina", "Chuka", "Bisi", "Musa", "Ada"][i % 6]} ${last}`,
  };
});

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

export const MODULES_ALL = ["home", "workspace", "ess", "community", "mailbox", "people", "performance", "queries", "recruitment", "payroll", "partnerships", "expenses", "knowledge", "praxis_ai", "settings"];

export function grantsFor(key: string): Record<string, string[]> {
  const all = ["view", "create", "edit", "delete", "approve", "export"];
  const staff = ["home", "workspace", "ess", "community", "mailbox", "performance", "expenses", "knowledge", "praxis_ai"];
  const pick = (mods: string[], acts = all) => Object.fromEntries(mods.map((m) => [m, acts]));
  if (key === "cynthia" || key === "ifeoma") return pick(MODULES_ALL);
  if (key === "ngozi") return { ...pick(staff), ...pick(["partnerships"]), people: ["view"], queries: ["view", "create"] };
  return { ...pick(staff, ["view", "create", "edit"]) };
}

export const isoAgo = isoDaysAgo;
