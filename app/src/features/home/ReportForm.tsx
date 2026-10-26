import reports from "@mycity/contract/schemas/reports.js";
import { useMemo, useRef, useState } from "react";
import type { HomeReport, HomeReportFilters, HomeReportFormat, HomeReportRecurrence, HomeReportRosterDay, HomeRosterStatus, Me } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { ColleaguePicker } from "@/features/shared/pickers";
import {
  CheckboxField,
  ChoiceField,
  DateField,
  Field,
  Inline,
  SelectField,
  TextField,
  TimeField,
  toast,
  todayIso,
  useContractForm,
  useDismiss,
  useModal,
  useUnsavedChanges,
  Wizard,
  type ContractSchema,
  type WizardStep,
} from "@mycity/ui";
import { mayUseTab } from "./access";
import { ALERT_CATEGORY, isoWeekday, LEAVE_STATUS, REPORT_SOURCE, ROSTER_STATUS, SEVERITY, WEEKDAY_SHORT, type ReportSourceKey } from "./labels";

/**
 * New Report and Edit Report (docs/guides/home.md §6 Reports, §10.1): one form in three steps,
 * checked by the contract's own rule (HomeReportCreate), in the app's one modal (a full-screen
 * sheet on a phone).
 *
 *   Report     Report Name, Source (the sources the reader may open; never the Overview), the
 *              source's own filters, Share With Managers
 *   Schedule   Repeats (Daily, Weekly, Monthly, or On Demand), Days for a weekly rule, Start
 *              Date, Time, Working Days Only
 *   Delivery   Recipients and Formats; a report run On Demand has no Delivery step, since
 *              Run Now sends the file to whoever runs it
 *
 * A report's source stays once it is made (its filters belong to it), so Edit Report does not
 * offer it. What the form does not show of a saved rule (an interval, a day of the month) is
 * kept as long as Repeats stays as it was, so saving never changes a schedule silently, and a
 * schedule the person did not change is not sent at all. The server checks only the recipients a
 * schedule adds, and a refusal names the person, on Recipients.
 */

type FilterKey = keyof HomeReportFilters;
type Freq = HomeReportRecurrence["freq"];
export type Repeats = Freq | "on_demand";
export type FormatChoice = HomeReportFormat | "both";

/** The filters the contract knows, each meaning one thing whichever source takes it. */
const FILTER_KEYS = Object.keys(reports.HomeReportFilters.shape) as FilterKey[];

/** Someone a report goes to: their login (what the report is generated as), and the person the picker found, when it did. */
export interface Recipient {
  user_id: string;
  display_name: string;
  employee_id: string | null;
}

/** The form's values, as its fields hold them. */
export interface ReportValues extends Record<string, unknown> {
  name: string;
  report_key: string;
  department_id: string;
  roster_day: HomeReportRosterDay;
  roster_statuses: HomeRosterStatus[];
  leave_status: string;
  leave_type_id: string;
  category: string;
  severity: string;
  shared: boolean;
  repeats: Repeats;
  by_weekday: number[];
  starts_on: string;
  run_time: string;
  working_days_only: boolean;
  recipients: Recipient[];
  formats: FormatChoice;
  /** What the form does not show of a saved rule, kept while Repeats stays `freq`. */
  kept: { freq: Freq; interval?: number; by_month_day?: number } | null;
}

/** The time a new schedule runs at: the end of the working day. */
const DEFAULT_TIME = "18:00";

/** Every filter off: Daily Attendance reads today, for everyone. */
const NO_FILTERS = {
  ...(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])) as Record<FilterKey, string>),
  roster_day: "today",
  roster_statuses: [],
} as Pick<ReportValues, FilterKey>;

/** A filter chosen on the form: a choice other than its default, or at least one status ticked. */
const chosen = (key: FilterKey, value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value) && value !== NO_FILTERS[key]);

const FORMATS: Record<FormatChoice, HomeReportFormat[]> = { pdf: ["pdf"], xlsx: ["xlsx"], both: ["pdf", "xlsx"] };
const formatChoiceOf = (formats: readonly HomeReportFormat[]): FormatChoice => (formats.length > 1 ? "both" : formats[0]);

