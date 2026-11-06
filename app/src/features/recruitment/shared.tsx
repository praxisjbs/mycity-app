/**
 * What the Recruitment tabs share (docs/guides/recruitment.md §10): the words for a stage, a
 * status and a decision, the pills that show them, a refusal said in the form that sent it, and the
 * vacancies a select offers.
 */
import type {
  ApplicationStage,
  AssessmentType,
  InterviewDecision,
  InterviewType,
  SittingStatus,
  VacanciesEmploymentType,
  VacancyStatus,
} from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useInfinite } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import { HelpTerm, Pill, StatusPill, toast, type ContractSchema, type ServerFields, type StatusTone } from "@mycity/ui";

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  application: "Applied",
  screening: "Screening",
  assessment: "Assessment",
  interview: "Interview",
  shortlist: "Shortlist",
  offer: "Offer",
  documentation: "Documentation",
  pre_onboarding: "Pre-Onboarding",
  onboarding: "Onboarding",
  hired: "Hired",
};

export const VACANCY_STATUS: Record<VacancyStatus, [StatusTone, string]> = {
  draft: ["neutral", "Draft"],
  open: ["ok", "Open"],
  paused: ["warn", "Paused"],
  closed: ["neutral", "Closed"],
};

export const PATTERN_LABEL: Record<string, string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };
/** The arrangements a vacancy offers, as New Vacancy's interview and editor choose them. */
export const PATTERNS = Object.entries(PATTERN_LABEL) as Array<[string, string]>;

export const EMPLOYMENT: Array<[VacanciesEmploymentType, string]> = [
  ["full_time", "Full Time"],
  ["part_time", "Part Time"],
  ["contract", "Contract"],
  ["internship", "Internship"],
];

export const ASSESSMENT_TYPE: Record<AssessmentType, string> = {
  psychometric: "Psychometric",
  technical: "Technical",
  case_study: "Case Study",
  practical: "Practical",
};

export const SITTING_STATUS: Record<SittingStatus, [StatusTone, string]> = {
  sent: ["info", "Sent"],
  in_progress: ["warn", "In Progress"],
  submitted: ["warn", "To Mark"],
  timed_out: ["warn", "Time Up"],
  scored: ["ok", "Scored"],
  expired: ["neutral", "Expired"],
  cancelled: ["neutral", "Cancelled"],
};

export const DECISION: Record<InterviewDecision, [StatusTone, string]> = {
  select: ["ok", "Select"],
  on_hold: ["warn", "On Hold"],
  reject: ["err", "Reject"],
};
export const DECISIONS: Array<[InterviewDecision, string]> = [
  ["select", "Select"],
  ["on_hold", "On Hold"],
  ["reject", "Reject"],
];

export const INTERVIEW_TYPE: Record<InterviewType, string> = { in_person: "In Person", video: "Video", phone: "Phone" };

export const pill = ([tone, text]: [StatusTone, string]) => <StatusPill s={{ tone, text }} />;

const PROVISIONAL_HELP = "Worked out from the form only. Press Score With AI to read the CV.";
export const provisionalTerm = <HelpTerm help={PROVISIONAL_HELP}>Provisional</HelpTerm>;

/** A score as a list shows it: the figure, and Provisional while only the form was read. */
export function ScoreText({ score, provisional }: { score: number | null; provisional: boolean }) {
  if (score === null) return <span className="text-subtle-foreground">Not Scored</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <b className="tabular-nums">{Math.round(score)}</b>
      {provisional && <Pill tone="info">Provisional</Pill>}
    </span>
  );
}

/** A refusal with no field to sit on, said in a toast. */
/**
 * A refusal where no form shows field marks (a sheet's Publish or Resume): the first field's own words
 * ("Its closing day has passed"), never "Check the highlighted fields" with nothing highlighted.
 */
export const say = (e: unknown) => {
  if (!(e instanceof ApiError)) return toast.error("Not saved. Try again.");
  const first = Object.values(e.fields).find((m) => m && m.length);
  toast.error(first ? first[0] : e.message);
};

/**
 * A refused save, said in the form that sent it (FRONTEND_GUIDE §8.3): each mark on the field the
 * server named, and the server's sentence on the form's error line when it names no field of the form.
 */
export function sayRefusal(e: unknown, form: { values: object; setServerErrors: (fields: ServerFields) => void }, setProblem: (problem: string | null) => void) {
  if (!(e instanceof ApiError)) return setProblem("Not saved. Try again.");
  const keys = Object.keys(e.fields);
  if (keys.length) form.setServerErrors(e.fields);
  const onFields = keys.length > 0 && keys.every((k) => k in form.values);
  setProblem(onFields && e.status === 422 ? null : e.message);
}

/**
 * The contract's schema checked against the body a form's values make, its issues put on the form's
 * fields; `rename` names the form field a body key comes from (hiring_manager_id from hiring_manager).
 */
export function bodySchema<T>(schema: unknown, toBody: (values: T) => unknown, rename: Record<string, string> = {}): ContractSchema {
  const checker = schema as ContractSchema;
  return {
    safeParse(values: unknown) {
      const r = checker.safeParse(toBody(values as T));
      if (r.success) return r;
      return { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: [rename[String(i.path[0])] ?? String(i.path[0] ?? "")] })) } };
    },
  };
}

/** A refusal's fields under the form's own names (the inverse of bodySchema's `rename`). */
export const renamed = (fields: Record<string, string[]>, rename: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([k, m]) => [rename[k.split(".")[0]!] ?? k, m]));

/** Text a person typed, or null when they left it empty. */
export const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** The vacancies a select offers, 25 at a time as its menu nears its end; `status` narrows them. */
export function useVacancyOptions(status?: "open") {
  const list = useInfinite("GET /api/v1/recruitment/vacancies", status ? { filters: { status } } : undefined);
  return { options: list.rows.map((v) => [v.vacancy_id, `${v.title} · ${v.number}`] as [string, string]), ...paging(list) };
}
