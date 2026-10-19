import attendance from "@mycity/contract/schemas/attendance.js";
import type { WorkSchedule } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { workPattern } from "@/features/people/status";
import { Button, Card, CardHeader, ChoiceField, DateField, ErrorState, Field, formatDate, FormFooter, Grid, HelpTerm, KeyValue, LoadingRows, Pill, TextAreaField, toast, todayIso, useContractForm, useModal } from "@mycity/ui";
import { HOME_STATE, officeDaysText, PLACE, WEEKDAY } from "./labels";

/**
 * People · Employees, the record's Attendance tab (docs/guides/attendance.md §6.13, §10): how the
 * person's week is worked (their pattern, office, home and each day's place) and, for a hybrid
 * employee, Set Schedule, the office days from a first day. The API decides who may set it;
 * `can_edit` says whether this reader may.
 */
export function EmployeeAttendance({ id }: { id: string }) {
  const modal = useModal();
  const { data: w, error, reload } = useApi("GET /api/v1/attendance/schedules/:employee_id", { params: { employee_id: id } });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!w) return <LoadingRows count={4} />;
  const setSchedule = () => modal.open({ title: "Set Schedule", body: (close) => <ScheduleForm w={w} close={close} onSaved={reload} /> });
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Work Setup" />
        <KeyValue
          items={[
            ["Work Pattern", workPattern(w.work_pattern)],
            [
              <HelpTerm key="o" help="A punch on an office day is matched to this place and its radius.">
                Office
              </HelpTerm>,
              w.worksite ? `${w.worksite.name} · ${w.worksite.radius_m} m` : "No Office Assigned",
            ],
            ...(w.home_state
              ? ([["Home Location", <Pill key="h" tone={HOME_STATE[w.home_state].tone}>{HOME_STATE[w.home_state].text}</Pill>]] as Array<[string, React.ReactNode]>)
              : []),
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Work Week" help="Office days are matched to the office; the other working days to the approved home." />
        <KeyValue
          items={[
            ...w.week.map((d) => [WEEKDAY[d.weekday], <Pill key={d.weekday} tone={PLACE[d.place].tone}>{PLACE[d.place].text}</Pill>] as [string, React.ReactNode]),
            ...(w.current ? ([["From", formatDate(w.current.effective_from)]] as Array<[string, string]>) : []),
            ...(w.next ? ([["Next", `Office ${officeDaysText(w.next.office_days)} from ${formatDate(w.next.effective_from)}`]] as Array<[string, string]>) : []),
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

type Values = { office: Record<number, "office" | "remote">; effective_from: string; reason: string };

/** The body the API takes: the days marked Office, in order. */
const bodyOf = (v: Values) => ({
  office_days: Object.entries(v.office)
    .filter(([, place]) => place === "office")
    .map(([d]) => Number(d))
    .sort((a, b) => a - b),
  effective_from: v.effective_from,
  reason: v.reason.trim(),
});

/** The office days of the schedule in force (else the one waiting, else every working day). */
function startOf(w: WorkSchedule, working: number[]): Values["office"] {
  const days = w.current?.office_days ?? w.next?.office_days ?? working;
  return Object.fromEntries(working.map((d) => [d, days.includes(d) ? "office" : "remote"]));
}

/** Set Schedule: Office or Remote for each working day, from a first day, and why. */
function ScheduleForm({ w, close, onSaved }: { w: WorkSchedule; close: () => void; onSaved: () => void }) {
  const working = w.week.filter((d) => d.place !== "off").map((d) => d.weekday);
  const f = useContractForm<Values>(
    { office: startOf(w, working), effective_from: todayIso(), reason: "" },
    {
      safeParse: (v: unknown) => {
        const r = attendance.WorkScheduleSet.safeParse(bodyOf(v as Values));
        if (r.success) return r;
        return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [i.path[0] === "office_days" ? "office" : i.path[0]] })) } };
      },
    },
  );
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
      if (e instanceof ApiError && Object.keys(e.fields).length)
        f.setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k === "office_days" ? "office" : k, m])));
      else toast(e instanceof ApiError ? e.message : "Schedule not saved");
    }
  };
  return (
    <>
      <Field label="Office Days" {...f.status("office")}>
        <div className="overflow-hidden rounded-box border border-border">
          {working.map((d) => (
            <div key={d} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
              <span className="w-24 text-xs font-semibold">{WEEKDAY[d]}</span>
              <ChoiceField
                label={WEEKDAY[d]}
                value={v.office[d]}
                onChange={(place) => f.set("office", { ...v.office, [d]: place })}
                options={[["office", "Office"], ["remote", "Remote"]]}
              />
            </div>
          ))}
        </div>
      </Field>
      <Field label="From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Team days moved" rows={2} />
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