const REPEATS: Array<[Repeats, string]> = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["on_demand", "On Demand"],
];
const FORMAT_OPTIONS: Array<[FormatChoice, string]> = [
  ["pdf", "PDF"],
  ["xlsx", "XLSX"],
  ["both", "Both"],
];

const isSource = (key: string): key is ReportSourceKey => Object.hasOwn(reports.HOME_REPORT_SOURCES, key);
/** The filters a source takes; none for a key the contract does not list. */
export const filtersOf = (source: string): readonly FilterKey[] => (isSource(source) ? (reports.HOME_REPORT_SOURCES[source].filters as readonly FilterKey[]) : []);

/**
 * The sources New Report offers this reader, in the contract's order: those the form offers (never
 * the Overview, which is the Overview's own Export) that they may open, as the server decides it:
 * the module's `view` grant and, for Open Alerts, which is the Alerts tab's own list, what opens
 * that tab. A report is generated with its reader's own grants, so nothing else is offered.
 * @param may  whether the reader holds `view` on a module
 */
export function offeredSources(me: Me, may: (module: string) => boolean): Array<[ReportSourceKey, string]> {
  const opens = (key: ReportSourceKey) => me.is_ceo || (may(reports.HOME_REPORT_SOURCES[key].module) && (key !== "open_alerts" || mayUseTab(me, "alerts")));
  return (Object.keys(reports.HOME_REPORT_SOURCES) as ReportSourceKey[]).filter((key) => reports.HOME_REPORT_SOURCES[key].offered && opens(key)).map((key) => [key, REPORT_SOURCE[key]]);
}

/** The reader, as the first recipient of a report they schedule. */
const readerOf = (me: Pick<Me, "user_id" | "display_name" | "employee_id">): Recipient => ({ user_id: me.user_id, display_name: me.display_name, employee_id: me.employee_id });

/** New Report's first values: every working day at 18:00 from today, to the reader, as a PDF. */
export function newReportValues(me: Pick<Me, "user_id" | "display_name" | "employee_id">, source: string, today = todayIso()): ReportValues {
  return {
    name: "",
    report_key: source,
    ...NO_FILTERS,
    shared: false,
    repeats: "daily",
    by_weekday: [isoWeekday(today)],
    starts_on: today,
    run_time: DEFAULT_TIME,
    working_days_only: true,
    recipients: [readerOf(me)],
    formats: "pdf",
    kept: null,
  };
}

/** A saved report's values, for Edit Report. One run On Demand starts a schedule as New Report would. */
export function reportValues(report: HomeReport, me: Pick<Me, "user_id" | "display_name" | "employee_id">, today = todayIso()): ReportValues {
  const s = report.schedule;
  const start = newReportValues(me, report.report_key, today);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, report.filters[k] ?? NO_FILTERS[k]])) as Pick<ReportValues, FilterKey>;
  // A report saved before the day held its own statuses may tick one its day cannot (Absent on Today):
  // the form drops it, as changing Day does, since no box is drawn to untick it.
  const holds = reports.ROSTER_STATUSES_ON[filters.roster_day] as readonly string[] | undefined;
  if (holds) filters.roster_statuses = filters.roster_statuses.filter((x) => holds.includes(x));
  if (!s) return { ...start, name: report.name, ...filters, shared: report.shared, repeats: "on_demand" };
  const r = s.recurrence;
  return {
    ...start,
    name: report.name,
    ...filters,
    shared: report.shared,
    repeats: r.freq,
    by_weekday: r.by_weekday ?? [isoWeekday(s.starts_on)],
    starts_on: s.starts_on,
    run_time: s.run_time,
    working_days_only: r.working_days_only === true,
    recipients: s.audience.map((a) => ({ user_id: a.user_id, display_name: a.display_name, employee_id: null })),
    formats: formatChoiceOf(s.formats),
    kept: { freq: r.freq, interval: r.interval, by_month_day: r.by_month_day },
  };
}

