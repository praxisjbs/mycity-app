/**
 * Performance · Goals, Set Up Quarter and Edit Quarter (docs/guides/performance.md §3.2, §5, §10): the
 * quarter (name, start, the end that follows it, lock date, status), then its scoring rules, which
 * start as a copy of the last quarter's: the bands, the key results' and the lines' scoring thresholds
 * and the section weights. The contract's PeriodCreate or PeriodEdit, ScoringRules inside, checks every
 * field, and each problem lands on its field. A quarter is set up before it starts (Q1 2027 in October).
 */
import goalsContract from "@mycity/contract/schemas/goals.js";
import scoring from "@mycity/contract/schemas/scoring.js";
import type { Endpoints, PerformancePeriod, ScoringRules } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { ChoiceField, DateField, Field, formatDate, NumberField, TextField, toast, useContractForm, Wizard } from "@mycity/ui";
import { bodySchema } from "./shared";

type Group = "key_results" | "lines" | "bands" | "sections";
type Rule = { step: string; group: Group; key: string; label: string; decimal: boolean };

/** The rules set here, each a field of its step. The deadlines (`due_business_days`) are carried as they are. */
const RULES: Rule[] = [
  { step: "Bands", group: "key_results", key: "band_good", label: "Good From", decimal: true },
  { step: "Bands", group: "key_results", key: "band_watch", label: "Watch From", decimal: true },
  { step: "Bands", group: "bands", key: "exceeds", label: "Exceeds From", decimal: true },
  { step: "Bands", group: "bands", key: "meets", label: "Meets From", decimal: true },
  { step: "Bands", group: "bands", key: "partly_meets", label: "Partly Meets From", decimal: true },
  { step: "Key Result Scoring", group: "key_results", key: "dated_on_time", label: "Done On Time", decimal: true },
  { step: "Key Result Scoring", group: "key_results", key: "dated_grace_days", label: "Grace Days", decimal: false },
  { step: "Key Result Scoring", group: "key_results", key: "dated_late", label: "Done Late", decimal: true },
  { step: "Key Result Scoring", group: "key_results", key: "dated_partly", label: "Partly Done", decimal: true },
  { step: "Line Scoring", group: "lines", key: "milestone_on_time", label: "Milestone On Time", decimal: true },
  { step: "Line Scoring", group: "lines", key: "milestone_grace_business_days", label: "Grace Business Days", decimal: false },
  { step: "Line Scoring", group: "lines", key: "milestone_late", label: "Milestone Late", decimal: true },
  { step: "Line Scoring", group: "lines", key: "standard_met", label: "Standard Met", decimal: true },
  { step: "Line Scoring", group: "lines", key: "standard_near", label: "Standard Near Miss", decimal: true },
  { step: "Line Scoring", group: "lines", key: "standard_near_points", label: "Near Miss Points", decimal: true },
  { step: "Section Weights", group: "sections", key: "results", label: "Results", decimal: false },
  { step: "Section Weights", group: "sections", key: "kpis", label: "KPIs", decimal: false },
  { step: "Section Weights", group: "sections", key: "accountability", label: "Accountability", decimal: false },
];
const STEPS = ["Bands", "Key Result Scoring", "Line Scoring", "Section Weights"];
const QUARTER_FIELDS = ["name", "starts_on", "targets_lock_on", "status"];

type Values = Record<string, string>;
const ruleField = (r: Rule) => `${r.group}/${r.key}`;

