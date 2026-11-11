import { useState, type ReactNode } from "react";
import proposals from "@mycity/contract/schemas/proposals.js";
import type { ProposalContent, ProposalContentEdit, ProposalDetail, ProposalPreview } from "@mycity/contract/contract.gen.ts";

/** One page of a proposal's content. */
type Section = ProposalContent["sections"][number];
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { ActionGroup, Banner, Button, DocumentFrame, Field, FormFooter, Pill, SelectField, TextAreaField, TextField, toast, UploadField, useContractForm, useIsPhone, useModal } from "@mycity/ui";
import { fail, failed } from "../lib";

const LAYOUTS: Record<string, string> = { cover: "Cover", letter: "Letter", opportunity: "Opportunity", why_mycity: "Why MyCity", audience: "Audience", deliverables: "Deliverables", packages: "Packages", timeline: "Timeline", proof: "Proof", terms: "Terms", next_steps: "Next Steps", closing: "Closing", insight: "Insight" };
const IMAGE_LABEL: Record<string, string> = { image_asset_id: "Photograph", partner_logo_asset_id: "Partner's Logo", signer_photo_asset_id: "Signer's Photo" };

/** The words of a section a person edits in place: one field each, the layout's own. */
type TextKey = "title" | "heading" | "pull_quote" | "intro" | "takeaway" | "note" | "message";
const TEXT_KEYS: TextKey[] = ["title", "heading", "pull_quote", "intro", "takeaway", "note", "message"];
const LABEL: Record<TextKey, string> = { title: "Title", heading: "Heading", pull_quote: "Pull Quote", intro: "Introduction", takeaway: "Takeaway", note: "Note", message: "Message" };

/** Edit Words: a section's headings and paragraphs, saved as the section (§6.10 step 4). */
function EditWords({ p, s, close }: { p: ProposalDetail; s: Section; close: () => void }) {
  const record = s as unknown as Record<string, unknown>;
  const keys = TEXT_KEYS.filter((k) => k in record);
  const paragraphs = Array.isArray(record.paragraphs) ? (record.paragraphs as string[]) : null;
  const steps = Array.isArray(record.steps) ? (record.steps as string[]) : null;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String(record[k] ?? "")])));
  const [paras, setParas] = useState<string[]>(paragraphs ?? steps ?? []);
  const [problem, setProblem] = useState<Record<string, string>>({});
  const save = useMutation("PATCH /api/v1/partnerships/proposals/:id/content");
  const submit = async () => {
    const next: Record<string, unknown> = { ...record };
    for (const k of keys) next[k] = values[k].trim() ? values[k].trim() : k === "pull_quote" || k === "intro" || k === "note" || k === "message" ? null : record[k];
    if (paragraphs) next.paragraphs = paras.map((x) => x.trim()).filter(Boolean);
    if (steps) next.steps = paras.map((x) => x.trim()).filter(Boolean);
    const checked = proposals.Section.safeParse(next);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      setProblem({ [String(issue.path[0] ?? "section")]: issue.message.length > 30 ? "Check this field" : issue.message });
      return;
    }
    try {
      await save.run({ params: { id: p.partnership_proposal_id }, body: { op: "section", key: s.key, section: checked.data as Section } });
      invalidate(`/api/v1/partnerships/proposals/${p.partnership_proposal_id}`);
      close();
      toast("Page saved");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      {keys.map((k) => (
        <Field key={k} label={LABEL[k]} optional={k === "pull_quote" || k === "intro" || k === "note" || k === "message"} state={problem[k] ? "bad" : undefined} message={problem[k]}>
          {k === "heading" || k === "title" ? (
            <TextField value={values[k]} onChange={(v) => setValues((x) => ({ ...x, [k]: v }))} />
          ) : (
            <TextAreaField value={values[k]} onChange={(v) => setValues((x) => ({ ...x, [k]: v }))} rows={2} />
          )}
        </Field>
      ))}
      {paras.map((text, i) => (
        <Field key={i} label={paragraphs ? `Paragraph ${i + 1}` : `Step ${i + 1}`} state={problem.paragraphs || problem.steps ? "bad" : undefined} message={problem.paragraphs || problem.steps}>
          <TextAreaField value={text} onChange={(v) => setParas((x) => x.map((y, j) => (j === i ? v : y)))} rows={paragraphs ? 4 : 2} />
        </Field>
      ))}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Page</Button>
      </FormFooter>
    </>
  );
}