/** The schedule as the API takes it, or null for a report run On Demand. */
function scheduleBody(v: ReportValues) {
  if (v.repeats === "on_demand") return null;
  const kept = v.kept?.freq === v.repeats ? v.kept : null;
  const recurrence: HomeReportRecurrence = {
    freq: v.repeats,
    ...(kept?.interval !== undefined && kept.interval > 1 ? { interval: kept.interval } : {}),
    ...(v.repeats === "weekly" ? { by_weekday: [...v.by_weekday].sort((a, b) => a - b) } : {}),
    ...(v.repeats === "monthly" && kept?.by_month_day !== undefined ? { by_month_day: kept.by_month_day } : {}),
    ...(v.working_days_only ? { working_days_only: true } : {}),
  };
  return { recurrence, starts_on: v.starts_on, run_time: v.run_time, formats: FORMATS[v.formats], recipient_user_ids: v.recipients.map((r) => r.user_id) };
}

/** The report as POST /home/reports takes it: only the filters its source takes, and only those chosen. */
export function reportBody(v: ReportValues) {
  const filters = Object.fromEntries(filtersOf(v.report_key).flatMap((k) => (chosen(k, v[k]) ? [[k, v[k]]] : []))) as HomeReportFilters;
  return { name: v.name.trim(), report_key: v.report_key, filters, shared: v.shared, schedule: scheduleBody(v) };
}

/**
 * A change as PATCH /home/reports/:id takes it: the report but its source, which stays, and its
 * schedule only when the person changed it from `opened`, the values the form opened with. A
 * schedule left as it was is not sent, so a new name or sharing alone never saves it again.
 */
export function changeBody(v: ReportValues, opened: ReportValues) {
  const { report_key: _source, schedule, ...change } = reportBody(v);
  const same = JSON.stringify(schedule) === JSON.stringify(scheduleBody(opened));
  return { ...change, ...(same ? {} : { schedule }) };
}

const SCHEDULE_FIELDS: Record<string, keyof ReportValues> = { starts_on: "starts_on", run_time: "run_time", formats: "formats", recipient_user_ids: "recipients" };

/**
 * The field a problem belongs on, from where the contract or the server found it: a filter on
 * its own field, a schedule's parts on theirs ("schedule.recipient_user_ids" is Recipients).
 * Null for a problem with no field.
 */
export function fieldOf(path: ReadonlyArray<PropertyKey>): keyof ReportValues | null {
  const [top, next, last] = path.map(String);
  if (top === "filters") return FILTER_KEYS.includes(next as FilterKey) ? (next as FilterKey) : "report_key";
  if (top === "schedule") {
    if (next === "recurrence") return last === "by_weekday" || last === "working_days_only" ? last : "repeats";
    return SCHEDULE_FIELDS[next] ?? "repeats";
  }
  return ["name", "report_key", "shared"].includes(top) ? top : null;
}

/** A message the contract wrote for a person: four words at most ("Pick a day"), unlike Zod's own. */
const ownWords = (message: string) => message.trim().split(/\s+/).length <= 4;

/**
 * The contract's own rule over the whole report, each problem put on the field that shows it,
 * in the contract's own words where it wrote some ("Add a recipient" rather than "Too short").
 */
const REPORT_RULES: ContractSchema = {
  safeParse(values: unknown) {
    const r = reports.HomeReportCreate.safeParse(reportBody(values as ReportValues));
    if (r.success) return r;
    const issues = r.error.issues.flatMap((issue) => {
      const field = fieldOf(issue.path);
      return field ? [{ path: [field], message: issue.message, code: ownWords(issue.message) ? "custom" : issue.code }] : [];
    });
    return { success: false, error: { issues } };
  },
};

/** The fields each step marks before it moves on. */
const SCHEDULE_KEYS: Array<keyof ReportValues> = ["repeats", "by_weekday", "starts_on", "run_time", "working_days_only"];
const DELIVERY_KEYS: Array<keyof ReportValues> = ["recipients", "formats"];
const reportKeys = (source: string): Array<keyof ReportValues> => ["name", "report_key", ...filtersOf(source), "shared"];