/** A day some months on: "2026-10-01" and 3 → "2027-01-01". */
function addMonths(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** A quarter's last day: three months on, less a day. */
function quarterEnd(startsOn: string) {
  if (!/^\d{4}-(01|04|07|10)-01$/.test(startsOn)) return "";
  const d = new Date(`${addMonths(startsOn, 3)}T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** The first day of the quarter after the latest one set up; this quarter's when there is none. */
function nextStart(latest: PerformancePeriod | undefined, today = new Date()) {
  if (latest) return addMonths(latest.starts_on, 3);
  const month = Math.floor(today.getUTCMonth() / 3) * 3 + 1;
  return `${today.getUTCFullYear()}-${String(month).padStart(2, "0")}-01`;
}

/** "Q1 2027" for a quarter starting 2027-01-01, the name it takes when none is given. */
const quarterName = (startsOn: string) => (/^\d{4}-\d{2}-01$/.test(startsOn) ? `Q${Math.floor((Number(startsOn.slice(5, 7)) - 1) / 3) + 1} ${startsOn.slice(0, 4)}` : "");

/** The form's rule fields as the contract's rules, on top of `base` (which keeps the deadlines). A blank field is missing, never zero. */
function rulesOf(v: Values, base: ScoringRules): ScoringRules {
  const out = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, number | undefined>>;
  for (const r of RULES) {
    const raw = String(v[ruleField(r)] ?? "").trim();
    out[r.group][r.key] = raw === "" ? undefined : Number(raw);
  }
  return out as unknown as ScoringRules;
}

/** A problem's path as the field it belongs to: "rules.sections.results" is the Results field. */
const fieldOf = (path: PropertyKey[]) => (path[0] === "rules" ? `${String(path[1])}/${String(path[2])}` : String(path[0] ?? ""));

const STATUS: Array<[string, string]> = [["planning", "Planning"], ["active", "Active"], ["closed", "Closed"]];

/**
 * Set Up Quarter (no `period`) or Edit Quarter. A new quarter's rules start as the latest quarter's
 * (the code's defaults for the first); `onSaved` is told the quarter saved.
 */
export function QuarterWizard({ close, period, latest, onSaved }: { close: () => void; period?: PerformancePeriod; latest?: PerformancePeriod; onSaved?: (p: PerformancePeriod) => void }) {
  const editing = Boolean(period);
  const base: ScoringRules = period?.rules ?? latest?.rules ?? (scoring.DEFAULT_RULES as ScoringRules);
  const initial: Values = {
    name: period?.name ?? "",
    starts_on: period?.starts_on ?? nextStart(latest),
    targets_lock_on: period?.targets_lock_on ?? "",
    status: period?.status ?? "planning",
    ...Object.fromEntries(RULES.map((r) => [ruleField(r), String((base[r.group] as Record<string, number>)[r.key] ?? "")])),
  };
  const toBody = (v: Values) =>
    editing
      ? { name: v.name, targets_lock_on: v.targets_lock_on || null, status: v.status, rules: rulesOf(v, base) }
      : { starts_on: v.starts_on, name: v.name, targets_lock_on: v.targets_lock_on, status: v.status, rules: rulesOf(v, base) };
  const f = useContractForm(initial, bodySchema<Values>(editing ? goalsContract.PeriodEdit : goalsContract.PeriodCreate, toBody, fieldOf));
  const create = useMutation("POST /api/v1/performance/periods");
  const change = useMutation("PATCH /api/v1/performance/periods/:id");
  const v = f.values as Values;
  const ends = editing ? (period?.ends_on ?? "") : quarterEnd(v.starts_on);

  const save = async () => {
    try {
      const saved = period
        ? await change.run({ params: { id: period.performance_period_id }, body: toBody(v) as Endpoints["PATCH /api/v1/performance/periods/:id"]["body"] })
        : await create.run({ body: toBody(v) as Endpoints["POST /api/v1/performance/periods"]["body"] });
      invalidate("/api/v1/performance/periods");
      close();
      toast(editing ? "Quarter saved" : `${saved.name} set up`);
      onSaved?.(saved);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length)
        f.setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k.startsWith("rules.") ? k.slice(6).replace(".", "/") : k, m])));
      else toast(e instanceof ApiError ? e.message : "Could not save");
    }
  };

  // Status moves forward only: planning, active, closed (an edit cannot go back).
  const statuses = editing ? STATUS : STATUS.slice(0, 2);
  const behind = editing ? STATUS.slice(0, STATUS.findIndex(([s]) => s === period?.status)).map(([s]) => s) : [];

  return (
    <Wizard
      finish={editing ? "Save Quarter" : "Set Up Quarter"}
      busy={create.pending || change.pending}
      onFinish={save}
      onCancel={close}
      steps={[
        {
          title: "Quarter",
          check: () => f.check(QUARTER_FIELDS),
          body: (
            <>
              <Field label="Name" optional={!editing} {...f.status("name")}>
                <TextField {...f.field("name")} placeholder={quarterName(v.starts_on) || "Q1 2027"} />
              </Field>
              <Field label="Starts" {...f.status("starts_on")}>
                {editing ? <TextField value={formatDate(v.starts_on)} onChange={() => undefined} disabled /> : <DateField {...f.field("starts_on")} />}
              </Field>
              <Field label="Ends">
                <TextField value={formatDate(ends)} onChange={() => undefined} disabled />
              </Field>
              <Field label="Lock Date" optional {...f.status("targets_lock_on")}>
                <DateField {...f.field("targets_lock_on")} min={v.starts_on || undefined} max={ends || undefined} />
              </Field>
              <Field label="Status" {...f.status("status")}>
                <ChoiceField label="Status" options={statuses} disabled={behind} value={v.status} onChange={(x) => f.field("status").onChange(x)} />
              </Field>
            </>
          ),
        },
        ...STEPS.map((step) => {
          const rules = RULES.filter((r) => r.step === step);
          return {
            title: step,
            check: () => f.check(rules.map(ruleField)),
            body: (
              <>
                {rules.map((r) => (
                  <Field key={ruleField(r)} label={r.label} {...f.status(ruleField(r))}>
                    <NumberField {...f.field(ruleField(r))} decimal={r.decimal} />
                  </Field>
                ))}
              </>
            ),
          };
        }),
      ]}
    />
  );
}
