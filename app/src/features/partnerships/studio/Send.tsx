import { useState } from "react";
import proposals from "@mycity/contract/schemas/proposals.js";
import type { ProposalDetail, ProposalPreview } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { saveExport } from "@/api/exports";
import { Banner, Button, Field, FormFooter, TextAreaField, TextField, toast, useContractForm } from "@mycity/ui";
import { fail, failed } from "../lib";

/** "a@x.com, b@x.com" as addresses. */
const addresses = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Send Proposal (docs/guides/partnerships.md §6.10 step 5): To (the primary contact's address first),
 * Cc, Subject and Message, which Write With AI may draft; the stand-in pictures and the figures nobody
 * confirmed listed first; nothing goes until Confirm and Send. The PDF and the private link go from the
 * system sender with the owner as reply-to.
 */
export function SendProposal({ p, preview, close, done }: { p: ProposalDetail; preview: ProposalPreview | null; close: () => void; done: (next: ProposalDetail) => void }) {
  const partner = useApi("GET /api/v1/partnerships/partners/:id", { params: { id: p.record.id }, enabled: p.record.type === "partner" });
  const lead = useApi("GET /api/v1/partnerships/leads/:id", { params: { id: p.record.id }, enabled: p.record.type === "lead" });
  const contacts = partner.data?.contacts ?? lead.data?.contacts ?? [];
  const primary = contacts.find((c) => c.primary_contact && c.email)?.email ?? contacts.find((c) => c.email)?.email ?? "";
  const [to, setTo] = useState<string | null>(null);
  const [cc, setCc] = useState("");
  const f = useContractForm({ subject: p.title ?? "", message: "" }, { subject: (v: string) => (v.trim() ? null : "Give a subject"), message: (v: string) => (v.trim() ? null : "Write a message") });
  const [problem, setProblem] = useState<Record<string, string>>({});
  const [off, setOff] = useState<string | null>(null);
  const send = useMutation("POST /api/v1/partnerships/proposals/:id/send");
  const draft = useMutation("POST /api/v1/partnerships/proposals/:id/message");
  const toText = to ?? primary;

  const write = async () => {
    try {
      const m = await draft.run({ params: { id: p.partnership_proposal_id }, body: {} });
      if (!m.available) return setOff(m.reason === "limit" ? "AI Limit Reached" : "AI Is Off");
      if (m.subject) f.set("subject", m.subject);
      if (m.message) f.set("message", m.message);
    } catch (e) {
      fail(e);
    }
  };
  const confirm = async () => {
    const body = { to: addresses(toText), cc: addresses(cc), subject: f.values.subject, message: f.values.message, confirm: true as const };
    const checked = proposals.ProposalSend.safeParse(body);
    const ok = f.check();
    if (!checked.success) {
      const out: Record<string, string> = {};
      for (const i of checked.error.issues) out[String(i.path[0])] ??= String(i.path[0]) === "to" && !body.to.length ? "Add an address" : "Check the addresses";
      setProblem(out);
      return;
    }
    setProblem({});
    if (!ok) return;
    try {
      done(await send.run({ params: { id: p.partnership_proposal_id }, body }));
      invalidate("/api/v1/partnerships/proposals");
      close();
      toast(`${p.number} sent`);
    } catch (e) {
      failed(f)(e);
    }
  };

  const checks = preview?.checks;
  return (
    <>
      {checks && checks.stand_ins.length > 0 && (
        <Banner tone="info" icon="image">{`Stand-in pictures: ${checks.stand_ins.map((s) => s.label).join(", ")}`}</Banner>
      )}
      {checks && checks.unconfirmed.length > 0 && (
        <Banner tone="warn">{`Confirm figures: ${checks.unconfirmed.map((u) => u.figure).join(", ")}`}</Banner>
      )}
      {off && <Banner tone="info" icon="spark">{off}</Banner>}
      <Field label="To" state={problem.to ? "bad" : undefined} message={problem.to}>
        <TextField type="email" value={toText} onChange={setTo} placeholder="name@company.com" />
      </Field>
      <Field label="Cc" optional state={problem.cc ? "bad" : undefined} message={problem.cc}>
        <TextField type="email" value={cc} onChange={setCc} placeholder="name@company.com" />
      </Field>
      <Field label="Subject" {...f.status("subject")}>
        <TextField {...f.field("subject")} />
      </Field>
      <Field label="Message" {...f.status("message")}>
        <TextAreaField {...f.field("message")} rows={6} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button icon="spark" onClick={write}>Write With AI</Button>
        <Button variant="primary" icon="send" onClick={confirm}>Confirm and Send</Button>
      </FormFooter>
    </>
  );
}

/** Mark Declined: the reason, kept; the link stops. */
export function DeclineProposal({ p, close, done }: { p: ProposalDetail; close: () => void; done: (next: ProposalDetail) => void }) {
  const f = useContractForm({ reason: "" }, proposals.ProposalDecline);
  const decline = useMutation("POST /api/v1/partnerships/proposals/:id/decline");
  const submit = async () => {
    if (!f.check()) return;
    try {
      done(await decline.run({ params: { id: p.partnership_proposal_id }, body: f.values }));
      invalidate("/api/v1/partnerships/proposals");
      close();
      toast("Proposal marked declined");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Mark Declined</Button>
      </FormFooter>
    </>
  );
}

/** Save as Template: the pages and their order under a name, never the partner's facts. */
export function SaveTemplate({ p, close }: { p: ProposalDetail; close: () => void }) {
  const f = useContractForm({ name: "" }, proposals.ProposalTemplateSave);
  const save = useMutation("POST /api/v1/partnerships/proposals/:id/save-as-template");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: p.partnership_proposal_id }, body: f.values });
      invalidate("/api/v1/partnerships/proposal-templates");
      close();
      toast("Template saved");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Festival Ticketing" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Template</Button>
      </FormFooter>
    </>
  );
}

/** Download PDF: the one sent, or the draft's, made in the worker and saved on this device. */
export const downloadPdf = (p: ProposalDetail) => saveExport(api.call("POST /api/v1/partnerships/proposals/:id/pdf", { params: { id: p.partnership_proposal_id }, body: {} }));
