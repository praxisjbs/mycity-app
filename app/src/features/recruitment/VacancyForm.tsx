/**
 * New Vacancy and Edit Vacancy (docs/guides/recruitment.md §6.1, §9): a wizard of three steps, Role,
 * Details (where, when and what the role is) and Pay and Publish. The contract's VacancyCreate (or VacancyEdit) checks each
 * field as it is filled. The location is picked, never typed (F27), and a remote role has none. Write
 * With AI drafts the description from a line about the role; nothing is kept until the person saves.
 * A seat from Suggested From Organogram fills the title, the department and who it reports to, and
 * the vacancy keeps the seat (`org_seat_id`), so the seat leaves the suggestions once it has one.
 */
import { useState } from "react";
import vacancySchemas from "@mycity/contract/schemas/vacancies.js";
import type { SeatSuggestion, VacancyDetail } from "@mycity/contract/contract.gen.ts";
import type { PersonRef } from "@/api/types/common";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { EmployeePicker } from "@/features/shared/pickers";
import { places, placeValue } from "@/features/shared/places";
import { paging } from "@/features/shared/wire";
import { useAddressPrefill, type PrefillSchema } from "@/shell/screen-action";
import {
  AddressField,
  Button,
  CheckboxField,
  DateField,
  Field,
  Grid,
  MoneyField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useUnsavedChanges,
  Wizard,
  type PlaceValue,
} from "@mycity/ui";
import { bodySchema, EMPLOYMENT, orNull, say, sayRefusal } from "./shared";

type Values = {
  title: string;
  department_id: string;
  hiring_manager: PersonRef[];
  positions: string;
  employment_type: string;
  reports_to: string;
  work_pattern: string;
  work_pattern_note: string;
  location: PlaceValue | null;
  working_days: string;
  closes_on: string;
  target_start_on: string;
  probation_months: string;
  description: string;
  requirements: string;
  nice_to_have: string;
  min_experience_years: string;
  salary_min: string;
  salary_max: string;
  salary_visible: boolean;
  publish: boolean;
};

const PATTERNS: Array<[string, string]> = [
  ["on_site", "On Site"],
  ["hybrid", "Hybrid"],
  ["remote", "Remote"],
];

const inDays = (n: number) => todayIso(new Date(Date.now() + n * 86400000));
const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** What an edit compares against: a field left as it was is not sent again. */
type Before = { location: PlaceValue | null; closes_on: string };

/**
 * The body the API takes from the form's values. On an edit, the location and the closing date only
 * when changed: an open role past its date may still have its words fixed (the API refuses a past
 * date only when one is sent). On a create from a seat, the seat.
 */
function bodyOf(v: Values, edit: Before | null, seatId: string | null) {
  const remote = v.work_pattern === "remote";
  const moved = !edit || JSON.stringify(edit.location) !== JSON.stringify(v.location);
  const { hiring_manager, location, publish, closes_on, ...rest } = v;
  return {
    ...rest,
    hiring_manager_id: hiring_manager[0]?.employee_id ?? "",
    ...(!remote && location && moved ? { location } : {}),
    ...(!edit || closes_on !== edit.closes_on ? { closes_on } : {}),
    ...(edit ? {} : { publish, ...(seatId ? { org_seat_id: seatId } : {}) }),
  };
}

/** The API names the hiring manager by its id; the form holds the person. */
const RENAME = { hiring_manager_id: "hiring_manager" };

/** The contract's own fields, unwrapped from its refinements, for the address's prefill. */
const shapeOf = (schema: unknown): PrefillSchema => {
  let s = schema as { shape?: unknown; _def?: { schema?: unknown } };
  while (s && !s.shape && s._def?.schema) s = s._def.schema as typeof s;
  return s as PrefillSchema;
};

