import { at, isoDaysAgo, sid } from "../core";
import { PEOPLE, type MockPerson } from "./people";

/**
 * Demonstration attendance: today's roster and the last 45 days of punches
 * for all 25 staff (over a thousand rows, so every attendance list pages).
 */
export type TodayStatus = "on_time" | "late" | "remote" | "leave" | "no_clockout" | "new_device" | "absent" | "suspended" | "not_yet";
export interface TodayRow {
  person: MockPerson;
  mode: "On Site" | "Remote" | "Field" | "None";
  clock_in: string | null;
  status: TodayStatus;
  late_min: number;
  kpi_pct: number;
  open_tasks: number;
}

const SPECIAL: Record<string, Partial<TodayRow>> = {
  bashir: { status: "late", clock_in: "09:41", late_min: 41 },
  hauwa: { status: "leave", clock_in: null, mode: "None" },
  tobi: { status: "leave", clock_in: null, mode: "None" },
  emeka: { status: "no_clockout", clock_in: "08:22" },
  seyi: { status: "new_device", clock_in: "08:58" },
  musa: { status: "suspended", clock_in: null, mode: "None" },
  rotimi: { status: "late", clock_in: "09:22", late_min: 22 },
  precious: { status: "absent", clock_in: null, mode: "None" },
};

export const TODAY: TodayRow[] = PEOPLE.map((p, i) => {
  const s = SPECIAL[p.user_key] ?? {};
  const remote = p.work_pattern === "remote" || (p.work_pattern === "hybrid" && i % 3 === 1);
  const base: TodayRow = {
    person: p,
    mode: remote ? "Remote" : "On Site",
    clock_in: `0${7 + (i % 2)}:${String(40 + ((i * 7) % 20)).padStart(2, "0")}`,
    status: remote ? "remote" : "on_time",
    late_min: 0,
    kpi_pct: 52 + ((i * 17) % 40),
    open_tasks: 3 + ((i * 5) % 7),
  };
  return { ...base, ...s } as TodayRow;
});

export const STATUS_PILL: Record<TodayStatus, { tone: "ok" | "warn" | "err" | "info" | "neutral"; text: string }> = {
  on_time: { tone: "ok", text: "On Time" },
  remote: { tone: "ok", text: "Remote" },
  late: { tone: "err", text: "Late" },
  leave: { tone: "info", text: "On Leave" },
  no_clockout: { tone: "warn", text: "No clock-out yesterday" },
  new_device: { tone: "warn", text: "New device" },
  absent: { tone: "err", text: "Not clocked in" },
  suspended: { tone: "neutral", text: "Suspended" },
  not_yet: { tone: "neutral", text: "Not yet" },
};

export interface PunchRow {
  event_id: string;
  person: MockPerson;
  date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  worked_minutes: number | null;
  location: string;
  status: "on_time" | "late" | "absent" | "leave" | "review" | "remote" | "weekend";
  late_minutes: number;
  note: string | null;
}

/** 45 days back from yesterday; Sundays off; Saturdays 09:00 to 15:00. */
export const HISTORY: PunchRow[] = (() => {
  const out: PunchRow[] = [];
  for (let d = 1; d <= 45; d += 1) {
    const date = isoDaysAgo(d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0) continue;
    PEOPLE.forEach((p, i) => {
      if (p.status === "suspended" && d < 10) return;
      // Saturdays are a half day for the on-site team only.
      if (dow === 6 && p.work_pattern !== "on_site") return;
      const seed = (i * 31 + d * 17) % 100;
      const leave = (p.user_key === "hauwa" && d < 4) || (p.user_key === "tobi" && d < 3) || seed === 97;
      const absent = !leave && seed === 3;
      const late = !leave && !absent && (seed > 88 || (p.user_key === "bashir" && d % 9 === 0));
      const lateMin = late ? 11 + (seed % 35) : 0;
      const inH = late ? `09:${String(lateMin).padStart(2, "0")}` : `0${7 + (seed % 2)}:${String(40 + (seed % 19)).padStart(2, "0")}`;
      const outH = dow === 6 ? `15:0${seed % 9}` : `17:${String(seed % 40).padStart(2, "0")}`;
      const remote = p.work_pattern === "remote" || (p.work_pattern === "hybrid" && seed % 3 === 0);
      const review = !leave && !absent && seed === 51;
      const [ih, im] = inH.split(":").map(Number);
      const [oh, om] = outH.split(":").map(Number);
      out.push({
        event_id: sid(`att:${p.user_key}:${date}`),
        person: p,
        date,
        clock_in_at: leave || absent ? null : at(d, inH),
        clock_out_at: leave || absent ? null : at(d, outH),
        worked_minutes: leave || absent ? null : oh * 60 + om - (ih * 60 + im) - (dow === 6 ? 0 : 60),
        location: leave ? "On Leave" : absent ? "No punch" : remote ? "Approved home location" : p.worksite,
        status: leave ? "leave" : absent ? "absent" : review ? "review" : late ? "late" : remote ? "remote" : dow === 6 ? "weekend" : "on_time",
        late_minutes: lateMin,
        note: review ? "Outside the geofence, explanation sent" : late && p.user_key === "bashir" ? "Counts toward the lateness rule" : null,
      });
    });
  }
  return out;
})();

export const summaryOf = (rows: TodayRow[]) => ({
  present: rows.filter((r) => r.clock_in).length,
  onsite: rows.filter((r) => r.mode === "On Site" && r.clock_in).length,
  remote: rows.filter((r) => r.mode === "Remote" && r.clock_in).length,
  late: rows.filter((r) => r.status === "late").length,
  noout: rows.filter((r) => r.status === "no_clockout").length,
  leave: rows.filter((r) => r.status === "leave").length,
});
