import { useMemo, useState } from "react";
import agreements from "@mycity/contract/schemas/agreements.js";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { AgreementDetail, RecordField, SignerInput } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useInfinite, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { paging } from "@/features/shared/wire";
import { Button, CheckboxField, DateField, DocumentEditor, Field, Form, FormError, FormFooter, FormRow, NumberField, SelectField, TextAreaField, TextField, toast, UploadField, useContractForm } from "@mycity/ui";
import { editorFields, KIND_LABEL, refusal } from "../lib";

/**
 * The forms of Contracts & MOUs (docs/guides/partnerships.md §6.8, §6.9, §10.1): Generate Agreement, Edit
 * Draft, Send for Signature (Send Again with corrected signers), Record Signed Copy, Renew and Close
 * Agreement. Each validates with its contract schema and lands the API's refusals on its fields.
 */

const RECORD = partner_pipeline.AGREEMENT_RECORD_FIELDS as RecordField[];
const KINDS = Object.entries(KIND_LABEL) as Array<[string, string]>;
const refresh = () => invalidate("/api/v1/partnerships/agreements");

/** A save that failed: on the form's fields when the API named them, else one line above the footer. */
function landed(f: { setServerErrors: (x: Record<string, string[]>) => void }, setError: (s: string | null) => void) {
  return (e: unknown) => {
    if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
    setError(refusal(e, "Not saved. Check your connection and try again."));
  };
}

/** Generate Agreement on a deal: the category's default template of the kind, filled from the record (§6.8). */
export function GenerateAgreement({ dealId, close, onCreated }: { dealId?: string; close: () => void; onCreated?: (id: string) => void }) {
  const deals = useInfinite("GET /api/v1/partnerships/deals", { filters: { status: "open" } });
  const live = useInfinite("GET /api/v1/partnerships/deals", { filters: { status: "live" } });
  const [error, setError] = useState<string | null>(null);
  const f = useContractForm({ deal_id: dealId ?? "", kind: "deal_merchant" }, agreements.AgreementGenerate);
  const generate = useMutation("POST /api/v1/partnerships/agreements");
  const options = [...deals.rows, ...live.rows].map((d) => [d.deal_id, `${d.title} · ${d.record.name}`] as [string, string]);
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    try {
      const made = await generate.run({ body: { deal_id: f.values.deal_id, kind: f.values.kind as never } });
      refresh();
      close();
      toast("Draft ready to review");
      onCreated?.(made.partnership_agreement_id);
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      {!dealId && (
        <Field label="Deal" {...f.status("deal_id")}>
          <SelectField {...f.field("deal_id")} options={options} placeholder="Pick the deal" {...paging(deals)} />
        </Field>
      )}
      <Field label="Kind" {...f.status("kind")}>
        <SelectField {...f.field("kind")} options={KINDS} />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">Generate Agreement</Button>
      </FormFooter>
    </Form>
  );
}

type DraftValues = { body_html: string; starts_on: string; ends_on: string; renewal_notice_days: string };

