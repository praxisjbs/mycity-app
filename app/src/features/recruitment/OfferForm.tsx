/**
 * New Offer and Edit Offer (docs/guides/offers.md §3 step 1, §6): a wizard, as the offer has more
 * than six fields. New Offer picks a shortlisted candidate and starts from `GET /offers/draft` (the
 * vacancy's terms); Edit changes a draft. Pay is monthly, line by line; the monthly total is shown
 * against the vacancy's range, and a reason is asked for only when it sits outside it. Additional
 * Terms and Schedule A (the final job description) are Markdown, printed after the standard wording.
 */
import { useEffect, useRef, useState } from "react";
import offerSchemas from "@mycity/contract/schemas/offers.js";
import type { OfferDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import {
  Button,
  ChoiceField,
  DateField,
  Field,
  formatMoney,
  Grid,
  IconButton,
  LoadingRows,
  MoneyField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  todayIso,
  toMoneyString,
  useContractForm,
  useUnsavedChanges,
  Wizard,
} from "@mycity/ui";
import { bodySchema, PATTERNS, renamed, sayRefusal } from "./shared";

const EMPLOYMENT: Array<[string, string]> = [
  ["full_time", "Full Time"],
  ["part_time", "Part Time"],
  ["contractor", "Contractor"],
  ["consultant", "Consultant"],
  ["intern", "Intern"],
];
const PAY_NAMES = ["Basic Salary", "Internet & Recharge Allowance", "Transportation Allowance"];

type Line = { name: string; monthly_amount: string };
type Values = {
  application_id: string;
  job_title: string;
  department_id: string;
  reports_to: string;
  role_function: string;
  role_scope: string;
  employment_type: string;
  work_pattern: string;
  office_days: string;
  pay_lines: Line[];
  range_reason: string;
  start_date: string;
  probation_months: string;
  annual_leave_days: string;
  working_hours: string;
  incentives: string;
  benefits: string;
  valid_days: string;
  additional_terms: string;
  job_description: string;
};

const STEPS: Array<Array<keyof Values>> = [
  ["application_id", "job_title", "department_id", "reports_to", "role_function", "role_scope", "employment_type", "work_pattern", "office_days"],
  ["pay_lines", "range_reason"],
  ["start_date", "probation_months", "annual_leave_days", "working_hours", "incentives", "benefits", "valid_days"],
  ["additional_terms", "job_description"],
];

const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
/* Money in kobo for the total on the form, never in floating point; the server decides. */
const kobo = (v: string) => {
  const m = toMoneyString(v);
  return /^\d+\.\d{2}$/.test(m) ? Math.round(Number(m) * 100) : 0;
};
const naira = (k: number) => (k / 100).toFixed(2);

/** The body the API takes: a field left empty is not sent, so a draft keeps it and New Offer leaves it out. */
function bodyOf(v: Values, create: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "application_id" && !create) continue;
    if (k === "pay_lines") out.pay_lines = (x as Line[]).map((l) => ({ name: l.name.trim(), monthly_amount: toMoneyString(l.monthly_amount) }));
    else if (k === "office_days" && v.work_pattern !== "hybrid") continue;
    else if (typeof x === "string" && x.trim() !== "") out[k] = x.trim();
  }
  if (create) out.application_id = v.application_id;
  return out;
}

/** A refused pay line (pay_lines.0.monthly_amount) is marked on the lines as a whole. */
const RENAME: Record<string, string> = { pay_lines: "pay_lines" };