/** Rewrite Section: an instruction for Claude on this page alone; nothing kept until Use Rewrite. */
function Rewrite({ p, s, close }: { p: ProposalDetail; s: Section; close: () => void }) {
  const f = useContractForm({ instruction: "" }, proposals.SectionRewrite);
  const ask = useMutation("POST /api/v1/partnerships/proposals/:id/sections/:key/rewrite");
  const save = useMutation("PATCH /api/v1/partnerships/proposals/:id/content");
  const [draft, setDraft] = useState<Section | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const write = async () => {
    if (!f.check()) return;
    try {
      const r = await ask.run({ params: { id: p.partnership_proposal_id, key: s.key }, body: f.values });
      if (!r.available) setOff(r.reason === "limit" ? "AI Limit Reached" : "AI Is Off");
      else setDraft(r.section);
    } catch (e) {
      failed(f)(e);
    }
  };
  const use = async () => {
    if (!draft) return;
    try {
      await save.run({ params: { id: p.partnership_proposal_id }, body: { op: "section", key: s.key, section: draft } });
      invalidate(`/api/v1/partnerships/proposals/${p.partnership_proposal_id}`);
      close();
      toast("Rewrite used");
    } catch (e) {
      fail(e);
    }
  };
  const words = draft ? [("heading" in draft && draft.heading) || "", ...("paragraphs" in draft ? draft.paragraphs : [])].filter(Boolean) : [];
  return (
    <>
      {off && <Banner tone="info" icon="spark">{off}</Banner>}
      <Field label="Instruction" {...f.status("instruction")}>
        <TextAreaField {...f.field("instruction")} rows={3} placeholder="Warmer, shorter" />
      </Field>
      {draft && (
        <div className="mb-3 rounded-box bg-muted p-3 text-sm text-foreground" data-copy="content">
          {words.map((w, i) => (
            <p key={i} className={i === 0 ? "mb-1 font-semibold" : "mb-1"}>{w}</p>
          ))}
        </div>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {draft ? <Button variant="primary" onClick={use}>Use Rewrite</Button> : <Button variant="primary" icon="spark" onClick={write}>Rewrite Section</Button>}
      </FormFooter>
    </>
  );
}

/**
 * The studio's Edit (docs/guides/partnerships.md §6.10 step 4): the proposal as the partner will see it,
 * drawn by the kit; a page pressed shows its controls beside it. Change Layout and Move are desktop's;
 * a phone edits the words and the pictures.
 */
export function Edit({ p, preview, done }: { p: ProposalDetail; preview: ProposalPreview; done: (next: ProposalDetail) => void }) {
  const phone = useIsPhone();
  const modal = useModal();
  const visible = preview.sections.filter((s) => !s.hidden);
  const [key, setKey] = useState<string | null>(visible[0]?.key ?? null);
  const s = preview.sections.find((x) => x.key === key) ?? null;
  const section = p.content?.sections.find((x) => x.key === key) ?? null;
  const edit = useMutation("PATCH /api/v1/partnerships/proposals/:id/content");
  const change = async (body: ProposalContentEdit) => {
    try {
      const next = await edit.run({ params: { id: p.partnership_proposal_id }, body });
      invalidate(`/api/v1/partnerships/proposals/${p.partnership_proposal_id}`);
      done(next);
    } catch (e) {
      fail(e);
    }
  };
  const at = s ? preview.sections.indexOf(s) : -1;
  const open = (title: string, body: (close: () => void) => ReactNode) => modal.open({ title, body, full: phone });

  const panel = s && section && (
    <aside className="flex flex-col gap-3 rounded-card border border-border bg-card p-4" aria-label={s.label}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground" data-copy="content">{s.label}</span>
        <Pill>{LAYOUTS[s.layout] ?? s.layout}</Pill>
      </div>
      {s.unconfirmed.length > 0 && <Banner tone="warn">{`Confirm ${s.unconfirmed.join(", ")}`}</Banner>}
      {!phone && s.fits.length > 1 && (
        <Field label="Layout">
          <SelectField value={s.layout} onChange={(layout) => change({ op: "layout", key: s.key, layout: layout as Section["layout"] })} options={s.fits.map((l) => [l, LAYOUTS[l] ?? l] as [string, string])} />
        </Field>
      )}
      <ActionGroup>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="edit" onClick={() => open("Edit Words", (close) => <EditWords p={p} s={section} close={close} />)}>Edit Words</Button>
          {p.ai === "on" && <Button size="sm" icon="spark" onClick={() => open("Rewrite Section", (close) => <Rewrite p={p} s={section} close={close} />)}>Rewrite Section</Button>}
          {!phone && <Button size="sm" variant="ghost" icon="up" onClick={() => change({ op: "move", key: s.key, direction: "up" })} disabled={at <= 0}>Move Up</Button>}
          {!phone && <Button size="sm" variant="ghost" icon="down" onClick={() => change({ op: "move", key: s.key, direction: "down" })} disabled={at >= preview.sections.length - 1}>Move Down</Button>}
          <Button size="sm" variant="ghost" icon={s.hidden ? "eye" : "hide"} onClick={() => change({ op: "hide", key: s.key, hidden: !s.hidden })}>{s.hidden ? "Show Page" : "Hide Page"}</Button>
        </div>
      </ActionGroup>
      {s.images.map((img) => (
        <Field key={img.field} label={`Replace ${IMAGE_LABEL[img.field]}`} optional>
          <UploadField
            purpose="photo"
            accept="image/*"
            upload={upload}
            multiple={false}
            compact
            onUploaded={(docs) => docs[0] && change({ op: "image", key: s.key, field: img.field, document_id: docs[0].document_id, alt: `${s.label}, ${IMAGE_LABEL[img.field].toLowerCase()}` })}
          />
        </Field>
      ))}
    </aside>
  );

  const hidden = preview.sections.filter((x) => x.hidden);
  return (
    <div className="flex flex-col gap-3">
      <div className={phone ? "flex flex-col gap-3" : "grid grid-cols-12 items-start gap-4"}>
        <DocumentFrame title={`Proposal ${p.number}`} html={preview.html} selected={key} onSelect={setKey} className={phone ? undefined : "col-span-8 min-w-0"} />
        <div className={phone ? "flex flex-col gap-3" : "col-span-4 flex flex-col gap-3"}>
          {panel}
          {hidden.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hidden.map((x) => (
                <Button key={x.key} size="sm" variant="ghost" icon="hide" onClick={() => setKey(x.key)}>
                  {x.label.length > 24 ? LAYOUTS[x.layout] : x.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
