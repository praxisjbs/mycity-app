import { useRef, useState, type ReactNode } from "react";
import type { ApplicationReceipt, ApplicationSubmit, ApplyLink, ApplyQuestion } from "@mycity/contract/contract.gen.ts";
import candidates from "@mycity/contract/schemas/candidates.js";
import {
  Button,
  CheckboxField,
  ChoiceField,
  Confetti,
  Field,
  FileCard,
  formatDate,
  formatTime,
  Icon,
  PageMessage,
  NumberField,
  PhoneField,
  RadioCards,
  SelectField,
  Skeleton,
  SkylineHero,
  StepBar,
  TextAreaField,
  TextField,
  UploadField,
  useContractForm,
  Wizard,
  type ContractSchema,
} from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import type { DocumentRef } from "@/api/types/common";
import { upload } from "@/api/upload";
import { useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";
import { LinkProblem } from "./LinkProblem";

/** The form's values: the contract's fields as typed, and each of the vacancy's questions as `q_<id>`. */
type Values = Record<string, string | boolean>;

const qKey = (id: string) => `q_${id}`;
const ABOUT_YOU = ["full_name", "email", "phone", "years_experience"];
const WHY = ["cover_letter", "consent"];
/** The three steps, named once for the wizard and the pane beside it. */
const STEPS = ["About You", "CV and Questions", "Why This Role"] as const;
const EYEBROW = "Your Application";

/** The form as the API takes it: years as a number, the answers given keyed by question. */
function bodyOf(v: Values, questions: ApplyQuestion[]) {
  const years = String(v.years_experience ?? "");
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = String(v[qKey(q.vacancy_question_id)] ?? "").trim();
    if (a) answers[q.vacancy_question_id] = a;
  }
  return {
    full_name: String(v.full_name ?? ""),
    email: String(v.email ?? ""),
    phone: String(v.phone ?? ""),
    years_experience: years === "" ? undefined : Number(years),
    cv_document_id: String(v.cv_document_id ?? ""),
    cover_letter: String(v.cover_letter ?? ""),
    answers,
    consent: v.consent === true,
  };
}

/**
 * The contract's ApplicationSubmit over the form: an answer's mark lands on its question, and a
 * required question left empty is marked as the server would mark it (candidates.apply.js).
 */
function applySchema(questions: ApplyQuestion[]): ContractSchema {
  return {
    safeParse: (value: unknown) => {
      const v = value as Values;
      const r = candidates.ApplicationSubmit.safeParse(bodyOf(v, questions));
      const issues = (r.success ? [] : r.error.issues).map((i: { path: PropertyKey[]; message: string; code?: string }) => {
        if (i.path[0] === "answers") return { ...i, path: [qKey(String(i.path[1]))] };
        if (i.path[0] === "cv_document_id" && !v.cv_document_id) return { ...i, code: "custom", message: "Attach your CV" };
        return i;
      });
      for (const q of questions)
        if (q.required && !String(v[qKey(q.vacancy_question_id)] ?? "").trim()) issues.push({ path: [qKey(q.vacancy_question_id)], message: "Answer this question", code: "custom" });
      return issues.length ? { success: false, error: { issues } } : r;
    },
  };
}

/**
 * Apply (#82): reached by a one-time token, from Apply for This Role or an invitation. Write only:
 * the candidate sends an application and never reads one back, so there is no score and no stage.
 * Three steps (About You; CV and Questions; Why This Role), then the receipt with the reference.
 */
export function Apply({ token }: { token: string }) {
  const link = useApi("GET /api/public/v1/apply/:token", { params: { token } });
  const [receipt, setReceipt] = useState<{ title: string; receipt: ApplicationReceipt } | null>(null);
  if (receipt) return <Receipt title={receipt.title} receipt={receipt.receipt} />;
  if (link.error) return <LinkProblem error={link.error} title="Apply" retry={link.reload} />;
  if (!link.data)
    return (
      <Page title="Apply" pane={<SkylineHero size="pane" eyebrow={EYEBROW} title="Apply" />}>
        <Skeleton lines={7} />
      </Page>
    );
  const data = link.data;
  return <ApplyForm token={token} link={data} onSent={(r) => setReceipt({ title: data.vacancy_title, receipt: r })} onGone={link.reload} />;
}