export function OfferForm({ offer, applicationId, close, onSaved }: { offer?: OfferDetail; applicationId?: string; close: () => void; onSaved?: (o: OfferDetail) => void }) {
  const create = !offer;
  const start: Values = {
    application_id: offer?.application_id ?? applicationId ?? "",
    job_title: offer?.job_title ?? "",
    department_id: offer?.department_id ?? "",
    reports_to: text(offer?.reports_to),
    role_function: text(offer?.role_function),
    role_scope: text(offer?.role_scope),
    employment_type: text(offer?.employment_type),
    work_pattern: text(offer?.work_pattern),
    office_days: text(offer?.office_days),
    pay_lines: offer?.pay_lines.map((l) => ({ name: l.name, monthly_amount: l.monthly_amount })) ?? [],
    range_reason: text(offer?.range_reason),
    start_date: text(offer?.start_date),
    probation_months: text(offer?.probation_months),
    annual_leave_days: text(offer?.annual_leave_days),
    working_hours: text(offer?.working_hours),
    incentives: text(offer?.incentives),
    benefits: text(offer?.benefits),
    valid_days: offer ? String(offer.valid_days) : String(offerSchemas.OFFER_VALID_DAYS.default),
    additional_terms: text(offer?.additional_terms),
    job_description: text(offer?.job_description),
  };
  const schema = create ? offerSchemas.OfferCreate : offerSchemas.OfferEdit;
  const f = useContractForm<Values>(start, bodySchema<Values>(schema, (v) => bodyOf(v, create), RENAME));
  useUnsavedChanges(f.isDirty);
  const shortlist = useInfinite("GET /api/v1/recruitment/candidates", { filters: { stage: "shortlist", status: "active" } });
  const departments = useInfinite("GET /api/v1/departments");
  const draft = useApi("GET /api/v1/recruitment/offers/draft", { query: { application_id: f.values.application_id }, enabled: create && Boolean(f.values.application_id) });
  const save = useMutation("POST /api/v1/recruitment/offers");
  const patch = useMutation("PATCH /api/v1/recruitment/offers/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const [stepAt, setStepAt] = useState(0);

  // A candidate picked fills the form from their vacancy, once for each pick.
  const filled = useRef<string | null>(null);
  useEffect(() => {
    const d = draft.data;
    if (!d || filled.current === d.application_id) return;
    filled.current = d.application_id;
    f.setValues((v) => ({
      ...v,
      job_title: d.job_title,
      department_id: d.department_id ?? "",
      reports_to: text(d.reports_to),
      employment_type: text(d.employment_type),
      work_pattern: text(d.work_pattern),
      probation_months: text(d.probation_months),
      start_date: d.start_date && d.start_date >= todayIso() ? d.start_date : v.start_date,
      job_description: text(d.job_description),
      pay_lines: d.pay_lines.length ? d.pay_lines.map((l) => ({ ...l })) : [{ name: "Basic Salary", monthly_amount: "" }],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.data]);

  const min = create ? (draft.data?.salary_min ?? null) : offer.salary_min;
  const max = create ? (draft.data?.salary_max ?? null) : offer.salary_max;
  const total = f.values.pay_lines.reduce((n, l) => n + kobo(l.monthly_amount), 0);
  const outside = total > 0 && ((min !== null && total < kobo(min)) || (max !== null && total > kobo(max)));
  const lines = f.values.pay_lines;
  const setLines = (next: Line[]) => f.set("pay_lines", next);

  const payCheck = () => {
    const clean = f.check(STEPS[1]);
    if (!clean) return false;
    if (outside && !f.values.range_reason.trim()) {
      f.setServerErrors({ range_reason: ["Say why"] });
      return false;
    }
    return true;
  };

  const finish = async () => {
    setProblem(null);
    if (!f.check()) return;
    const body = bodyOf(f.values, create) as never;
    try {
      const saved = offer ? await patch.run({ params: { id: offer.offer_id }, body }) : await save.run({ body });
      invalidate("/api/v1/recruitment/offers");
      close();
      toast(offer ? `${saved.number} saved` : `${saved.number} drafted`);
      onSaved?.(saved);
    } catch (e) {
      const fields = e instanceof ApiError ? renamed(e.fields, RENAME) : {};
      sayRefusal(e instanceof ApiError ? Object.assign(e, { fields }) : e, f, setProblem);
      // A refusal on an earlier step takes the person back to it.
      const at = STEPS.findIndex((keys) => keys.some((k) => k in fields));
      if (at >= 0) setStepAt(at);
    }
  };

  const loading = create && Boolean(f.values.application_id) && !draft.data && !draft.error;
  return (
    <Wizard
      step={stepAt}
      onStepChange={setStepAt}
      finish={offer ? "Save Offer" : "Draft Offer"}
      onFinish={finish}
      onCancel={close}
      error={problem ?? (draft.error ? draft.error.message : null)}
      steps={[
        {
          title: "Candidate and Role",
          check: () => f.check(STEPS[0]),
          body: (
            <>
              {create && (
                <Field label="Candidate" {...f.status("application_id")}>
                  <SelectField
                    searchable
                    placeholder="Pick a candidate"
                    options={shortlist.rows.map((c) => [c.application_id, `${c.name} · ${c.vacancy.title}`] as [string, string])}
                    {...paging(shortlist)}
                    {...f.field("application_id")}
                  />
                </Field>
              )}
              {loading ? (
                <LoadingRows count={4} />
              ) : (
                <>
                  <Grid cols={2}>
                    <Field label="Job Title" {...f.status("job_title")}>
                      <TextField {...f.field("job_title")} maxLength={160} />
                    </Field>
                    <Field label="Department" {...f.status("department_id")}>
                      <SelectField options={departments.rows.map((d) => [d.department_id, d.name] as [string, string])} placeholder="Pick a department" {...paging(departments)} {...f.field("department_id")} />
                    </Field>
                    <Field label="Reports To" optional {...f.status("reports_to")}>
                      <TextField {...f.field("reports_to")} placeholder="Chief Executive Officer" maxLength={160} />
                    </Field>
                    <Field label="Employment Type" optional {...f.status("employment_type")}>
                      <SelectField options={EMPLOYMENT} placeholder="Pick a type" {...f.field("employment_type")} />
                    </Field>
                    <Field label="Function" optional {...f.status("role_function")}>
                      <TextField {...f.field("role_function")} placeholder="Commercial leadership" maxLength={300} />
                    </Field>
                    <Field label="Scope" optional {...f.status("role_scope")}>
                      <TextField {...f.field("role_scope")} placeholder="Lagos and Abuja" maxLength={300} />
                    </Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Work Pattern" optional {...f.status("work_pattern")}>
                      <ChoiceField options={PATTERNS} {...f.field("work_pattern")} />
                    </Field>
                    {f.values.work_pattern === "hybrid" && (
                      <Field label="Office Days" optional {...f.status("office_days")}>
                        <NumberField {...f.field("office_days")} />
                      </Field>
                    )}
                  </Grid>
                </>
              )}
            </>
          ),
        },
        {
          title: "Monthly Pay",
          check: payCheck,
          body: (
            <>
              <Field label="Pay Lines" {...f.status("pay_lines")}>
                <div className="flex flex-col gap-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-6 items-end gap-2 max-md:grid-cols-2">
                      <span className="col-span-3 max-md:col-span-2">
                        <Field label={`Line ${i + 1}`}>
                          <TextField name={`line-${i}-name`} value={l.name} onChange={(v) => setLines(lines.map((x, k) => (k === i ? { ...x, name: v } : x)))} placeholder={PAY_NAMES[i] ?? "Other Allowance"} maxLength={80} />
                        </Field>
                      </span>
                      <span className="col-span-2 max-md:col-span-1">
                        <Field label="Monthly Amount">
                          <MoneyField name={`line-${i}-amount`} value={l.monthly_amount} onChange={(v) => setLines(lines.map((x, k) => (k === i ? { ...x, monthly_amount: v } : x)))} />
                        </Field>
                      </span>
                      {lines.length > 1 && (
                        <span className="flex min-h-tap items-center">
                          <IconButton icon="trash" label={`Remove Line ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Field>
              {lines.length < 12 && (
                <Button size="sm" icon="plus" onClick={() => setLines([...lines, { name: PAY_NAMES.find((p) => !lines.some((l) => l.name === p)) ?? "", monthly_amount: "" }])}>
                  Add Pay Line
                </Button>
              )}
              <dl className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
                <dt className="text-sm text-subtle-foreground">Monthly Total</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(naira(total))}</dd>
              </dl>
              {(min || max) && (
                <p className="text-xs text-subtle-foreground">
                  Vacancy range {min ? formatMoney(min) : "Any"} to {max ? formatMoney(max) : "Any"}
                </p>
              )}
              {outside && (
                <Field label="Why Outside the Range" {...f.status("range_reason")}>
                  <TextAreaField {...f.field("range_reason")} rows={3} />
                </Field>
              )}
            </>
          ),
        },
        {
          title: "Terms",
          check: () => f.check(STEPS[2]),
          body: (
            <>
              <Grid cols={2}>
                <Field label="Start Date" {...f.status("start_date")}>
                  <DateField {...f.field("start_date")} min={todayIso()} />
                </Field>
                <Field label="Days to Sign" optional {...f.status("valid_days")}>
                  <NumberField {...f.field("valid_days")} />
                </Field>
                <Field label="Probation Months" optional {...f.status("probation_months")}>
                  <NumberField {...f.field("probation_months")} />
                </Field>
                <Field label="Annual Leave Days" optional {...f.status("annual_leave_days")}>
                  <NumberField {...f.field("annual_leave_days")} />
                </Field>
              </Grid>
              <Field label="Working Hours" optional {...f.status("working_hours")}>
                <TextField {...f.field("working_hours")} placeholder="09:00 to 17:00" maxLength={160} />
              </Field>
              <Field label="Incentives" optional {...f.status("incentives")}>
                <TextAreaField {...f.field("incentives")} rows={2} />
              </Field>
              <Field label="Benefits" optional {...f.status("benefits")}>
                <TextAreaField {...f.field("benefits")} rows={2} />
              </Field>
            </>
          ),
        },
        {
          title: "Letter",
          check: () => f.check(STEPS[3]),
          body: (
            <>
              <Field label="Additional Terms" help="Terms for this offer alone, after the standard wording. Markdown." optional {...f.status("additional_terms")}>
                <TextAreaField {...f.field("additional_terms")} rows={5} />
              </Field>
              <Field label="Schedule A" help="The final job description, printed as Schedule A. Markdown, copied from the vacancy." optional {...f.status("job_description")}>
                <TextAreaField {...f.field("job_description")} rows={10} />
              </Field>
            </>
          ),
        },
      ]}
    />
  );
}
