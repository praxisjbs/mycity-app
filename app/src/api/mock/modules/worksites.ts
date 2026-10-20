import type { Worksite, WorksiteEmployee } from "@mycity/contract/contract.gen.ts";
import { at, created, fail, fold, invalid, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, grantsFor, PEOPLE, SIGN_INS, teamOf, type MockPerson } from "../data/people";
import { pickedPlace, pickAnAddress, placeOf } from "./maps";

/**
 * People · Worksites on the mock, in the contract's shapes (packages/contract/schemas/worksites.js):
 * the offices a punch is matched to, each a centre, a radius and a timezone, and who is assigned
 * to each. The coordinates are invented points for the demonstration offices.
 */
type Site = Worksite;

const SEED: Array<[string, string, string, number, number, number]> = [
  ["IKOYI", "MTN Head Office, Ikoyi", "4 Aromire Road, Ikoyi, Lagos", 6.452, 3.435, 120],
  ["YABA", "MyCity Studio, Yaba", "21 Herbert Macaulay Way, Yaba, Lagos", 6.5095, 3.379, 100],
  ["LEKKI", "MyCity Office, Lekki", "7 Admiralty Way, Lekki Phase 1, Lagos", 6.447, 3.472, 120],
];

export const WORKSITES: Site[] = SEED.map(([code, name, address, latitude, longitude, radius_m], i) => ({
  worksite_id: sid(`worksite:${code}`),
  code,
  name,
  address,
  address_place: pickedPlace(address).view,
  latitude,
  longitude,
  radius_m,
  timezone: "Africa/Lagos",
  active: true,
  assigned_count: 0,
  created_at: at(300 - i * 20, "09:00"),
  updated_at: at(300 - i * 20, "09:00"),
}));

/** Who works where: the roster's office, until People assign someone elsewhere. */
const ASSIGNED = new Map<string, string | null>(
  PEOPLE.map((p) => [p.user_key, p.work_pattern === "remote" ? null : (WORKSITES.find((w) => w.name === p.worksite)?.worksite_id ?? null)]),
);

/** The worksite a person's punch is matched to, when it is in use. */
export function siteOf(key: string): Site | null {
  const id = ASSIGNED.get(key);
  const site = WORKSITES.find((w) => w.worksite_id === id);
  return site && site.active ? site : null;
}

const count = (id: string) => [...ASSIGNED.values()].filter((v) => v === id).length;
const withCount = (w: Site): Site => ({ ...w, assigned_count: count(w.worksite_id) });

/** The reader's `people` grant: whether they hold the action, and whether their scope is everyone. */
export function peopleGrant(user: string, action: string) {
  const may = !!grantsFor(user).people?.includes(action);
  const all = ["operations", "ceo"].includes(SIGN_INS[user]?.view ?? "");
  const team = new Set(teamOf(user).map((p) => p.user_key));
  return { may, all, sees: (key: string) => all || key === user || team.has(key) };
}

const forbidden = () => fail(403, "FORBIDDEN", "You do not have access to this.");

const employeeRow = (p: MockPerson): WorksiteEmployee => ({
  employee_id: p.employee_id,
  display_name: p.display_name,
  job_title: p.job_title,
  department: p.department,
  work_pattern: p.work_pattern,
  worksite_id: ASSIGNED.get(p.user_key) ?? null,
  photo_url: null,
});

function check(b: Record<string, unknown>, partial: boolean) {
  const fields: Record<string, string[]> = {};
  const has = (k: string) => b[k] !== undefined;
  if ((!partial || has("name")) && !String(b.name ?? "").trim()) fields.name = ["Name the worksite"];
  if ((!partial || has("latitude")) && !(typeof b.latitude === "number" && b.latitude >= -90 && b.latitude <= 90)) fields.latitude = ["Not a latitude"];
  if ((!partial || has("longitude")) && !(typeof b.longitude === "number" && b.longitude >= -180 && b.longitude <= 180)) fields.longitude = ["Not a longitude"];
  if ((!partial || has("radius_m")) && !(Number.isInteger(b.radius_m) && (b.radius_m as number) >= 25 && (b.radius_m as number) <= 1000)) fields.radius_m = ["Between 25 and 1000"];
  return fields;
}

