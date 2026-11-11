/**
 * New Vacancy's interview (docs/guides/recruitment.md §3 step 2, §9, §10): ten questions, one card at
 * a time, in the person's own words, and the vacancy drafted from the answers.
 *
 * Eight questions are fixed: the role, its department and hiring manager, the openings and terms, how
 * they work, where (passed over for a remote role), the pay, the must-haves and key responsibilities,
 * and anything else. Then the AI asks two about this role from those answers (`vacancy-follow-ups`).
 * The count is for the whole interview from the first card: ten while the AI may answer, eight when it
 * is off; it shrinks if the AI asks fewer. Only the role is required: every other card can be skipped,
 * and each card's hint sits behind its help term. Draft Vacancy has the description written in MyCity's
 * job description shape (`jd-draft`), or plainly from the answers when the AI cannot (the server's
 * plain draft, never an error), and hands it to the editor to check and publish. Use Blank Form, on every
 * card, hands over what was answered without drafting. A seat (the Organogram's Create Vacancy) starts
 * with its title, department and hiring manager answered.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import vacancySchemas from "@mycity/contract/schemas/vacancies.js";
import type { FollowUpQuestion } from "@mycity/contract/contract.gen.ts";
import { useApi, useInfinite, useMutation } from "@/api/hooks";
import { HiringManagerPicker } from "@/features/shared/pickers";
import { lineOf, places } from "@/features/shared/places";
import { paging } from "@/features/shared/wire";
import {
  AddressField,
  Button,
  CheckboxField,
  ChoiceField,
  Field,
  Form,
  FormFooter,
  Grid,
  LoadingRows,
  MoneyField,
  NumberField,
  ProgressBar,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  toMoneyString,
  useContractForm,
  useUnsavedChanges,
} from "@mycity/ui";
import { bodySchema, EMPLOYMENT, PATTERNS } from "./shared";
import { RENAME, type Values } from "./VacancyForm";

/** The interview's answers: the editor's values and the words that are not a field of it. */
type Answers = Values & {
  must_haves: string;
  extras: string;
  follow_1: string;
  follow_2: string;
};
type Key = keyof Answers;

/** The fixed questions; the AI's follow-ups come after them. */
const FIXED = 8;
/** The card passed over when the role is remote. */
const WHERE = 4;

/** Whether an answer was given: a box left unticked is not one. */
const given = (x: unknown) => !(x === "" || x === null || x === undefined || x === false || (Array.isArray(x) && x.length === 0));

/** The fields an answer may set that VacancyEdit checks as it is filled; one left blank is not checked. */
const CHECKED: Key[] = [
  "department_id",
  "positions",
  "employment_type",
  "work_pattern",
  "work_pattern_note",
  "working_days",
  "reports_to",
  "min_experience_years",
  "salary_min",
  "salary_max",
];

/** The salary band, typed as a person types it ("350,000") and sent with two places ("350000.00"). */
const MONEY: Key[] = ["salary_min", "salary_max"];

/** The answers as the contract checks them: VacancyEdit, every field optional, only what was given (the title always). */
function checkedBody(v: Answers) {
  return {
    title: v.title,
    ...Object.fromEntries(CHECKED.filter((k) => given(v[k])).map((k) => [k, MONEY.includes(k) ? toMoneyString(String(v[k])) : v[k]])),
    salary_visible: v.salary_visible,
    ...(v.hiring_manager[0] ? { hiring_manager_id: v.hiring_manager[0].employee_id } : {}),
    ...(v.work_pattern !== "remote" && v.location ? { location: v.location } : {}),
  };
}

/** The role as the AI reads it. */
const roleOf = (v: Answers) => ({
  title: v.title,
  ...(v.department_id ? { department_id: v.department_id } : {}),
  employment_type: v.employment_type as "full_time",
  work_pattern: v.work_pattern as "on_site",
  ...(v.min_experience_years ? { min_experience_years: v.min_experience_years } : {}),
});

/** The answers that are not a field of the editor as they stand, and the follow-ups with theirs. */
const interviewOf = (v: Answers, asked: FollowUpQuestion[]) => ({
  positions: v.positions,
  work_pattern_note: v.work_pattern_note,
  working_days: v.working_days,
  area: v.work_pattern === "remote" ? "" : (lineOf(v.location) ?? ""),
  reports_to: v.reports_to,
  salary_min: toMoneyString(v.salary_min),
  salary_max: toMoneyString(v.salary_max),
  must_haves: v.must_haves,
  extras: v.extras,
  follow_ups: asked.map((q, i) => ({
    question: q.question,
    answer: i === 0 ? v.follow_1 : v.follow_2,
  })),
});

