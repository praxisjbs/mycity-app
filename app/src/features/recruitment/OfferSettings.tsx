/**
 * Offer Settings (docs/guides/offers.md §3 step 2, §5; the address's `panel=settings`): who signs
 * offers for the company (the Offer Signatory, an employee with a login, picked 25 at a time), and
 * the standard offer letter: Markdown with the {{ names }} it may use. Saving the wording keeps a
 * new version; Restore Default puts the shipped wording back as a new version, so nothing is lost.
 * An offer keeps the version in force when it was approved.
 */
import { useState } from "react";
import offerSchemas from "@mycity/contract/schemas/offers.js";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import { Button, DataView, ErrorState, Field, formatDateTime, FormError, FormFooter, LoadingRows, Pill, SelectField, TextAreaField, toast, useConfirm, useContractForm, useModal, useUnsavedChanges } from "@mycity/ui";
import { say, sayRefusal } from "./shared";

type Row = { key: "signatory" | "letter"; name: string; value: string; state: "set" | "unset" | "default" | "changed" };

export function OfferSettingsPanel({ close }: { close: () => void }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/recruitment/offers/settings");
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  const s = read.data;
  // A setting opened from the panel goes back to the panel when it closes (the app holds one dialog at a time).
  const back = () => modal.open({ title: "Offer Settings", wide: true, body: (done) => <OfferSettingsPanel close={done} /> });
  const open = (r: Row) =>
    modal.open(
      r.key === "signatory"
        ? { title: "Offer Signatory", body: () => <SignatoryForm current={s?.signatory ?? null} close={back} /> }
        : { title: "Standard Offer Letter", wide: true, full: true, body: () => <LetterForm close={back} /> },
    );
  const rows: Row[] = s
    ? [
        { key: "signatory", name: "Offer Signatory", value: s.signatory ? s.signatory.display_name : "Not named", state: s.signatory ? "set" : "unset" },
        { key: "letter", name: "Standard Offer Letter", value: `Version ${s.letter_version}`, state: s.letter_is_default ? "default" : "changed" },
      ]
    : [];
  return (
    <>
      {!s ? (
        <LoadingRows count={2} />
      ) : (
        <DataView<Row>
          title="Offer Settings"
          rows={rows}
          rowKey={(r) => r.key}
          onRowClick={open}
          columns={[
            { key: "name", label: "Setting", render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: "value", label: "Now", render: (r) => r.value },
            {
              key: "state",
              label: "State",
              render: (r) => (r.state === "unset" ? <Pill tone="warn">Not Set</Pill> : r.state === "changed" ? <Pill tone="info">Changed</Pill> : <Pill dot={false}>{r.state === "default" ? "Default" : "Set"}</Pill>),
            },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

function SignatoryForm({ current, close }: { current: { employee_id: string; display_name: string } | null; close: () => void }) {
  const people = useInfinite("GET /api/v1/employees", { filters: { status: "active" } });
  const f = useContractForm({ signatory_employee_id: current?.employee_id ?? "" }, offerSchemas.OfferSignatorySave);
  const save = useMutation("PUT /api/v1/recruitment/offers/settings/signatory");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const s = await save.run({ body: f.values });
      invalidate("/api/v1/recruitment/offers");
      close();
      toast(`${s.signatory?.display_name ?? "Signatory"} signs offers now`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Signs for the Company" {...f.status("signatory_employee_id")}>
        <SelectField
          searchable
          placeholder="Pick a person"
          options={people.rows.map((p) => [p.employee_id, p.job_title ? `${p.display_name} · ${p.job_title}` : p.display_name] as [string, string])}
          valueLabel={current?.display_name}
          {...paging(people)}
          {...f.field("signatory_employee_id")}
        />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Signatory</Button>
      </FormFooter>
    </>
  );
}

function LetterForm({ close }: { close: () => void }) {
  const read = useApi("GET /api/v1/recruitment/offers/settings/letter");
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  return <LetterFields letter={read.data} close={close} />;
}

function LetterFields({ letter, close }: { letter: { body: string; version: number; is_default: boolean; variables: string[]; updated_at: string | null }; close: () => void }) {
  const f = useContractForm({ body: letter.body }, offerSchemas.OfferLetterTemplateSave);
  useUnsavedChanges(f.isDirty);
  const save = useMutation("PUT /api/v1/recruitment/offers/settings/letter");
  const restore = useMutation("POST /api/v1/recruitment/offers/settings/letter/restore");
  const confirm = useConfirm();
  const [problem, setProblem] = useState<string | null>(null);
  const done = (said: string) => {
    invalidate("/api/v1/recruitment/offers");
    close();
    toast(said);
  };
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      done("Offer letter saved");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  const back = async () => {
    const yes = await confirm({ title: "Restore Default", body: "The shipped wording comes back. Yours stays in the history.", confirmLabel: "Restore Default" });
    if (!yes) return;
    try {
      await restore.run({ body: {} });
      done("Default wording restored");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Wording" help="Markdown. Offers approved from now on use it; offers already approved keep theirs." {...f.status("body")}>
        <TextAreaField {...f.field("body")} rows={18} />
      </Field>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" data-copy="content">
        {letter.variables.map((v) => (
          <Pill key={v} dot={false}>{`{{ ${v} }}`}</Pill>
        ))}
      </div>
      <p className="text-xs text-subtle-foreground">{letter.updated_at ? `Version ${letter.version}, ${formatDateTime(letter.updated_at)}` : "Default wording"}</p>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {!letter.is_default && <Button onClick={back}>Restore Default</Button>}
        <Button variant="primary" onClick={submit}>Save Letter</Button>
      </FormFooter>
    </>
  );
}
