import { useMemo, useState } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { CategoryDetail, CategoryTemplate, RecordField, TemplateAsk } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, CheckboxField, DocumentEditor, EmptyValue, Field, Form, FormError, FormFooter, FormRow, IconButton, SelectField, Skeleton, TextField, toast, useContractForm } from "@mycity/ui";
import { editorFields, FIELD_TYPE_LABEL, KIND_LABEL, refusal } from "../lib";
import { askKey } from "./template-html";
import { TidyStep } from "./TidyStep";

type Values = { label: string; kind: string; countersigned: boolean; is_default: boolean; body_html: string };

const KINDS = Object.entries(KIND_LABEL) as Array<[string, string]>;
/** The types an ask can be: a value a person gives when the agreement is made. */
const ASK_TYPES = (["text", "long_text", "number", "money", "date", "yes_no"] as const).map((t) => [t, FIELD_TYPE_LABEL[t]] as [string, string]);
const RECORD = partner_pipeline.AGREEMENT_RECORD_FIELDS as RecordField[];

/**
 * Add Template and Edit Template (docs/guides/partnerships.md §6.8): an agreement's name and kind, whether
 * MyCity countersigns and whether it is the category's default of its kind, its wording in the document
 * editor with each value a chip, and its asks. Tidy With AI opens inside this window and hands its draft
 * back with Use Draft; nothing is kept until Save Template.
 */
export function TemplateEditor({ category, template, tidy = false, close }: { category: CategoryDetail; template?: CategoryTemplate; tidy?: boolean; close: () => void }) {
  const read = useApi("GET /api/v1/partnerships/category-templates/:id", { params: { id: template?.partner_category_template_id ?? "" }, enabled: Boolean(template) });
  if (template && !read.data) return read.error ? <p className="text-sm">This template could not be loaded.</p> : <Skeleton shape="block" className="h-72" />;
  return <Editor category={category} template={template} tidy={tidy} html={read.data?.body_html ?? ""} close={close} />;
}