/** The step a field is on, to go back to it when saving finds a problem there. */
function stepOf(key: keyof ReportValues): number {
  if (SCHEDULE_KEYS.includes(key)) return 1;
  if (DELIVERY_KEYS.includes(key)) return 2;
  return 0;
}

/** The first field the contract finds a problem on, in the order the steps show them. */
export function firstProblem(values: ReportValues): keyof ReportValues | null {
  const r = REPORT_RULES.safeParse(values);
  const keys = (r.error?.issues ?? []).map((i) => i.path[0] as keyof ReportValues);
  return keys.sort((a, b) => stepOf(a) - stepOf(b))[0] ?? null;
}

export interface ReportForms {
  openNew: () => void;
  openEdit: (report: HomeReport) => void;
}

/** New Report and Edit Report, opened in the app's one modal: a dialog on desktop, a full-screen sheet with its steps on a phone. */
export function useReportForms(): ReportForms {
  const modal = useModal();
  return useMemo(
    () => ({
      openNew: () => modal.open({ title: "New Report", full: true, body: (close) => <ReportForm close={close} /> }),
      openEdit: (report) => modal.open({ title: "Edit Report", full: true, body: (close) => <ReportForm report={report} close={close} /> }),
    }),
    [modal],
  );
}

/** After a report changes: its card, the counts above them, and the runs it may have queued. */
export function refreshReports() {
  invalidate("/api/v1/home/reports");
  invalidate("/api/v1/home/report-runs");
}

function ReportForm({ report, close }: { report?: HomeReport; close: () => void }) {
  const me = useMe();
  const { can } = useAuth();
  const dismiss = useDismiss();
  const sources = offeredSources(me, (module) => can(module));
  const [opened] = useState(() => (report ? reportValues(report, me) : newReportValues(me, sources[0]?.[0] ?? "")));
  const f = useContractForm<ReportValues>(opened, REPORT_RULES);
  useUnsavedChanges(f.isDirty);
  const create = useMutation("POST /api/v1/home/reports");
  const update = useMutation("PATCH /api/v1/home/reports/:id");
  /* The step to show again when saving finds a problem on an earlier one: the wizard starts over there. */
  const [restart, setRestart] = useState({ step: 0, times: 0 });
  const v = f.values;

  const backTo = (key: keyof ReportValues) => setRestart((r) => ({ step: stepOf(key), times: r.times + 1 }));

  const save = async () => {
    // Every step's fields, in case one on an earlier step was marked since it was passed.
    if (!f.check()) {
      const first = firstProblem(f.values);
      if (first) backTo(first);
      return;
    }
    try {
      if (report) await update.run({ params: { id: report.saved_report_id }, body: changeBody(v, opened) });
      else await create.run({ body: reportBody(v) });
      refreshReports();
      close();
      toast(report ? "Report saved" : "Report created");
    } catch (e) {
      const marked = e instanceof ApiError ? serverFields(e.fields) : {};
      const keys = Object.keys(marked) as Array<keyof ReportValues>;
      if (keys.length === 0) {
        toast.error(e instanceof ApiError ? e.message : "Report not saved. Try again.");
        return;
      }
      f.setServerErrors(marked);
      backTo(keys.sort((a, b) => stepOf(a) - stepOf(b))[0]);
    }
  };

  const takes = filtersOf(v.report_key);
  const steps: WizardStep[] = [
    {
      title: "Report",
      check: () => f.check(reportKeys(v.report_key)),
      body: (
        <>
          <Field label="Report Name" {...f.status("name")}>
            <TextField {...f.field("name")} maxLength={80} />
          </Field>
          {!report && (
            <Field label="Source" {...f.status("report_key")}>
              <SelectField
                options={sources}
                {...f.field("report_key")}
                onChange={(source) => {
                  // A source's filters belong to it: a new source starts with none.
                  f.setValues((prev) => ({ ...prev, ...NO_FILTERS }));
                  f.set("report_key", source);
                }}
              />
            </Field>
          )}
          <SourceFilters takes={takes} field={f.field} status={f.status} values={v} set={f.set} />
          <CheckboxField {...f.field("shared")} label="Share With Managers" />
        </>
      ),
    },
    {
      title: "Schedule",
      check: () => f.check(SCHEDULE_KEYS),
      body: (
        <>
          <Field label="Repeats" {...f.status("repeats")}>
            <ChoiceField label="Repeats" options={REPEATS} {...f.field("repeats")} />
          </Field>
          {v.repeats === "weekly" && (
            <Field label="Days" {...f.status("by_weekday")}>
              <Inline gap={1}>
                {WEEKDAY_SHORT.map((day, i) => (
                  <CheckboxField key={day} label={day} value={v.by_weekday.includes(i + 1)} onChange={(on) => f.set("by_weekday", on ? [...v.by_weekday, i + 1] : v.by_weekday.filter((d) => d !== i + 1))} />
                ))}
              </Inline>
            </Field>
          )}
          {v.repeats !== "on_demand" && (
            <>
              <Field label="Start Date" {...f.status("starts_on")}>
                <DateField {...f.field("starts_on")} min={report ? undefined : todayIso()} />
              </Field>
              <Field label="Time" {...f.status("run_time")}>
                <TimeField {...f.field("run_time")} />
              </Field>
              <CheckboxField {...f.field("working_days_only")} label="Working Days Only" />
            </>
          )}
        </>
      ),
    },
    ...(v.repeats === "on_demand"
      ? []
      : [
          {
            title: "Delivery",
            check: () => f.check(DELIVERY_KEYS),
            body: (
              <>
                <Field label="Recipients" {...f.status("recipients")}>
                  <RecipientPicker value={v.recipients} onChange={(next) => f.set("recipients", next)} />
                </Field>
                <Field label="Formats" {...f.status("formats")}>
                  <ChoiceField label="Formats" options={FORMAT_OPTIONS} {...f.field("formats")} />
                </Field>
              </>
            ),
          },
        ]),
  ];

  return (
    <Wizard
      key={restart.times}
      initialStep={restart.step}
      steps={steps}
      finish={report ? "Save Report" : "Create Report"}
      busy={create.pending || update.pending}
      onFinish={() => save()}
      onCancel={dismiss}
    />
  );
}

