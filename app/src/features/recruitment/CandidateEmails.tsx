/**
 * Candidate Emails (docs/guides/recruitment.md §6.10): the five emails a candidate receives, each
 * a subject and a Markdown body with the {{ names }} it may use. Saving keeps a new version; Restore
 * Default puts the shipped wording back as a new version too, so nothing is lost.
 */
import { useState } from "react";
import candidateSchemas from "@mycity/contract/schemas/candidates.js";
import type { CandidateEmail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { Button, DataView, ErrorState, Field, formatDateTime, FormError, FormFooter, LoadingRows, Pill, TextAreaField, TextField, toast, useConfirm, useContractForm, useModal } from "@mycity/ui";
import { say, sayRefusal } from "./shared";

export function CandidateEmails({ close, mayEdit }: { close: () => void; mayEdit: boolean }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/recruitment/candidates/emails");
  const open = (e: CandidateEmail) => modal.open({ title: e.name, wide: true, body: (done) => <EmailForm emailKey={e.key} close={done} mayEdit={mayEdit} /> });
  return (
    <>
      <DataView<CandidateEmail>
        title="Candidate Emails"
        rows={list.rows}
        rowKey={(e) => e.key}
        loading={list.loading}
        error={list.error}
        onRowClick={open}
        columns={[
          { key: "name", label: "Email", render: (e) => <span className="font-semibold">{e.name}</span> },
          { key: "subject", label: "Subject", render: (e) => e.subject, desktop: true },
          { key: "state", label: "Wording", render: (e) => (e.is_default ? <Pill dot={false}>Default</Pill> : <Pill tone="info">Changed</Pill>) },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

function EmailForm({ emailKey, close, mayEdit }: { emailKey: CandidateEmail["key"]; close: () => void; mayEdit: boolean }) {
  const read = useApi("GET /api/v1/recruitment/candidates/emails/:key", { params: { key: emailKey } });
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={5} />;
  return <EmailFields email={read.data} close={close} mayEdit={mayEdit} />;
}

function EmailFields({ email, close, mayEdit }: { email: CandidateEmail; close: () => void; mayEdit: boolean }) {
  const f = useContractForm({ subject: email.subject, body: email.body }, candidateSchemas.CandidateEmailSave);
  const save = useMutation("PUT /api/v1/recruitment/candidates/emails/:key");
  const restore = useMutation("POST /api/v1/recruitment/candidates/emails/:key/restore");
  const confirm = useConfirm();
  const [problem, setProblem] = useState<string | null>(null);
  const done = (said: string) => {
    invalidate("/api/v1/recruitment/candidates/emails");
    close();
    toast(said);
  };
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ params: { key: email.key }, body: f.values });
      done("Email saved");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  const back = async () => {
    const yes = await confirm({ title: "Restore Default", body: "The shipped wording comes back. Yours stays in the history.", confirmLabel: "Restore Default" });
    if (!yes) return;
    try {
      await restore.run({ params: { key: email.key }, body: {} });
      done("Default wording restored");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Subject" {...f.status("subject")}>
        <TextField {...f.field("subject")} maxLength={200} disabled={!mayEdit} />
      </Field>
      <Field label="Body" {...f.status("body")}>
        <TextAreaField {...f.field("body")} rows={10} disabled={!mayEdit} />
      </Field>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" data-copy="content">
        {email.variables.map((v) => (
          <Pill key={v} dot={false}>{`{{ ${v} }}`}</Pill>
        ))}
      </div>
      <p className="text-xs text-text-3">{email.updated_at ? `Version ${email.version}, ${formatDateTime(email.updated_at)}` : "Default wording"}</p>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>{mayEdit ? "Cancel" : "Close"}</Button>
        {mayEdit && !email.is_default && <Button onClick={back}>Restore Default</Button>}
        {mayEdit && <Button variant="primary" onClick={submit}>Save Email</Button>}
      </FormFooter>
    </>
  );
}