export function VacancyForm({ vacancy, seat, close, onSaved }: { vacancy?: VacancyDetail; seat?: SeatSuggestion; close: () => void; onSaved?: (v: VacancyDetail) => void }) {
  const edit: Before | null = vacancy ? { location: placeValue(vacancy.location_place), closes_on: vacancy.closes_at?.slice(0, 10) ?? "" } : null;
  const filled = useAddressPrefill(shapeOf(vacancySchemas.VacancyCreate), !vacancy);
  // A seat comes from Suggested From Organogram (the row) or from the Organogram's Create Vacancy (the address).
  const seatId = vacancy ? null : (seat?.org_seat_id ?? filled.org_seat_id ?? null);
  const blank: Values = vacancy
    ? {
        title: vacancy.title,
        department_id: vacancy.department_id ?? "",
        hiring_manager: vacancy.hiring_manager ? [vacancy.hiring_manager] : [],
        positions: String(vacancy.positions),
        employment_type: vacancy.employment_type ?? "full_time",
        reports_to: vacancy.reports_to ?? "",
        work_pattern: vacancy.work_pattern ?? "on_site",
        work_pattern_note: vacancy.work_pattern_note ?? "",
        location: edit!.location,
        working_days: vacancy.working_days ?? "",
        closes_on: vacancy.closes_at?.slice(0, 10) ?? inDays(30),
        target_start_on: vacancy.target_start_on ?? "",
        probation_months: text(vacancy.probation_months),
        description: vacancy.description,
        requirements: vacancy.requirements ?? "",
        nice_to_have: vacancy.nice_to_have ?? "",
        min_experience_years: text(vacancy.min_experience_years),
        salary_min: vacancy.salary_min ?? "",
        salary_max: vacancy.salary_max ?? "",
        salary_visible: vacancy.salary_visible,
        publish: false,
      }
    : {
        title: seat?.title ?? filled.title ?? "",
        department_id: seat?.department_id ?? filled.department_id ?? "",
        hiring_manager: [],
        positions: filled.positions ?? "1",
        employment_type: filled.employment_type ?? "full_time",
        reports_to: seat?.reports_to ?? "",
        work_pattern: filled.work_pattern ?? "on_site",
        work_pattern_note: filled.work_pattern_note ?? "",
        location: null,
        working_days: filled.working_days ?? "Monday to Friday",
        closes_on: filled.closes_on ?? inDays(30),
        target_start_on: "",
        probation_months: "6",
        description: filled.description ?? "",
        requirements: filled.requirements ?? "",
        nice_to_have: filled.nice_to_have ?? "",
        min_experience_years: filled.min_experience_years ?? "",
        salary_min: "",
        salary_max: "",
        salary_visible: false,
        publish: true,
      };
  const schema = vacancy ? vacancySchemas.VacancyEdit : vacancySchemas.VacancyCreate;
  const f = useContractForm<Values>(
    blank,
    bodySchema<Values>(schema, (v) => bodyOf(v, edit, seatId), RENAME),
  );
  // Closing a half-written vacancy asks before it is lost.
  useUnsavedChanges(f.isDirty);
  const departments = useInfinite("GET /api/v1/departments");
  const create = useMutation("POST /api/v1/recruitment/vacancies");
  const patch = useMutation("PATCH /api/v1/recruitment/vacancies/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const [stepAt, setStepAt] = useState(0);
  const remote = f.values.work_pattern === "remote";

  const finish = async () => {
    setProblem(null);
    if (!f.check()) return;
    const body = bodyOf(f.values, edit, seatId);
    try {
      const saved = vacancy
        ? await patch.run({ params: { id: vacancy.vacancy_id }, body: body as never })
        : await create.run({ body: body as never });
      invalidate("/api/v1/recruitment/vacancies");
      close();
      toast(vacancy ? `${saved.number} saved` : saved.status === "open" ? `${saved.number} published` : `${saved.number} saved as a draft`);
      onSaved?.(saved);
    } catch (e) {
      // The API names the hiring manager by its id; the form holds the person.
      const fields = e instanceof ApiError ? Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k === "hiring_manager_id" ? "hiring_manager" : k, m])) : {};
      sayRefusal(e instanceof ApiError ? Object.assign(e, { fields }) : e, f, setProblem);
      // A refusal on an earlier step takes the person back to it.
      const at = STEPS.findIndex((keys) => keys.some((k) => k in fields));
      if (at >= 0) setStepAt(at);
    }
  };

  const STEPS: Array<Array<keyof Values>> = [
    ["title", "department_id", "hiring_manager", "positions", "employment_type", "reports_to"],
    ["work_pattern", "work_pattern_note", "location", "working_days", "closes_on", "target_start_on", "probation_months", "description", "requirements", "nice_to_have"],
    ["min_experience_years", "salary_min", "salary_max", "salary_visible"],
  ];

  return (
    <Wizard
      step={stepAt}
      onStepChange={setStepAt}
      finish={vacancy ? "Save Vacancy" : f.values.publish ? "Publish Vacancy" : "Save Draft"}
      onFinish={finish}
      onCancel={close}
      error={problem}
      steps={[
        {
          title: "Role",
          check: () => f.check(STEPS[0]),
          body: (
            <>
              <Field label="Job Title" {...f.status("title")}>
                <TextField {...f.field("title")} placeholder="Head, Sales & Revenue" maxLength={120} />
              </Field>
              <Grid cols={2}>
                <Field label="Department" {...f.status("department_id")}>
                  <SelectField options={departments.rows.map((d) => [d.department_id, d.name] as [string, string])} placeholder="Pick a department" {...paging(departments)} {...f.field("department_id")} />
                </Field>
                <Field label="Hiring Manager" {...f.status("hiring_manager")}>
                  <EmployeePicker value={f.values.hiring_manager} onChange={(p) => f.set("hiring_manager", p)} filters={{ status: "active" }} />
                </Field>
              </Grid>
              <Grid cols={3}>
                <Field label="Positions" {...f.status("positions")}>
                  <NumberField {...f.field("positions")} />
                </Field>
                <Field label="Employment" {...f.status("employment_type")}>
                  <SelectField options={EMPLOYMENT} {...f.field("employment_type")} />
                </Field>
                <Field label="Reports To" optional {...f.status("reports_to")}>
                  <TextField {...f.field("reports_to")} placeholder="Chief Executive Officer" />
                </Field>
              </Grid>
            </>
          ),
        },
        {
          title: "Details",
          check: () => f.check(STEPS[1]),
          body: (
            <>
              <Grid cols={2}>
                <Field label="Arrangement" {...f.status("work_pattern")}>
                  <SelectField options={PATTERNS} {...f.field("work_pattern")} />
                </Field>
                <Field label="Arrangement Note" optional {...f.status("work_pattern_note")}>
                  <TextField {...f.field("work_pattern_note")} placeholder="Two office days" maxLength={80} />
                </Field>
              </Grid>
              {!remote && (
                <Field label="Location" {...f.status("location")}>
                  <AddressField {...f.field("location")} places={places} level="area" />
                </Field>
              )}
              <Grid cols={2}>
                <Field label="Working Days" optional {...f.status("working_days")}>
                  <TextField {...f.field("working_days")} placeholder="Monday to Saturday" maxLength={60} />
                </Field>
                <Field label="Probation Months" optional {...f.status("probation_months")}>
                  <NumberField {...f.field("probation_months")} />
                </Field>
                <Field label="Closes On" {...f.status("closes_on")}>
                  <DateField {...f.field("closes_on")} min={todayIso()} />
                </Field>
                <Field label="Target Start" optional {...f.status("target_start_on")}>
                  <DateField {...f.field("target_start_on")} min={todayIso()} />
                </Field>
              </Grid>
              <WriteWithAi values={f.values} onDraft={(d) => f.setValues((v) => ({ ...v, ...d }))} />
              <Field label="Description" {...f.status("description")}>
                <TextAreaField {...f.field("description")} rows={8} />
              </Field>
              <Field label="Required Experience and Qualifications" {...f.status("requirements")}>
                <TextAreaField {...f.field("requirements")} rows={4} />
              </Field>
              <Field label="What We Look For" help="The careers page heads it What We Are Looking For, as MyCity's job description does." optional {...f.status("nice_to_have")}>
                <TextAreaField {...f.field("nice_to_have")} rows={3} />
              </Field>
            </>
          ),
        },
        {
          title: "Pay and Publish",
          check: () => f.check(STEPS[2]),
          body: (
            <>
              <Field label="Years of Experience" optional {...f.status("min_experience_years")}>
                <NumberField {...f.field("min_experience_years")} />
              </Field>
              <Grid cols={2}>
                <Field label="Salary From" optional {...f.status("salary_min")}>
                  <MoneyField {...f.field("salary_min")} />
                </Field>
                <Field label="Salary To" optional {...f.status("salary_max")}>
                  <MoneyField {...f.field("salary_max")} />
                </Field>
              </Grid>
              <CheckboxField label="Show Salary on Careers" value={f.values.salary_visible} onChange={(on) => f.set("salary_visible", on)} />
              {!vacancy && <CheckboxField label="Publish Now" value={f.values.publish} onChange={(on) => f.set("publish", on)} />}
            </>
          ),
        },
      ]}
    />
  );
}