/** The server's 422 on the form's fields ("schedule.formats" on Formats); a problem with no field is not one of them. */
function serverFields(fields: Record<string, string[] | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, messages] of Object.entries(fields)) {
    const key = fieldOf(path.split("."));
    if (key && messages?.length && !out[key]) out[key] = messages;
  }
  return out;
}

type FieldBindings = Pick<ReturnType<typeof useContractForm<ReportValues>>, "field" | "status" | "set"> & { values: ReportValues };

/** Each filter a select offers: its label, the choice that leaves it off, and its own choices. */
const FILTER_FIELDS: Record<Exclude<FilterKey, "roster_day" | "roster_statuses">, { label: string; all: string; options: Array<[string, string]> }> = {
  department_id: { label: "Department", all: "All Departments", options: [] },
  leave_status: { label: "Status", all: "Every Status", options: Object.entries(LEAVE_STATUS) },
  leave_type_id: { label: "Leave Type", all: "Every Type", options: [] },
  category: { label: "Category", all: "Every Category", options: Object.entries(ALERT_CATEGORY) },
  severity: { label: "Severity", all: "Every Severity", options: Object.entries(SEVERITY).map(([k, s]) => [k, s.text]) },
};

/** Daily Attendance's days: the day so far, or the closed day before it. */
const ROSTER_DAYS: Array<[HomeReportRosterDay, string]> = [
  ["today", "Today So Far"],
  ["last_working_day", "Last Working Day"],
];

/** The statuses in the order the form lists them. */
const ROSTER_ORDER: HomeRosterStatus[] = ["on_site", "remote", "field", "late", "not_in", "absent", "on_leave"];

/**
 * Daily Attendance's Day and Statuses. Absent is offered only on the Last Working Day and Not In
 * only Today, as the contract holds them (ROSTER_STATUSES_ON); a new day drops a ticked status it
 * cannot hold. None ticked is everyone.
 */