type Props = {
  /** The editor's first values (a seat's title, department and hiring manager already answered). */
  start: Values;
  close: () => void;
  /** The answers, and the draft when there is one, for the editor. */
  onDone: (values: Values) => void;
};

export function VacancyInterview({ start, close, onDone }: Props) {
  const status = useApi("GET /api/v1/recruitment/vacancies/assist");
  if (!status.data && !status.error) return <LoadingRows count={4} />;
  return <Interview start={start} close={close} onDone={onDone} ai={status.data?.available === true} />;
}

function Interview({ start, close, onDone, ai }: Props & { ai: boolean }) {
  const f = useContractForm<Answers>({ ...start, must_haves: "", extras: "", follow_1: "", follow_2: "" }, bodySchema<Answers>(vacancySchemas.VacancyEdit, checkedBody, RENAME));
  const departments = useInfinite("GET /api/v1/departments");
  const ask = useMutation("POST /api/v1/recruitment/vacancies/assist/follow-ups");
  const draft = useMutation("POST /api/v1/recruitment/vacancies/assist");
  const [at, setAt] = useState(0);
  /** The AI's questions: null until asked, none when it is off or asks none. */
  const [asked, setAsked] = useState<FollowUpQuestion[] | null>(ai ? null : []);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(at);
  // Answers live only here until the vacancy is saved, so leaving asks first.
  useUnsavedChanges(f.isDirty);
  useEffect(() => {
    if (shown.current === at) return;
    shown.current = at;
    heading.current?.focus();
  }, [at]);

  const v = f.values;
  const remote = v.work_pattern === "remote";
  const total = asked ? FIXED + asked.length : FIXED + 2;
  const last = asked !== null && at === FIXED + asked.length - 1;

  /** What the editor opens with: the answers in its fields, and the draft's texts when there are some. */
  const gathered = (texts?: { description: string | null; requirements: string | null; nice_to_have: string | null }): Values => {
    const { must_haves, extras, follow_1: _a, follow_2: _b, ...rest } = v;
    return {
      ...rest,
      location: remote ? null : rest.location,
      description: texts?.description ?? rest.description,
      requirements: texts?.requirements ?? (rest.requirements || must_haves),
      nice_to_have: texts?.nice_to_have ?? (rest.nice_to_have || extras),
    };
  };

  const write = async () => {
    try {
      const d = await draft.run({
        body: {
          ...roleOf(v),
          interview: interviewOf(v, asked ?? []),
          description: v.description,
          requirements: v.requirements,
          nice_to_have: v.nice_to_have,
        },
      });
      onDone(gathered(d));
    } catch {
      // The answers are not lost: the editor opens with them, and the description is written there.
      toast.error("Not drafted. Write the description here");
      onDone(gathered());
    }
  };

  const step = (to: number, by: 1 | -1) => setAt(remote && to === WHERE ? to + by : to);

  const next = async () => {
    const card = cards[at]!;
    const keys = card.keys.filter((k) => k === "title" || given(v[k]));
    if (!f.check(keys)) return;
    if (last) return write();
    // Leaving the last fixed card asks the AI for its two questions, from the answers so far.
    if (at === FIXED - 1 && asked === null) {
      const r = await ask.run({ body: { ...roleOf(v), interview: interviewOf(v, []) } }).catch(() => null);
      const questions = r?.questions ?? [];
      setAsked(questions);
      // None asked: this card becomes the last, and its button drafts.
      if (questions.length) setAt(FIXED);
      return;
    }
    step(at + 1, 1);
  };

  type Card = { question: string; keys: Key[]; body: ReactNode };
  const cards: Card[] = [
    {
      question: "What role are you hiring for?",
      keys: ["title"],
      body: (
        <Field label="Job Title" {...f.status("title")}>
          <TextField {...f.field("title")} placeholder="Head, Sales & Revenue" maxLength={120} />
        </Field>
      ),
    },
    {
      question: "Which department is it in, and who leads the hiring?",
      keys: ["department_id", "hiring_manager"],
      body: (
        <Grid cols={2}>
          <Field label="Department" {...f.status("department_id")}>
            <SelectField
              options={departments.rows.map((d) => [d.department_id, d.name] as [string, string])}
              placeholder="Pick a department"
              {...paging(departments)}
              {...f.field("department_id")}
            />
          </Field>
          <Field label="Hiring Manager" help="Needed before the role is published. They follow its candidates and decide after interviews." {...f.status("hiring_manager")}>
            <HiringManagerPicker value={v.hiring_manager} onChange={(p) => f.set("hiring_manager", p)} />
          </Field>
        </Grid>
      ),
    },
    {
      question: "How many people, and on what terms?",
      keys: ["positions", "employment_type"],
      body: (
        <Grid cols={2}>
          <Field label="Positions" {...f.status("positions")}>
            <NumberField {...f.field("positions")} />
          </Field>
          <Field label="Employment" {...f.status("employment_type")}>
            <ChoiceField options={EMPLOYMENT} {...f.field("employment_type")} />
          </Field>
        </Grid>
      ),
    },
    {
      question: "How will they work?",
      keys: ["work_pattern", "work_pattern_note", "working_days"],
      body: (
        <>
          <Field label="Arrangement" {...f.status("work_pattern")}>
            <ChoiceField options={PATTERNS} {...f.field("work_pattern")} />
          </Field>
          <Grid cols={2}>
            <Field label="Arrangement Note" help="Say which days are in the office, and the hours if they are fixed." optional {...f.status("work_pattern_note")}>
              <TextField {...f.field("work_pattern_note")} placeholder="Two office days" maxLength={80} />
            </Field>
            <Field label="Working Days" optional {...f.status("working_days")}>
              <TextField {...f.field("working_days")} placeholder="Monday to Saturday" maxLength={60} />
            </Field>
          </Grid>
        </>
      ),
    },
    {
      question: "Where is the role based?",
      keys: ["location"],
      body: (
        <Field label="Location" help="Pick the area. Needed before an on site or hybrid role is published." {...f.status("location")}>
          <AddressField {...f.field("location")} places={places} level="area" />
        </Field>
      ),
    },
    {
      question: "What will it pay each month?",
      keys: ["salary_min", "salary_max", "salary_visible"],
      body: (
        <>
          <Grid cols={2}>
            <Field label="Salary From" help="Leave the band empty if it is not settled yet." optional {...f.status("salary_min")}>
              <MoneyField {...f.field("salary_min")} />
            </Field>
            <Field label="Salary To" optional {...f.status("salary_max")}>
              <MoneyField {...f.field("salary_max")} />
            </Field>
          </Grid>
          <CheckboxField label="Show Salary on Careers" value={v.salary_visible} onChange={(on) => f.set("salary_visible", on)} />
        </>
      ),
    },
    {
      question: "What must they have, and what will they do?",
      keys: ["must_haves", "min_experience_years"],
      body: (
        <>
          <Field label="Your Answer" help="The three to five things that matter most: the skills and experience it needs, and its main responsibilities." optional>
            <TextAreaField {...f.field("must_haves")} rows={5} maxLength={4000} />
          </Field>
          <Field label="Years of Experience" optional {...f.status("min_experience_years")}>
            <NumberField {...f.field("min_experience_years")} />
          </Field>
        </>
      ),
    },
    {
      question: "Anything else candidates should know?",
      keys: ["reports_to", "extras"],
      body: (
        <>
          <Field label="Reports To" optional {...f.status("reports_to")}>
            <TextField {...f.field("reports_to")} placeholder="Chief Executive Officer" maxLength={120} />
          </Field>
          <Field label="Your Answer" help="What would set someone apart, the perks, and the team they join." optional>
            <TextAreaField {...f.field("extras")} rows={4} maxLength={4000} />
          </Field>
        </>
      ),
    },
    ...(asked ?? []).map((q, i): Card => ({
      question: q.question,
      keys: [i === 0 ? "follow_1" : "follow_2"],
      body: (
        <Field label="Your Answer" help={q.hint ?? undefined} optional>
          <TextAreaField {...f.field(i === 0 ? "follow_1" : "follow_2")} rows={5} maxLength={2000} />
        </Field>
      ),
    })),
  ];
  const card = cards[at]!;
  const answered = card.keys.some((k) => given(v[k]));
  const number = remote && at > WHERE ? at : at + 1;
  const count = remote ? total - 1 : total;

  return (
    <Form onSubmit={next}>
      <ProgressBar label={`Question ${number} of ${count}`} value={number} max={count} showValue={false} className="mb-4" />
      <h3 ref={heading} tabIndex={-1} className="mb-3 text-lg font-semibold outline-none">
        {card.question}
      </h3>
      <div key={at} className="animate-step-next">
        {card.body}
      </div>
      <FormFooter>
        <Button variant="ghost" onClick={() => onDone(gathered())}>
          Use Blank Form
        </Button>
        {at > 0 ? <Button onClick={() => step(at - 1, -1)}>Back</Button> : <Button onClick={close}>Cancel</Button>}
        <Button variant="primary" type="submit" icon={last ? "spark" : undefined}>
          {last ? "Draft Vacancy" : at === 0 || answered ? "Next" : "Skip"}
        </Button>
      </FormFooter>
    </Form>
  );
}
