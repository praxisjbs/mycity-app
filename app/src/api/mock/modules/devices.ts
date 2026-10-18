import type { Device, DeviceStatus, MyDevice } from "@mycity/contract/contract.gen.ts";
import { at, created, fail, notFound, ok, paged, route, sid } from "../core";
import { byKey, PEOPLE } from "../data/people";
import { stale } from "./security";
import { peopleGrant } from "./worksites";

/**
 * Clock-in devices on the mock, in the contract's shapes (packages/contract/schemas/devices.js).
 * "This device" is the signed-in person's own browser: it is recorded on their first punch and
 * registered from My Devices, at most three at once, after a recent sign-in. Nothing here carries
 * a fingerprint or an identifier; a device is a label and a status.
 */
export const MAX_REGISTERED = 3;

type Row = {
  attendance_device_id: string;
  key: string;
  label: string;
  platform: string | null;
  status: DeviceStatus;
  first_seen_at: string;
  last_punch_at: string | null;
  registered_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removal_reason: string | null;
  this_device: boolean;
};

const LABELS = ["iPhone 13 · Safari", "Galaxy S22 · Chrome", "Pixel 7 · Chrome", "Tecno Camon 20 · Chrome", "ThinkPad · Edge", "MacBook Air · Safari"];

/** One registered phone for most people; a few newly seen ones, and one taken off. */
const ROWS: Row[] = PEOPLE.flatMap((p, i) => {
  const label = LABELS[i % LABELS.length];
  const platform = label.split(" · ")[0].includes("iPhone") || label.startsWith("Mac") ? "Apple" : "Android";
  const base = { key: p.user_key, platform, removed_at: null, removed_by: null, removal_reason: null, this_device: false };
  const rows: Row[] = [
    { ...base, attendance_device_id: sid(`device:${p.user_key}:0`), label, status: i % 7 === 3 ? "observed" : "registered", first_seen_at: at(60 + i, "08:10"), last_punch_at: at(1 + (i % 3), "08:0" + (i % 9)), registered_at: i % 7 === 3 ? null : at(60 + i, "08:12") },
  ];
  if (i % 9 === 4)
    rows.push({ ...base, attendance_device_id: sid(`device:${p.user_key}:1`), label: "Infinix Hot 12 · Chrome", platform: "Android", status: "removed", first_seen_at: at(120, "08:00"), last_punch_at: at(90, "08:02"), registered_at: at(120, "08:01"), removed_at: at(70, "10:00"), removed_by: "cynthia", removal_reason: "Phone replaced" });
  return rows;
});

const browserLabel = () => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const what = /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android Phone" : /Mac/.test(ua) ? "Mac" : "This Computer";
  const how = /Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "Browser";
  return `${what} · ${how}`;
};

/** The device this session is on, recorded as seen (observed) the first time it is asked for. */
export function sessionDevice(user: string): Row {
  let row = ROWS.find((r) => r.key === user && r.this_device);
  if (!row) {
    row = {
      attendance_device_id: sid(`device:${user}:this`),
      key: user,
      label: browserLabel(),
      platform: null,
      status: user === "cynthia" ? "registered" : "observed",
      first_seen_at: new Date().toISOString(),
      last_punch_at: null,
      registered_at: user === "cynthia" ? new Date().toISOString() : null,
      removed_at: null,
      removed_by: null,
      removal_reason: null,
      this_device: true,
    };
    ROWS.unshift(row);
  }
  return row;
}

export const registeredCount = (user: string) => ROWS.filter((r) => r.key === user && r.status === "registered").length;

/** The label of the device a person last punched from, for the register. */
export const lastDeviceOf = (user: string) => ROWS.filter((r) => r.key === user && r.status !== "removed").sort((a, b) => (b.last_punch_at ?? "").localeCompare(a.last_punch_at ?? ""))[0] ?? null;

const mine = (r: Row): MyDevice => ({
  attendance_device_id: r.attendance_device_id,
  label: r.label,
  platform: r.platform,
  status: r.status,
  first_seen_at: r.first_seen_at,
  last_punch_at: r.last_punch_at,
  registered_at: r.registered_at,
  removed_at: r.removed_at,
  this_device: r.this_device,
});

const asPeople = (r: Row): Device => {
  const p = byKey(r.key)!;
  return {
    attendance_device_id: r.attendance_device_id,
    employee: { employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department },
    label: r.label,
    platform: r.platform,
    status: r.status,
    first_seen_at: r.first_seen_at,
    last_punch_at: r.last_punch_at,
    registered_at: r.registered_at,
    removed_at: r.removed_at,
    removed_by_name: r.removed_by ? (byKey(r.removed_by)?.display_name ?? null) : null,
    removal_reason: r.removal_reason,
  };
};

const order = (a: Row, b: Row) => Number(b.this_device) - Number(a.this_device) || b.first_seen_at.localeCompare(a.first_seen_at);

route("GET /api/v1/devices/mine", (req) => {
  sessionDevice(req.user!);
  return paged(ROWS.filter((r) => r.key === req.user).sort(order).map(mine), req);
});

route("POST /api/v1/devices/mine", (req) => {
  const refused = stale(req.user!);
  if (refused) return refused;
  const row = sessionDevice(req.user!);
  if (row.status !== "registered") {
    if (registeredCount(req.user!) >= MAX_REGISTERED) return fail(409, "DEVICE_LIMIT", `You have ${MAX_REGISTERED} registered devices. Remove one first.`);
    const label = String(req.body.label ?? "").trim();
    Object.assign(row, { status: "registered", registered_at: new Date().toISOString(), removed_at: null, removed_by: null, removal_reason: null, ...(label && { label }) });
  }
  return created(mine(row));
});

route("POST /api/v1/devices/mine/:id/remove", (req) => {
  const row = ROWS.find((r) => r.attendance_device_id === req.params.id && r.key === req.user);
  if (!row) return notFound();
  if (row.status === "removed") return fail(409, "DEVICE_REMOVED", "This device is already removed.");
  Object.assign(row, { status: "removed", removed_at: new Date().toISOString(), removed_by: req.user, removal_reason: null });
  return ok(mine(row));
});

route("GET /api/v1/devices", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return fail(403, "FORBIDDEN", "You do not have access to this.");
  return paged([...ROWS].filter((r) => g.sees(r.key)).sort(order).map(asPeople), req, {
    search: (d) => [d.label, d.employee.display_name, d.employee.department],
    filters: { status: (d, v) => d.status === v, employee_id: (d, v) => d.employee.employee_id === v },
  });
});

route("GET /api/v1/devices/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return fail(403, "FORBIDDEN", "You do not have access to this.");
  const row = ROWS.find((r) => r.attendance_device_id === req.params.id && g.sees(r.key));
  return row ? ok(asPeople(row)) : notFound();
});

route("POST /api/v1/devices/:id/remove", (req) => {
  const g = peopleGrant(req.user!, "edit");
  if (!g.may) return fail(403, "FORBIDDEN", "You do not have access to this.");
  const row = ROWS.find((r) => r.attendance_device_id === req.params.id && g.sees(r.key));
  if (!row) return notFound();
  if (row.status === "removed") return fail(409, "DEVICE_REMOVED", "This device is already removed.");
  const reason = String(req.body.removal_reason ?? "").trim();
  if (!reason) return fail(422, "VALIDATION_FAILED", "Check the highlighted fields", { removal_reason: ["Give a reason"] });
  Object.assign(row, { status: "removed", removed_at: new Date().toISOString(), removed_by: req.user, removal_reason: reason });
  return ok(asPeople(row));
});