/** Edit Draft: the filled wording in the editor (each empty field a chip), the term and the notice period. */
export function EditDraft({ a, close }: { a: AgreementDetail; close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const fields = useMemo(() => editorFields(RECORD, [], []), []);
  const start = useMemo<DraftValues>(
    () => ({ body_html: a.body_html ?? "", starts_on: a.starts_on ?? "", ends_on: a.ends_on ?? "", renewal_notice_days: String(a.renewal_notice_days) }),
    [a],
  );
  const bodyOf = (v: DraftValues) => ({
    ...(v.body_html !== start.body_html ? { body_html: v.body_html } : {}),
    ...(v.starts_on !== start.starts_on ? { starts_on: v.starts_on || null } : {}),
    ...(v.ends_on !== start.ends_on ? { ends_on: v.ends_on || null } : {}),
    ...(v.renewal_notice_days !== start.renewal_notice_days ? { renewal_notice_days: v.renewal_notice_days === "" ? Number.NaN : Number(v.renewal_notice_days) } : {}),
  });
  const checked = useMemo(
    () => ({
      safeParse: (v: unknown) => {
        const body = bodyOf(v as DraftValues);
        return Object.keys(body).length ? agreements.AgreementUpdate.safeParse(body) : { success: true as const, data: body };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start],
  );
  const f = useContractForm<DraftValues>(start, checked as never);
  const save = useMutation("PATCH /api/v1/partnerships/agreements/:id");
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (!Object.keys(body).length) return close();
    try {
      await save.run({ params: { id: a.partnership_agreement_id }, body: body as never });
      refresh();
      close();
      toast("Draft saved");
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Field label="Wording" {...f.status("body_html")}>
        <DocumentEditor label="Wording" fields={fields} {...f.field("body_html")} />
      </Field>
      <FormRow>
        <Field label="Starts On" {...f.status("starts_on")}><DateField {...f.field("starts_on")} /></Field>
        <Field label="Ends On" optional {...f.status("ends_on")}><DateField {...f.field("ends_on")} /></Field>
      </FormRow>
      <Field label="Notice Days" {...f.status("renewal_notice_days")}><NumberField {...f.field("renewal_notice_days")} placeholder="90" /></Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">Save Draft</Button>
      </FormFooter>
    </Form>
  );
}

type SignerValues = { message: string } & Record<`${"name" | "title" | "email"}_${number}`, string>;

/**
 * Send for Signature, and Send Again with corrected signers (§6.9 step 1): the person confirms each signer,
 * the partner's first and MyCity's second when the template is countersigned. Each is mailed their link.
 */
export function SendForSignature({ a, again = false, close }: { a: AgreementDetail; again?: boolean; close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const base: SignerInput[] = useMemo(() => {
    const from: SignerInput[] = again && a.signers.length ? a.signers.filter((s) => s.email).map((s) => ({ name: s.name, ...(s.title ? { title: s.title } : {}), email: s.email!, side: s.side })) : a.suggested_signers;
    const out = [...from];
    if (!out.some((s) => s.side === "partner")) out.unshift({ name: "", email: "", side: "partner" });
    if (a.countersigned && !out.some((s) => s.side === "mycity")) out.push({ name: "", email: "", side: "mycity" });
    return out;
  }, [a, again]);
  const start = useMemo(() => {
    const v: Record<string, string> = { message: "" };
    base.forEach((s, i) => Object.assign(v, { [`name_${i}`]: s.name, [`title_${i}`]: s.title ?? "", [`email_${i}`]: s.email }));
    return v as SignerValues;
  }, [base]);
  const bodyOf = (v: SignerValues) => ({
    signers: base.map((s, i) => ({
      ...(s.contact_id ? { contact_id: s.contact_id } : {}),
      name: String(v[`name_${i}`] ?? "").trim(),
      ...(String(v[`title_${i}`] ?? "").trim() ? { title: String(v[`title_${i}`]).trim() } : {}),
      email: String(v[`email_${i}`] ?? "").trim(),
      side: s.side,
    })),
    ...(v.message.trim() ? { message: v.message.trim() } : {}),
    confirm: true as const,
  });
  const checked = useMemo(
    () => ({
      safeParse: (v: unknown) => {
        const r = agreements.AgreementSend.safeParse(bodyOf(v as SignerValues));
        if (r.success) return r;
        // A signer's field reads as its own row's: signers.1.email is email_1.
        const issues = r.error.issues.map((x) => (x.path[0] === "signers" && typeof x.path[1] === "number" ? { ...x, path: [`${String(x.path[2])}_${x.path[1]}`] } : x));
        return { success: false as const, error: { issues } };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );
  const f = useContractForm<SignerValues>(start, checked as never);
  const send = useMutation("POST /api/v1/partnerships/agreements/:id/send");
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    try {
      await send.run({ params: { id: a.partnership_agreement_id }, body: bodyOf(f.values) });
      refresh();
      close();
      toast(again ? "Sent again to every signer" : "Sent for signature");
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  const key = (k: "name" | "title" | "email", i: number) => `${k}_${i}` as keyof SignerValues;
  return (
    <Form onSubmit={submit}>
      {base.map((s, i) => (
        <fieldset key={i} className="mb-3">
          <legend className="mb-2 text-sm font-semibold text-foreground">{s.side === "partner" ? "Partner's Signer" : "MyCity's Signer"}</legend>
          <FormRow>
            <Field label="Full Name" {...f.status(key("name", i))}><TextField {...f.field(key("name", i))} /></Field>
            <Field label="Title" optional {...f.status(key("title", i))}><TextField {...f.field(key("title", i))} /></Field>
          </FormRow>
          <Field label="Email" {...f.status(key("email", i))}><TextField type="email" {...f.field(key("email", i))} placeholder="name@company.com" /></Field>
        </fieldset>
      ))}
      <Field label="Message" optional {...f.status("message")}><TextAreaField {...f.field("message")} rows={3} /></Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">{again ? "Send Again" : "Send for Signature"}</Button>
      </FormFooter>
    </Form>
  );
}

/** Record Signed Copy: a signature made on paper, its scan through the upload engine (§6.9). */
export function RecordSignedCopy({ a, close }: { a: AgreementDetail; close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const f = useContractForm({ document_id: "", signed_on: "", signed_by_name: a.suggested_signers.find((s) => s.side === "partner")?.name ?? "", signed_by_title: "" }, agreements.SignedCopyRecord);
  const record = useMutation("POST /api/v1/partnerships/agreements/:id/signed-copy");
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const v = f.values;
    try {
      await record.run({ params: { id: a.partnership_agreement_id }, body: { document_id: v.document_id, signed_on: v.signed_on, signed_by_name: v.signed_by_name.trim(), ...(v.signed_by_title.trim() ? { signed_by_title: v.signed_by_title.trim() } : {}) } });
      refresh();
      invalidate("/api/v1/partnerships/documents");
      close();
      toast("Signed copy recorded");
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Field label="Signed Copy" {...f.status("document_id")}>
        <UploadField purpose="attachment" upload={upload} multiple={false} compact onUploaded={(docs) => f.set("document_id", docs[0]?.document_id ?? "")} />
      </Field>
      <Field label="Signed On" {...f.status("signed_on")}><DateField {...f.field("signed_on")} /></Field>
      <FormRow>
        <Field label="Signed By" {...f.status("signed_by_name")}><TextField {...f.field("signed_by_name")} /></Field>
        <Field label="Title" optional {...f.status("signed_by_title")}><TextField {...f.field("signed_by_title")} /></Field>
      </FormRow>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">Record Copy</Button>
      </FormFooter>
    </Form>
  );
}

/** Renew: the next agreement drafted from this one, its term moved, on a new deal when asked (§6.8). */
export function RenewAgreement({ a, close, onCreated }: { a: AgreementDetail; close: () => void; onCreated?: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const f = useContractForm({ starts_on: "", ends_on: "", new_deal: false }, agreements.AgreementRenew);
  const renew = useMutation("POST /api/v1/partnerships/agreements/:id/renew");
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    try {
      const made = await renew.run({ params: { id: a.partnership_agreement_id }, body: { starts_on: f.values.starts_on, ...(f.values.ends_on ? { ends_on: f.values.ends_on } : {}), new_deal: f.values.new_deal } });
      refresh();
      close();
      toast("Renewal drafted");
      onCreated?.(made.partnership_agreement_id);
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      <FormRow>
        <Field label="Starts On" {...f.status("starts_on")}><DateField {...f.field("starts_on")} min={a.ends_on ?? undefined} /></Field>
        <Field label="Ends On" optional {...f.status("ends_on")}><DateField {...f.field("ends_on")} /></Field>
      </FormRow>
      <CheckboxField value={f.values.new_deal} onChange={(v: boolean) => f.set("new_deal", v)} label="Open a New Deal" />
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">Draft Renewal</Button>
      </FormFooter>
    </Form>
  );
}

/** Close Agreement, from any status, with its reason: an open approval or signing ends with it (§6.8). */
/** Reject an agreement waiting on the reader: the approval's own route, with its reason (§6.9). */
export function RejectAgreement({ a, close }: { a: AgreementDetail; close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const submit = async () => {
    setError(null);
    if (!f.check() || !a.workflow_instance_id) return;
    try {
      await reject.run({ params: { id: a.workflow_instance_id }, body: { reason: f.values.reason.trim() } });
      refresh();
      invalidate("/api/v1/workflow");
      close();
      toast(`${a.number} rejected`);
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} rows={3} placeholder="Dates are wrong" /></Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" type="submit">Reject Agreement</Button>
      </FormFooter>
    </Form>
  );
}

export function CloseAgreement({ a, close }: { a: AgreementDetail; close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const f = useContractForm({ reason: "" }, agreements.AgreementClose);
  const shut = useMutation("POST /api/v1/partnerships/agreements/:id/close");
  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    try {
      await shut.run({ params: { id: a.partnership_agreement_id }, body: { reason: f.values.reason.trim() } });
      refresh();
      close();
      toast("Agreement closed");
    } catch (e) {
      landed(f, setError)(e);
    }
  };
  return (
    <Form onSubmit={submit}>
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} rows={3} /></Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" type="submit">Close Agreement</Button>
      </FormFooter>
    </Form>
  );
}