/** Write With AI: a line about the role in, a draft of the three texts out. Shown only while the AI may answer. */
function WriteWithAi({ values, onDraft }: { values: Values; onDraft: (d: Pick<Values, "description" | "requirements" | "nice_to_have">) => void }) {
  const status = useApi("GET /api/v1/recruitment/vacancies/assist");
  const draft = useMutation("POST /api/v1/recruitment/vacancies/assist");
  const [line, setLine] = useState("");
  if (!status.data?.available) return null;
  const write = async () => {
    if (line.trim().length < 10 || values.title.trim().length < 3) return toast.error("Name the role and say what it does");
    try {
      const d = await draft.run({
        body: {
          title: values.title,
          instruction: line,
          ...(values.department_id ? { department_id: values.department_id } : {}),
          ...(values.min_experience_years ? { min_experience_years: values.min_experience_years } : {}),
          description: values.description,
          requirements: values.requirements,
          nice_to_have: values.nice_to_have,
        } as never,
      });
      if (!d.available) return toast.error("Write With AI is not available now");
      onDraft({ description: d.description ?? values.description, requirements: d.requirements ?? values.requirements, nice_to_have: d.nice_to_have ?? orNull(values.nice_to_have) ?? "" });
      toast("Draft written. Read it before saving");
    } catch (e) {
      say(e);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <Field label="About the Role" optional className="min-w-0 flex-1">
        <TextField value={line} onChange={setLine} placeholder="Leads sales team" maxLength={2000} />
      </Field>
      <Button icon="spark" onClick={write}>Write With AI</Button>
    </div>
  );
}
