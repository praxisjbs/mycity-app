import { useState } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { ProposedField, TemplateAsk, TemplateTidyDraft } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useMutation } from "@/api/hooks";
import { Button, DocumentEditor, Field, FormFooter, Icon, SelectField, TextAreaField, toast, useContractForm, type DocumentEditorField } from "@mycity/ui";
import { askKey, retag } from "./template-html";

const MAKE_ASK = "\u0000ask";

type Pasted = { text: string };
const pasted = { safeParse: (v: unknown) => partner_pipeline.TemplateTidy.pick({ text: true }).safeParse(v) };

/** Why there is no draft, as a toast. */
const off = (reason: TemplateTidyDraft["reason"]) => toast(reason === "limit" ? "This month's AI budget is spent" : "Tidy With AI is off");

/**
 * Tidy With AI inside the template editor's own window (docs/guides/partnerships.md §6.8; modals never stack):
 * the person pastes the text of a Word agreement, and the AI gives it back tidied with a field proposed for
 * every value that belongs to a partner or a deal. Each field shows with the words it replaces: leave it,
 * Change it to another field, or Make an Ask. Nothing is kept until Use Draft hands the wording and its asks
 * to the editor, which the person still saves.
 */
export function TidyStep({ fields, asks, onUse, back }: { fields: DocumentEditorField[]; asks: TemplateAsk[]; onUse: (html: string, asks: TemplateAsk[]) => void; back: () => void }) {
  const tidy = useMutation("POST /api/v1/partnerships/templates/tidy");
  const f = useContractForm<Pasted>({ text: "" }, pasted);
  const [draft, setDraft] = useState<TemplateTidyDraft | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const run = async () => {
    if (!f.check()) return;
    try {
      const d = await tidy.run({ body: { text: f.values.text.trim() } });
      if (!d.available) return off(d.reason);
      setDraft(d);
      setChosen({});
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError && e.message ? e.message : "Not tidied. Try again.");
    }
  };

  /** The draft with each field the person changed swapped in, and the asks it needs. */
  const finish = () => {
    if (!draft || !draft.body_html) return;
    let html = draft.body_html;
    const kept = [...asks];
    const done = new Set<string>();
    for (const p of draft.fields) {
      if (done.has(p.field)) continue;
      done.add(p.field);
      if (p.source === "ask") {
        const key = p.field.slice(4);
        if (!kept.some((a) => a.key === key)) kept.push({ key, label: p.label, type: p.ask_type ?? "text" });
        continue;
      }
      const pick = chosen[p.field] ?? p.field;
      if (pick === p.field) continue;
      if (pick === MAKE_ASK) {
        const key = askKey(p.label, kept);
        kept.push({ key, label: p.label, type: "text" });
        html = retag(html, p.field, { field: `ask.${key}`, label: p.label, tag: `{{ ask.${key} }}` });
      } else {
        const to = fields.find((x) => x.field === pick);
        if (to) html = retag(html, p.field, to);
      }
    }
    onUse(html, kept);
  };

  const options: Array<[string, string]> = [...fields.filter((x) => !x.field.startsWith("ask.")).map((x) => [x.field, x.group ? `${x.group}: ${x.label}` : x.label] as [string, string]), [MAKE_ASK, "Make an Ask"]];
  const byField = new Map<string, ProposedField>();
  for (const p of draft?.fields ?? []) if (p.source !== "ask" && !byField.has(p.field)) byField.set(p.field, p);

  return (
    <>
      <h3 data-ui="title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon name="spark" />
        Tidy With AI
      </h3>
      {!draft ? (
        <Field label="Pasted Wording" {...f.status("text")}>
          <TextAreaField {...f.field("text")} rows={12} />
        </Field>
      ) : (
        <>
          <div className="mb-3 rounded-box border border-border">
            <DocumentEditor label="Tidied Wording" fields={fields} readOnly value={draft.body_html ?? ""} onChange={() => undefined} />
          </div>
          {byField.size > 0 && (
            <ul className="mb-3 grid gap-2" aria-label="Proposed fields">
              {[...byField.values()].map((p) => (
                <li key={p.field} className="flex flex-col gap-1 rounded-box border border-border p-2.5 desk:flex-row desk:items-center">
                  <span className="min-w-0 truncate text-sm desk:flex-1" data-copy="content">
                    {p.found}
                  </span>
                  <SelectField
                    className="desk:w-64"
                    aria-label={`Field for ${p.found}`}
                    value={chosen[p.field] ?? p.field}
                    onChange={(v) => setChosen((c) => ({ ...c, [p.field]: v }))}
                    options={options}
                    searchable
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <FormFooter>
        <Button icon="left" onClick={draft ? () => setDraft(null) : back}>
          Back
        </Button>
        {draft ? (
          <Button variant="primary" icon="ok" onClick={finish}>
            Use Draft
          </Button>
        ) : (
          <Button variant="primary" icon="spark" onClick={run}>
            Tidy Wording
          </Button>
        )}
      </FormFooter>
    </>
  );
}