function RosterFilters({ field, status, values, set }: FieldBindings) {
  const day = values.roster_day;
  const offered = ROSTER_ORDER.filter((s) => (reports.ROSTER_STATUSES_ON[day] as readonly string[]).includes(s));
  return (
    <>
      <Field label="Day" {...status("roster_day")}>
        <ChoiceField
          label="Day"
          options={ROSTER_DAYS}
          {...field("roster_day")}
          onChange={(next) => {
            set("roster_day", next);
            const holds = reports.ROSTER_STATUSES_ON[next] as readonly string[];
            set("roster_statuses", values.roster_statuses.filter((s) => holds.includes(s)));
          }}
        />
      </Field>
      <Field label="Statuses" optional {...status("roster_statuses")}>
        <Inline gap={1}>
          {offered.map((s) => (
            <CheckboxField
              key={s}
              label={ROSTER_STATUS[s].text}
              value={values.roster_statuses.includes(s)}
              onChange={(on) => set("roster_statuses", on ? [...values.roster_statuses, s] : values.roster_statuses.filter((x) => x !== s))}
            />
          ))}
        </Inline>
      </Field>
    </>
  );
}

/** The filters the chosen source takes; the departments and leave types are read only when one is offered. */
function SourceFilters({ takes, field, status, values, set }: { takes: readonly FilterKey[] } & FieldBindings) {
  const departments = useApi("GET /api/v1/departments", { query: { active: "true" }, enabled: takes.includes("department_id") });
  const types = useApi("GET /api/v1/leave/types", { query: { active: "true" }, enabled: takes.includes("leave_type_id") });
  const read: Partial<Record<FilterKey, Array<[string, string]>>> = {
    department_id: (departments.data?.data ?? []).map((d): [string, string] => [d.department_id, d.name]),
    leave_type_id: (types.data?.data ?? []).map((t): [string, string] => [t.leave_type_id, t.name]),
  };
  return (
    <>
      {takes.includes("roster_day") && <RosterFilters field={field} status={status} values={values} set={set} />}
      {takes.map((key) => {
        if (key === "roster_day" || key === "roster_statuses") return null;
        const spec = FILTER_FIELDS[key];
        return (
          <Field key={key} label={spec.label} {...status(key)}>
            <SelectField options={[["", spec.all], ...(read[key] ?? spec.options)]} {...field(key)} />
          </Field>
        );
      })}
    </>
  );
}

/**
 * Recipients: anyone who signs in, the reader included, searched on the server 25 at a time (the
 * colleague picker). A report is generated as each recipient, so each person picked is looked up
 * for their login (their profile card) before they join the list. Someone already on it is never
 * added twice. A recipient read back from a saved schedule has a login and no employee id, and
 * stands in the picker under their login.
 */
function RecipientPicker({ value, onChange }: { value: Recipient[]; onChange: (next: Recipient[]) => void }) {
  const latest = useRef(value);
  latest.current = value;
  const idOf = (r: Recipient) => r.employee_id ?? r.user_id;
  const picked: PersonRef[] = value.map((r) => ({ employee_id: idOf(r), display_name: r.display_name }));

  const change = async (next: PersonRef[]) => {
    const now = latest.current;
    const still = new Set(next.map((p) => p.employee_id));
    const added = next.find((p) => !now.some((r) => idOf(r) === p.employee_id));
    if (!added) {
      onChange(now.filter((r) => still.has(idOf(r))));
      return;
    }
    try {
      const card = await api.call("GET /api/v1/community/people/:id/card", { params: { id: added.employee_id } });
      if (!card.user_id) {
        toast.error(`${added.display_name} cannot sign in yet`);
        return;
      }
      const current = latest.current;
      const same = current.find((r) => r.user_id === card.user_id);
      const joined: Recipient = { user_id: card.user_id, display_name: added.display_name, employee_id: added.employee_id };
      onChange(same ? current.map((r) => (r === same ? joined : r)) : [...current, joined]);
    } catch {
      toast.error(`${added.display_name} not added. Try again.`);
    }
  };

  return <ColleaguePicker value={picked} onChange={(next) => void change(next)} multiple withSelf />;
}