function ApplyForm({ token, link, onSent, onGone }: { token: string; link: ApplyLink; onSent: (r: ApplicationReceipt) => void; onGone: () => unknown }) {
  const questions = link.questions;
  const [schema] = useState(() => applySchema(questions));
  const initial: Values = { full_name: "", email: "", phone: "", years_experience: "", cv_document_id: "", cover_letter: "", consent: false };
  for (const q of questions) initial[qKey(q.vacancy_question_id)] = "";
  const f = useContractForm<Values>(initial, schema);
  const [step, setStep] = useState(0);
  const [cv, setCv] = useState<DocumentRef | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const qKeys = questions.map((q) => qKey(q.vacancy_question_id));
  const stepOf = (key: string) => (ABOUT_YOU.includes(key) ? 0 : WHY.includes(key) ? 2 : 1);

  const text = (k: string) => {
    const b = f.field(k);
    return { ...b, value: String(b.value ?? ""), onChange: (v: string) => f.set(k, v) };
  };
  const send = async (body: ApplicationSubmit) => {
    setError(null);
    try {
      onSent(await api.call("POST /api/public/v1/apply/:token", { params: { token }, body }));
    } catch (e) {
      if (!(e instanceof ApiError)) return setError("The application did not send. Try again.");
      /* The link lapsed while the form was open: the page reads it again and says so. */
      if (e.status === 404) return onGone();
      const fields = Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k.startsWith("answers.") ? qKey(k.slice(8)) : k, m]));
      const keys = Object.keys(fields);
      if (!keys.length) return setError(e.message);
      f.setServerErrors(fields);
      setStep(Math.min(...keys.map(stepOf)));
    }
  };

  return (
    <Page
      title="Apply"
      pane={
        <SkylineHero
          size="pane"
          record
          eyebrow={EYEBROW}
          title={link.vacancy_title}
          text={`This link is yours until ${formatDate(link.expires_at)}, ${formatTime(link.expires_at)}.`}
          wide={<StepBar steps={STEPS} at={step} vertical decorative />}
        />
      }
    >
      <Wizard
        level={2}
        step={step}
        onStepChange={setStep}
        finish="Submit Application"
        error={error}
        onFinish={f.submit((body) => send(body as unknown as ApplicationSubmit))}
        steps={[
          {
            title: STEPS[0],
            check: () => f.check(ABOUT_YOU),
            body: (
              <div className="flex flex-col gap-4">
                <Field label="Full Name" {...f.status("full_name")}>
                  <TextField autoComplete="name" {...text("full_name")} />
                </Field>
                <Field label="Email" {...f.status("email")}>
                  <TextField type="email" autoComplete="email" inputMode="email" placeholder="ada@example.com" {...text("email")} />
                </Field>
                <Field label="Phone" {...f.status("phone")}>
                  <PhoneField autoComplete="tel" placeholder="802 000 0000" {...text("phone")} />
                </Field>
                <Field label="Years of Experience" {...f.status("years_experience")}>
                  <NumberField maxLength={2} className="max-w-28" {...text("years_experience")} />
                </Field>
              </div>
            ),
          },
          {
            title: STEPS[1],
            check: () => f.check(["cv_document_id", ...qKeys]),
            body: (
              <div className="flex flex-col gap-5">
                <Field label="Your CV" {...f.status("cv_document_id")}>
                  {cv ? (
                    <div className="flex flex-col gap-2">
                      <FileCard name={cv.file_name} mime={cv.mime_type} sizeBytes={cv.size_bytes} tone="plain" />
                      <div>
                        <Button
                          size="sm"
                          onClick={() => {
                            setCv(null);
                            f.set("cv_document_id", "");
                          }}
                        >
                          Replace CV
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <UploadCv
                      token={token}
                      onUploaded={(doc) => {
                        setCv(doc);
                        f.set("cv_document_id", doc.document_id);
                      }}
                    />
                  )}
                </Field>
                {questions.map((q) => (
                  <Field key={q.vacancy_question_id} label={q.prompt} optional={!q.required} {...f.status(qKey(q.vacancy_question_id))}>
                    <Answer q={q} {...text(qKey(q.vacancy_question_id))} />
                  </Field>
                ))}
              </div>
            ),
          },
          {
            title: STEPS[2],
            check: () => f.check(WHY),
            body: (
              <div className="flex flex-col gap-5">
                <Field label="Why This Role" {...f.status("cover_letter")}>
                  <TextAreaField rows={6} maxLength={3000} {...text("cover_letter")} />
                </Field>
                <section aria-labelledby="privacy" className="rounded-box border border-border bg-muted p-4">
                  <h4 id="privacy" className="mb-1 inline-flex items-center gap-1.5 text-sm font-strong">
                    <Icon name="shield" className="text-subtle-foreground" />
                    Privacy Notice
                  </h4>
                  <p className="text-sm text-muted-foreground">We use what you send only to consider you for roles at MyCityApp. Ask us at any time to delete it.</p>
                  <div className="mt-2">
                    <Field label="Your Agreement" {...f.status("consent")}>
                      <CheckboxField {...f.field("consent")} value={f.values.consent === true} onChange={(v) => f.set("consent", v)} label="I agree to the privacy notice" />
                    </Field>
                  </div>
                </section>
              </div>
            ),
          },
        ]}
      />
    </Page>
  );
}