const codeOf = (name: string) => {
  const base = fold(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 24) || "SITE";
  let code = base;
  for (let n = 2; WORKSITES.some((w) => w.code === code); n += 1) code = `${base}-${n}`;
  return code;
};

route("GET /api/v1/worksites", (req) => {
  if (!peopleGrant(req.user!, "view").may) return forbidden();
  return paged(WORKSITES.map(withCount), req, {
    search: (w) => [w.name, w.code, w.address],
    filters: { active: (w, v) => String(w.active) === v },
    sort: { name: (a, b) => a.name.localeCompare(b.name), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
  });
});

route("GET /api/v1/worksites/:id", (req) => {
  if (!peopleGrant(req.user!, "view").may) return forbidden();
  const w = WORKSITES.find((x) => x.worksite_id === req.params.id);
  return w ? ok(withCount(w)) : notFound();
});

route("POST /api/v1/worksites", (req) => {
  if (!peopleGrant(req.user!, "create").may) return forbidden();
  const fields = check(req.body, false);
  if (Object.keys(fields).length) return invalid(fields);
  const b = req.body as { name: string; address?: unknown; latitude: number; longitude: number; radius_m: number; timezone?: string };
  const kept = b.address === undefined ? null : placeOf(b.address);
  if (b.address !== undefined && !kept) return pickAnAddress("address");
  const now = new Date().toISOString();
  const w: Site = {
    worksite_id: sid(`worksite:${b.name}:${now}`),
    code: codeOf(b.name),
    name: b.name.trim(),
    address: kept?.line ?? null,
    address_place: kept?.view ?? null,
    latitude: b.latitude,
    longitude: b.longitude,
    radius_m: b.radius_m,
    timezone: b.timezone || "Africa/Lagos",
    active: true,
    assigned_count: 0,
    created_at: now,
    updated_at: now,
  };
  WORKSITES.push(w);
  return created(w);
});

route("PATCH /api/v1/worksites/:id", (req) => {
  if (!peopleGrant(req.user!, "edit").may) return forbidden();
  const w = WORKSITES.find((x) => x.worksite_id === req.params.id);
  if (!w) return notFound();
  const fields = check(req.body, true);
  if (Object.keys(fields).length) return invalid(fields);
  const b = req.body as Omit<Partial<Site>, "address"> & { address?: unknown };
  const kept = b.address ? placeOf(b.address) : null;
  if (b.address && !kept) return pickAnAddress("address");
  Object.assign(w, {
    ...(b.name !== undefined && { name: String(b.name).trim() }),
    ...(b.address !== undefined && { address: kept?.line ?? null, address_place: kept?.view ?? null }),
    ...(b.latitude !== undefined && { latitude: b.latitude }),
    ...(b.longitude !== undefined && { longitude: b.longitude }),
    ...(b.radius_m !== undefined && { radius_m: b.radius_m }),
    ...(b.timezone !== undefined && { timezone: b.timezone }),
    ...(b.active !== undefined && { active: b.active }),
    updated_at: new Date().toISOString(),
  });
  return ok(withCount(w));
});

route("GET /api/v1/worksites/:id/employees", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  if (!WORKSITES.some((x) => x.worksite_id === req.params.id)) return notFound();
  const rows = PEOPLE.filter((p) => ASSIGNED.get(p.user_key) === req.params.id && g.sees(p.user_key)).map(employeeRow);
  return paged(rows.sort((a, b) => a.display_name.localeCompare(b.display_name)), req, { search: (e) => [e.display_name, e.job_title, e.department] });
});

route("POST /api/v1/worksites/:id/employees", (req) => {
  const g = peopleGrant(req.user!, "edit");
  if (!g.may) return forbidden();
  const w = WORKSITES.find((x) => x.worksite_id === req.params.id);
  if (!w) return notFound();
  if (!w.active) return fail(409, "WORKSITE_RETIRED", "Restore the worksite before assigning anyone");
  const p = byId(String(req.body.employee_id ?? ""));
  if (!p || !g.sees(p.user_key)) return notFound();
  ASSIGNED.set(p.user_key, w.worksite_id);
  return ok(employeeRow(byKey(p.user_key)!));
});