function Editor({ category, template, tidy, html, close }: { category: CategoryDetail; template?: CategoryTemplate; tidy: boolean; html: string; close: () => void }) {
  const add = useMutation("POST /api/v1/partnerships/categories/:id/templates");
  const wording = useMutation("PUT /api/v1/partnerships/category-templates/:id/wording");
  const meta = useMutation("PATCH /api/v1/partnerships/category-templates/:id");
  const [asks, setAsks] = useState<TemplateAsk[]>(template?.asks ?? []);
  const [step, setStep] = useState<"write" | "tidy">(tidy ? "tidy" : "write");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(
    () => ({ label: template?.label ?? "", kind: template?.kind ?? "deal_merchant", countersigned: template?.countersigned ?? false, is_default: template?.is_default ?? false, body_html: html }),
    [template, html],
  );
  const fields = useMemo(() => editorFields(RECORD, category.fields, asks), [category.fields, asks]);

  const bodyOf = (v: Values) =>
    template
      ? { body_html: v.body_html, asks }
      : { kind: v.kind, label: v.label.trim(), title: v.label.trim(), countersigned: v.countersigned, is_default: v.is_default, body_html: v.body_html, asks };
  const checked = useMemo(
    () => ({
      safeParse: (v: unknown) => {
        const x = v as Values;
        if (!x.label.trim()) return { success: false as const, error: { issues: [{ path: ["label"], message: "Add a name", code: "custom" }] } };
        return (template ? partner_pipeline.TemplateWordingSave : partner_pipeline.CategoryTemplateCreate).safeParse(bodyOf(x));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, asks],
  );
  const f = useContractForm<Values>(start, checked as never);

  const save = async () => {
    setError(null);
    if (!f.check()) return;
    const v = f.values;
    try {
      if (template) {
        await wording.run({ params: { id: template.partner_category_template_id }, body: { title: v.label.trim(), body_html: v.body_html, asks } });
        const changed = {
          ...(v.label.trim() !== start.label ? { label: v.label.trim() } : {}),
          ...(v.countersigned !== start.countersigned ? { countersigned: v.countersigned } : {}),
          ...(v.is_default !== start.is_default ? { is_default: v.is_default } : {}),
        };
        if (Object.keys(changed).length) await meta.run({ params: { id: template.partner_category_template_id }, body: changed });
      } else {
        await add.run({ params: { id: category.partner_category_id }, body: bodyOf(v) as never });
      }
      invalidate("/api/v1/partnerships/categories");
      invalidate("/api/v1/partnerships/category-templates");
      close();
      toast(template ? "Template saved" : "Template added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  if (step === "tidy")
    return (
      <TidyStep
        fields={fields}
        asks={asks}
        back={() => setStep("write")}
        onUse={(next, nextAsks) => {
          f.set("body_html", next);
          setAsks(nextAsks);
          setStep("write");
          toast("Draft in the editor");
        }}
      />
    );

  return (
    <Form onSubmit={save}>
      <FormRow>
        <Field label="Name" {...f.status("label")}>
          <TextField {...f.field("label")} placeholder="Deal Merchant Agreement" />
        </Field>
        <Field label="Kind" {...f.status("kind")}>
          <SelectField {...f.field("kind")} options={KINDS} disabled={Boolean(template)} />
        </Field>
      </FormRow>
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
        <CheckboxField value={f.values.countersigned} onChange={(v) => f.set("countersigned", v)} label="MyCity Signs Too" />
        <CheckboxField value={f.values.is_default} onChange={(v) => f.set("is_default", v)} label="Default for Its Kind" />
      </div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" icon="spark" onClick={() => setStep("tidy")}>
          Tidy With AI
        </Button>
      </div>
      <Field label="Wording" {...f.status("body_html")}>
        <DocumentEditor label="Wording" fields={fields} {...f.field("body_html")} />
      </Field>
      <Asks asks={asks} onChange={setAsks} />
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Template
        </Button>
      </FormFooter>
    </Form>
  );
}

/**
 * The values a person gives when an agreement is made from this template (an ask), each named in the wording as
 * `{{ ask.key }}`. A key is made from its label when the ask is added and never changes, so a chip already placed
 * keeps working when the label is reworded.
 */
function Asks({ asks, onChange }: { asks: TemplateAsk[]; onChange: (a: TemplateAsk[]) => void }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [bad, setBad] = useState(false);
  const add = () => {
    if (!label.trim()) return setBad(true);
    onChange([...asks, { key: askKey(label, asks), label: label.trim(), type: type as TemplateAsk["type"] }]);
    setLabel("");
    setBad(false);
  };
  const edit = (key: string, patch: Partial<TemplateAsk>) => onChange(asks.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  return (
    <section aria-label="Asks" className="mb-3">
      <h3 data-ui="title" className="mb-1.5 text-sm font-semibold">
        Asks
      </h3>
      {asks.length === 0 ? (
        <p className="mb-2 text-xs text-subtle-foreground">
          <EmptyValue />
        </p>
      ) : (
        <ul className="mb-2 grid gap-2">
          {asks.map((a) => (
            <li key={a.key} className="flex flex-col gap-2 rounded-box border border-border p-2 desk:flex-row desk:items-center">
              <TextField className="desk:flex-1" aria-label={`Label of ${a.label}`} value={a.label} onChange={(v: string) => edit(a.key, { label: v })} />
              <SelectField className="desk:w-36" aria-label={`Type of ${a.label}`} value={a.type} onChange={(v) => edit(a.key, { type: v as TemplateAsk["type"] })} options={ASK_TYPES} />
              <TextField className="desk:flex-1" aria-label={`Default of ${a.label}`} value={a.default ?? ""} onChange={(v: string) => edit(a.key, { default: v || null })} placeholder="Default" />
              <IconButton icon="trash" label={`Remove ${a.label}`} onClick={() => onChange(asks.filter((x) => x.key !== a.key))} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 desk:flex-row desk:items-end">
        <Field className="desk:flex-1" label="New Ask" state={bad ? "bad" : undefined} message={bad ? "Add a name" : undefined}>
          <TextField value={label} onChange={(v: string) => (setLabel(v), setBad(false))} placeholder="Opening Hours" />
        </Field>
        <Field className="desk:w-36" label="Type">
          <SelectField value={type} onChange={setType} options={ASK_TYPES} />
        </Field>
        <Button icon="plus" onClick={add}>
          Add Ask
        </Button>
      </div>
    </section>
  );
}