/** The CV, sent on the strength of the link's own token: a PDF or Word file of up to 10 MB. */
function UploadCv({ token, onUploaded }: { token: string; onUploaded: (doc: DocumentRef) => void }) {
  return (
    <UploadField
      endpoint={`/api/public/v1/apply/${encodeURIComponent(token)}/cv`}
      purpose="cv"
      upload={upload}
      multiple={false}
      accept=".pdf,.doc,.docx"
      kinds="PDF or Word"
      maxBytes={10 * 1024 * 1024}
      label="Choose Your CV"
      onUploaded={(docs) => docs[0] && onUploaded(docs[0] as DocumentRef)}
    />
  );
}

/** One of the vacancy's questions, answered as its kind asks: yes or no, one of its options, or words. */
function Answer({ q, value, onChange, onBlur, state }: { q: ApplyQuestion; value: string; onChange: (v: string) => void; onBlur?: () => void; state?: "good" | "bad" | undefined }) {
  if (q.question_type === "yes_no")
    return (
      <ChoiceField
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        state={state}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
      />
    );
  const options = q.options ?? [];
  if (q.question_type === "choice" && options.length >= 2 && options.length <= 5)
    return <RadioCards value={value || null} onChange={onChange} onBlur={onBlur} state={state} options={options.map((o) => ({ value: o, label: o }))} />;
  if (q.question_type === "choice") return <SelectField value={value} onChange={onChange} onBlur={onBlur} state={state} options={options.map((o) => ({ value: o, label: o }))} />;
  return <TextAreaField rows={3} maxLength={2000} value={value} onChange={onChange} onBlur={onBlur} state={state} />;
}

/** What applying answers: the reference to quote, and nothing about how the application will go. */
function Receipt({ title, receipt }: { title: string; receipt: ApplicationReceipt }) {
  const { navigate } = useRouter();
  const mark = useRef<HTMLDivElement>(null);
  return (
    <Page title="Application Sent">
      <div className="relative">
        <Confetti burstOnView viewFrom={mark} />
        <div ref={mark}>
          <PageMessage icon="ok" tone="ok" title="Application Sent" action={<Button onClick={() => navigate("/jobs")}>See Other Roles</Button>}>
            <p>
              Thank you for applying for <b className="text-foreground">{title}</b>. We read every application and will email you within five working days.
            </p>
            <div className="mx-auto mt-4 w-fit rounded-box border border-border bg-muted px-5 py-3 text-center">
              <p className="text-2xs font-strong tracking-wide text-eyebrow uppercase">Your Reference</p>
              <p className="mt-1 font-mono text-2xl font-strong tracking-wide text-foreground">{receipt.reference}</p>
            </div>
            <p className="mt-4">We have emailed it to you too. You can close this page.</p>
          </PageMessage>
        </div>
      </div>
    </Page>
  );
}
