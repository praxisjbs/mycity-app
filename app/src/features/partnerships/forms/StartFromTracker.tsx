import { useState } from "react";
import type { TrackerSetupDraft } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, EmptyValue, FormFooter, IconButton, SelectField, toast, UploadField } from "@mycity/ui";
import { MEANING_LABEL, refusal } from "../lib";

const MEANINGS = Object.entries(MEANING_LABEL) as Array<[string, string]>;
const SHEET_MAX = 10 * 1024 * 1024;

/**
 * Start From Tracker (docs/guides/partnerships.md §6.3, §6.13): MyCity's workbook already offers the stages, the
 * partnership types and the potential impacts its team picks from. Uploading it proposes the lists; the person
 * corrects what each stage counts as, drops what MyCity does not want and applies. Nothing is overwritten: a
 * name MyCity already has is left as it is. A pipeline needs a stage that starts, one that signs and one that loses.
 */
export function StartFromTracker({ close }: { close: () => void }) {
  const read = useMutation("POST /api/v1/partnerships/setup/from-tracker");
  const apply = useMutation("POST /api/v1/partnerships/setup/from-tracker/apply");
  const [draft, setDraft] = useState<TrackerSetupDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (documentId: string) => {
    setError(null);
    try {
      setDraft(await read.run({ body: { document_id: documentId } }));
    } catch (e) {
      setError(refusal(e, "This file could not be read. Try again."));
    }
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const made = await apply.run({ body: draft });
      invalidate("/api/v1/partnerships/lists");
      invalidate("/api/v1/partnerships/categories");
      close();
      toast(made.stages + made.categories + made.impact === 0 ? "Nothing new to add" : "Lists set up");
    } catch (e) {
      setError(e instanceof ApiError && e.fields.stages ? "Keep a stage that starts, signs and loses a deal." : refusal(e, "Not applied. Try again."));
    }
  };

  if (!draft)
    return (
      <>
        <UploadField
          upload={upload}
          purpose="attachment"
          multiple={false}
          accept=".xlsx"
          maxBytes={SHEET_MAX}
          label="Choose the tracker"
          kinds="Excel"
          onUploaded={(docs) => void readFile(docs[0].document_id)}
        />
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        <FormFooter>
          <Button onClick={close}>Cancel</Button>
        </FormFooter>
      </>
    );

  const drop = <K extends keyof TrackerSetupDraft>(key: K, i: number) => setDraft({ ...draft, [key]: draft[key].filter((_, at) => at !== i) });
  return (
    <>
      <Section title="Stages" empty={draft.stages.length === 0}>
        {draft.stages.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex flex-col gap-2 desk:flex-row desk:items-center">
            <span className="min-w-0 truncate text-sm desk:flex-1" data-copy="content">
              {s.label}
            </span>
            <SelectField className="desk:w-48"
              aria-label={`Counts as for ${s.label}`}
              value={s.meaning}
              onChange={(v) => setDraft({ ...draft, stages: draft.stages.map((x, at) => (at === i ? { ...x, meaning: v as typeof x.meaning } : x)) })}
              options={MEANINGS}
            />
            <IconButton icon="x" label={`Leave out ${s.label}`} onClick={() => drop("stages", i)} />
          </li>
        ))}
      </Section>
      <Section title="Categories" empty={draft.categories.length === 0}>
        {draft.categories.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm" data-copy="content">
              {c.name}
              {c.default_commission_pct ? ` · ${c.default_commission_pct}%` : ""}
            </span>
            <IconButton icon="x" label={`Leave out ${c.name}`} onClick={() => drop("categories", i)} />
          </li>
        ))}
      </Section>
      <Section title="Potential Impact" empty={draft.impact.length === 0}>
        {draft.impact.map((x, i) => (
          <li key={`${x.label}-${i}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm" data-copy="content">
              {x.label}
            </span>
            <IconButton icon="x" label={`Leave out ${x.label}`} onClick={() => drop("impact", i)} />
          </li>
        ))}
      </Section>
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Apply Lists
        </Button>
      </FormFooter>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mb-3">
      <h3 data-ui="title" className="mb-1.5 text-sm font-semibold">
        {title}
      </h3>
      {empty ? (
        <p className="text-xs text-subtle-foreground">
          <EmptyValue />
        </p>
      ) : (
        <ul className="grid gap-2">{children}</ul>
      )}
    </section>
  );
}
