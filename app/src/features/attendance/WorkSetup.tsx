import attendance from "@mycity/contract/schemas/attendance.js";
import type { ScheduleDayInput, WorkDay, WorkSchedule, WorkScheduleSet } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { workPattern } from "@/features/people/status";
import { addDaysIso, Button, Card, CardHeader, CheckboxField, ChoiceField, DateField, ErrorState, Field, type FieldBinding, formatDate, FormFooter, Grid, HelpTerm, KeyValue, LoadingRows, Pill, Sub, TextAreaField, TimeField, toast, todayIso, useContractForm, useModal } from "@mycity/ui";
import { HOME_STATE, PLACE, WEEKDAY } from "./labels";

/**
 * People · Employees, the record's Work Schedule tab (docs/guides/attendance.md §6.13, §10): how the
 * person's week is worked (their pattern, office and home, and each weekday Working or Off with its
 * hours and place) and Set Schedule, their own week from a first day. With no schedule set, the
 * week is the company hours of the Attendance policy. The API decides who may set it; `can_edit`
 * says whether this reader may.
 */
export function EmployeeWorkSchedule({ id }: { id: string }) {
  const modal = useModal();
  const { data: w, error, reload } = useApi("GET /api/v1/attendance/schedules/:employee_id", { params: { employee_id: id } });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!w) return <LoadingRows count={4} />;
  const setSchedule = () => modal.open({ title: "Set Schedule", wide: true, full: true, body: (close) => <ScheduleForm w={w} close={close} onSaved={reload} /> });
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Work Setup" />
        <KeyValue
          items={[
            ["Work Pattern", workPattern(w.work_pattern)],
            [
              <HelpTerm key="o" help="A punch on an Office day is matched to this place and its radius.">
                Office
              </HelpTerm>,
              w.worksite ? `${w.worksite.name} · ${w.worksite.radius_m} m` : "No Office Assigned",
            ],
            ...(w.home_state ? ([["Home Location", <Pill key="h" tone={HOME_STATE[w.home_state].tone}>{HOME_STATE[w.home_state].text}</Pill>]] as Array<[string, ReactNode]>) : []),
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Work Schedule" help="Lateness and absence follow these days and hours." />
        <KeyValue
          items={[
            ...w.week.map((d) => [WEEKDAY[d.weekday], <DayLine key={d.weekday} d={d} />] as [string, ReactNode]),
            ["From", w.current ? formatDate(w.current.effective_from) : "Company Hours"],
            ...(w.next ? ([["Next", formatDate(w.next.effective_from)]] as Array<[string, string]>) : []),
          ]}
        />
        {w.can_edit && (
          <div className="mt-3 flex justify-end">
            <Button className="phone:w-full" icon="calendar" onClick={setSchedule}>
              Set Schedule
            </Button>
          </div>
        )}
      </Card>
    </Grid>
  );
}

/** One weekday as worked: its hours, Company Hours when they are the company's, and Office or Remote; or Off. */
function DayLine({ d }: { d: WorkDay }) {
  if (!d.working) return <Pill tone={PLACE.off.tone}>{PLACE.off.text}</Pill>;
  const place = PLACE[d.place ?? "office"];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{`${d.starts_at} to ${d.ends_at}`}</span>
      {d.company_hours && <Sub>Company Hours</Sub>}
      <Pill tone={place.tone}>{place.text}</Pill>
    </span>
  );
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
type Values = Record<string, string | boolean>;

/** The sheet's values: a row per weekday (Working, Starts, Ends, Office or Remote), then From and Reason. */
function startOf(w: WorkSchedule): Values {
  const kept = w.current ?? w.next;
  const v: Values = { effective_from: todayIso(), reason: "" };
  for (const i of DAYS) {
    const s: ScheduleDayInput | undefined = kept?.days[i];
    const d = w.week[i];
    // A schedule's day keeps its blank times (the company hours); with no schedule, the company hours stay blank too.
    v[`d${i}_working`] = s ? s.working : d.working;
    v[`d${i}_starts_at`] = s?.starts_at ?? "";
    v[`d${i}_ends_at`] = s?.ends_at ?? "";
    v[`d${i}_place`] = s?.place ?? d.place ?? "office";
  }
  return v;
}

