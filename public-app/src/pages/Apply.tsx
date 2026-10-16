import { useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { ApplicationReceipt } from "@/api/types/public";
import type { DocumentRef } from "@/api/types/common";
import { Page } from "@/shell/Page";
import { Banner, Button, Field, Form, formatDate, formatTime, PageMessage, Skeleton, Sub, TextAreaField, TextField, UploadField } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { LinkProblem } from "./LinkProblem";
import { upload } from "@/api/upload";

type Values = { full_name: string; email: string; phone: string; years: string; why: string };
type Key = keyof Values | "cv";

/** The checks a person sees while filling the form (gate 12). The API checks the same again. */
const RULES: Record<Key, (v: Values, cv: DocumentRef | null) => string | null> = {
  full_name: (v) => (v.full_name.trim().split(/\s+/).length >= 2 ? null : "Your first and last name"),
  email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()) ? null : "An email address we can reach you at"),
  phone: (v) => (v.phone.replace(/\D/g, "").length >= 10 ? null : "A phone number with at least 10 digits"),
  years: (v) => (/^\d{1,2}$/.test(v.years.trim()) ? null : "A whole number of years, for example 5"),
  cv: (_v, cv) => (cv ? null : "Attach your CV"),
  why: (v) => (v.why.trim().length >= 20 ? null : "A sentence or two, at least 20 characters"),
};
const SERVER_KEY: Record<string, Key> = { full_name: "full_name", email: "email", phone: "phone", years_experience: "years", cv_document_id: "cv", why: "why" };

/**
 * Apply (#82): reached by a one-time token. Write only: the candidate sends an
 * application and never reads one back, so there is no score, no status and no
 * other applicant here.
 */
export function Apply({ token }: { token: string }) {
  const { navigate } = useRouter();
  const link = useApi("GET /api/public/v1/apply/:token", { params: { token } });
  const [v, setV] = useState<Values>({ full_name: "", email: "", phone: "", years: "", why: "" });
  const [cv, setCv] = useState<DocumentRef | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [server, setServer] = useState<Partial<Record<Key, string>>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ApplicationReceipt | null>(null);

  if (link.error && !receipt) return <LinkProblem error={link.error} title="Apply" retry={link.reload} />;
  if (!link.data)
    return (
      <Page title="Apply">
        <Skeleton lines={7} />
      </Page>
    );
  if (receipt)
    return (
      <Page title="Application Sent">
        <PageMessage icon="ok" tone="ok" title="Application sent" action={<Button onClick={() => navigate("/jobs")}>See Other Roles</Button>}>
          <p>Thank you for applying for {link.data.vacancy_title}. A person reads every application, and we will email you within five working days.</p>
          <p className="mt-2">
            Your reference is <b className="text-foreground">{receipt.reference}</b>. You can close this page.
          </p>
        </PageMessage>
      </Page>
    );

  const err = (k: Key) => server[k] ?? (touched[k] ? RULES[k](v, cv) : null);
  const state = (k: Key) => (err(k) ? ("bad" as const) : touched[k] && !RULES[k](v, cv) ? ("good" as const) : undefined);
  const set = (k: keyof Values) => (val: string) => {
    setV((x) => ({ ...x, [k]: val }));
    setServer((s) => ({ ...s, [k]: undefined }));
  };
  const blur = (k: Key) => () => setTouched((t) => ({ ...t, [k]: true }));

  const submit = async () => {
    const all = Object.fromEntries((Object.keys(RULES) as Key[]).map((k) => [k, true]));
    setTouched(all);
    if ((Object.keys(RULES) as Key[]).some((k) => RULES[k](v, cv))) return;
    setBusy(true);
    setProblem(null);
    try {
      setReceipt(
        await api.call("POST /api/public/v1/apply/:token", {
          params: { token },
          body: { full_name: v.full_name.trim(), email: v.email.trim(), phone: v.phone.trim(), years_experience: Number(v.years.trim()), cv_document_id: cv!.document_id, why: v.why.trim() },
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setServer(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [SERVER_KEY[k] ?? k, m[0]])));
      } else setProblem(e instanceof ApiError ? e.message : "The application did not send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={`Apply: ${link.data.vacancy_title}`}>
      <h1 className="text-[20px]">Apply: {link.data.vacancy_title}</h1>
      <Sub className="mt-1">
        This link is yours and works until {formatDate(link.data.expires_at)} at {formatTime(link.data.expires_at)}.
      </Sub>
      <Form className="mt-[18px] flex flex-col gap-[13px]" onSubmit={() => void submit()}>
        <Field label="Full Name" htmlFor="full_name" state={state("full_name")} message={err("full_name")}>
          <TextField id="full_name" autoComplete="name" value={v.full_name} onChange={set("full_name")} onBlur={blur("full_name")} state={state("full_name")} />
        </Field>
        <Field label="Email" htmlFor="email" state={state("email")} message={err("email")}>
          <TextField id="email" type="email" autoComplete="email" inputMode="email" value={v.email} onChange={set("email")} onBlur={blur("email")} state={state("email")} />
        </Field>
        <Field label="Phone" htmlFor="phone" state={state("phone")} message={err("phone")}>
          <TextField id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+234 802 000 0000" value={v.phone} onChange={set("phone")} onBlur={blur("phone")} state={state("phone")} />
        </Field>
        <Field label="Years of Experience" htmlFor="years" state={state("years")} message={err("years")}>
          <TextField id="years" inputMode="numeric" value={v.years} onChange={set("years")} onBlur={blur("years")} state={state("years")} className="max-w-[140px]" />
        </Field>
        <Field label="CV" state={err("cv") ? "bad" : undefined} message={err("cv")}>
          <UploadField
            endpoint={`/api/public/v1/apply/${encodeURIComponent(token)}/cv`}
            purpose="cv"
            upload={upload}
            multiple={false}
            accept=".pdf,.doc,.docx"
            kinds="PDF or Word"
            maxBytes={10 * 1024 * 1024}
            label="Choose your CV"
            onUploaded={(docs) => {
              const doc = docs[0] ?? null;
              setCv(doc);
              setServer((s) => ({ ...s, cv: undefined }));
              if (doc) setTouched((t) => ({ ...t, cv: true }));
            }}
          />
        </Field>
        <Field label="Why This Role?" htmlFor="why" state={state("why")} message={err("why")}>
          <TextAreaField id="why" rows={3} value={v.why} onChange={set("why")} onBlur={blur("why")} state={state("why")} />
        </Field>
        {problem && <Banner tone="err">{problem}</Banner>}
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? "Sending" : "Submit Application"}
        </Button>
        <Sub className="text-center">We will email you within five working days.</Sub>
      </Form>
    </Page>
  );
}