/** The body the API takes: the seven days, Monday first; an Off day has no times or place. */
function bodyOf(v: Values): WorkScheduleSet {
  return {
    days: DAYS.map((i) => {
      const working = v[`d${i}_working`] === true;
      const time = (k: string) => (working && String(v[k] ?? "") ? String(v[k]) : null);
      return { weekday: i + 1, working, starts_at: time(`d${i}_starts_at`), ends_at: time(`d${i}_ends_at`), place: working ? (v[`d${i}_place`] as "office" | "remote") : null };
    }),
    effective_from: String(v.effective_from),
    reason: String(v.reason).trim(),
  };
}

/** A contract error's field: `days.2.starts_at` is `d2_starts_at`; one on the days as a whole sits on Monday's Working. */
function fieldOf(path: ReadonlyArray<PropertyKey>): string {
  const [head, i, key] = path.map(String);
  if (head !== "days") return head ?? "_";
  if (i === undefined || key === undefined) return "d0_working";
  return `d${i}_${key === "weekday" ? "working" : key}`;
}

/** Set Schedule: each weekday Working or Off, its hours (blank for the company hours) and place, from a first day, and why. */
function ScheduleForm({ w, close, onSaved }: { w: WorkSchedule; close: () => void; onSaved: () => void }) {
  const f = useContractForm<Values>(startOf(w), {
    safeParse: (v: unknown) => {
      const r = attendance.WorkScheduleSet.safeParse(bodyOf(v as Values));
      if (r.success) return r;
      return { success: false, error: { issues: r.error.issues.map((x) => ({ ...x, path: [fieldOf(x.path)] })) } };
    },
  });
  const save = useMutation("POST /api/v1/attendance/schedules/:employee_id");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { employee_id: w.employee.employee_id }, body: bodyOf(v) });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/employees");
      onSaved();
      close();
      toast("Schedule saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [fieldOf(k.split(".")), m])));
      else toast.error(e instanceof ApiError ? e.message : "Schedule not saved");
    }
  };
  /** A text value's binding: the form keeps one flat value per control. */
  const time = (key: string) => f.field(key) as FieldBinding<string> & { name: string };
  return (
    <>
      <CardHeader title="Days" help="Leave Starts and Ends empty for the company hours of that day." className="mb-2" />
      <div className="grid gap-2">
        {DAYS.map((i) => {
          const working = v[`d${i}_working`] === true;
          return (
            <Card key={i} className="grid gap-2 desk:grid-cols-3 desk:items-end">
              <Field label={WEEKDAY[i + 1]} {...f.status(`d${i}_working`)}>
                <CheckboxField label="Working" value={working} onChange={(x) => f.set(`d${i}_working`, x)} />
              </Field>
              {working && (
                <>
                  <Field label="Place" {...f.status(`d${i}_place`)}>
                    <ChoiceField label={`${WEEKDAY[i + 1]} Place`} value={String(v[`d${i}_place`])} onChange={(x) => f.set(`d${i}_place`, x)} options={[["office", "Office"], ["remote", "Remote"]]} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Starts" optional {...f.status(`d${i}_starts_at`)}>
                      <TimeField {...time(`d${i}_starts_at`)} />
                    </Field>
                    <Field label="Ends" optional {...f.status(`d${i}_ends_at`)}>
                      <TimeField {...time(`d${i}_ends_at`)} />
                    </Field>
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>
      <Field label="From" className="mt-3" {...f.status("effective_from")}>
        {/* At most 90 days ahead (the server's "Too far ahead"): the calendar offers no later day. */}
        <DateField {...time("effective_from")} min={todayIso()} max={addDaysIso(todayIso(), 90)} />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...time("reason")} placeholder="Evening desk cover" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>
          Save Schedule
        </Button>
      </FormFooter>
    </>
  );
}
