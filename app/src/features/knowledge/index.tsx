import { Fragment, useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/knowledge";
import "@/api/types/community";
import type { ArticleKind, Block } from "@/api/types/knowledge";
import { useAuth } from "@/auth/AuthProvider";
import type { ModuleScreenProps } from "@/shell/screens";
import { PoliciesTab } from "@/features/policies/PoliciesHub";
import { ArticleBody, Button, Card, ErrorState, Field, formatDate, FormFooter, LoadingRows, PageHeader, Pill, Reader, StatStrip, StatusPill, TextAreaField, TextField, toast, useContractForm, useModal } from "@mycity/ui";
import { TrainingTab } from "./Training";
import { UserGuide } from "./UserGuide";

export default function Knowledge({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "sops": return <Articles kind="sop" id={id} />;
    case "training": return <TrainingTab id={id} />;
    case "user-guide":
      return <UserGuide id={id} />;
    default: return <PoliciesTab />;
  }
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/** `**word**` as bold; everything else is text. Article text never arrives as HTML. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i} className="text-foreground">{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}
function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i): ReactNode =>
        b.type === "h" ? <h3 data-copy="content" key={i}>{b.text}</h3> : b.type === "quote" ? <blockquote key={i}><Rich text={b.text} /></blockquote> : b.type === "ul" ? <ul key={i}>{b.items.map((x, j) => <li key={j}><Rich text={x} /></li>)}</ul> : <p key={i}><Rich text={b.text} /></p>,
      )}
    </>
  );
}

/* ───────────── Policies and SOPs ───────────── */

function Articles({ kind, id }: { kind: ArticleKind; id: string | null }) {
  const modal = useModal();
  const { can } = useAuth();
  const s = useApi("GET /api/v1/knowledge/articles/summary", { query: { kind } });
  const list = usePaged("GET /api/v1/knowledge/articles", { filters: { kind } });
  const [sel, setSel] = useState<string | null>(id);
  const current = sel ?? s.data?.first_id ?? null;
  const a = useApi("GET /api/v1/knowledge/articles/:id", { params: { id: current ?? "" }, enabled: !!current });
  const groups = [...new Set(list.rows.map((r) => r.group))].map((label) => ({ label, items: list.rows.filter((r) => r.group === label).map((r) => ({ key: r.article_id, title: r.title })) }));
  const policy = kind === "policy";
  const title = policy ? "Policies" : "SOPs";
  return (
    <>
      <PageHeader
        title={title}
        sub={policy ? "HR and company policy" : "How to do things in the platform"}
        actions={can("people", "create") && <Button variant="primary" icon="plus" onClick={() => modal.open({ title: policy ? "New Policy" : "New SOP", wide: true, body: (close) => <ArticleForm kind={kind} close={close} /> })}>{policy ? "New Policy" : "New SOP"}</Button>}
      />
      {s.data && (
        <StatStrip
          items={
            policy
              ? [{ label: "Policies", value: `${s.data.current} current` }, { label: "Archived", value: s.data.archived }, { label: "Reading Now", value: a.data ? `${a.data.title.split(" ")[0]}, v${a.data.version}` : "None" }, { label: "Owner", value: s.data.owner }, { label: "Last Updated", value: s.data.last_updated ? formatDate(s.data.last_updated) : "Never", desktop: true }]
              : [{ label: "SOPs", value: s.data.current }, { label: "Categories", value: s.data.groups }, { label: "Reading Now", value: a.data?.title.replace(/^How do I /, "").replace(/\?$/, "") ?? "None" }, { label: "Read This Month", value: s.data.read_this_month }, { label: "Average Length", value: `${s.data.average_minutes} minute${s.data.average_minutes === 1 ? "" : "s"}`, desktop: true }]
          }
        />
      )}
      {list.loading && !list.rows.length ? <Card><LoadingRows count={6} /></Card> : (
        <Reader groups={groups} selected={current} onSelect={setSel}>
          {a.error ? <ErrorState error={a.error} /> : !a.data ? <LoadingRows count={8} /> : (
            <ArticleBody
              title={a.data.title}
              meta={<><StatusPill s={a.data.status} />{policy ? <Pill>Version {a.data.version}</Pill> : <Pill>{a.data.group}</Pill>}<Pill>Updated {formatDate(a.data.updated_on)}</Pill>{policy ? <Pill>Owner: {a.data.owner}</Pill> : <Pill>{a.data.read_minutes} minute read</Pill>}</>}
            >
              <Blocks blocks={a.data.blocks} />
            </ArticleBody>
          )}
        </Reader>
      )}
    </>
  );
}

function ArticleForm({ kind, close }: { kind: ArticleKind; close: () => void }) {
  const f = useContractForm({ title: "", group: kind === "policy" ? "Current" : "", body: "" }, { title: (v) => (v.trim().length < 4 ? "Give it a title" : null), group: (v) => (!v.trim() ? "Pick a section" : null), body: (v) => (v.trim().length < 40 ? "At least 40 characters" : null) });
  const save = useMutation("POST /api/v1/knowledge/articles");
  /* Plain text in: "## " starts a heading, "- " a list item, "> " a quote, a blank line a paragraph. */
  const toBlocks = (t: string): Block[] => {
    const out: Block[] = [];
    t.split(/\n{2,}/).forEach((chunk) => {
      const lines = chunk.split("\n").map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return;
      if (lines.every((x) => x.startsWith("- "))) out.push({ type: "ul", items: lines.map((x) => x.slice(2)) });
      else if (lines[0].startsWith("## ")) {
        out.push({ type: "h", text: lines[0].slice(3) });
        if (lines.length > 1) out.push({ type: "p", text: lines.slice(1).join(" ") });
      } else if (lines[0].startsWith("> ")) out.push({ type: "quote", text: lines.map((x) => x.replace(/^> /, "")).join(" ") });
      else out.push({ type: "p", text: lines.join(" ") });
    });
    return out;
  };
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { kind, title: f.values.title.trim(), group: f.values.group.trim(), blocks: toBlocks(f.values.body) } });
      invalidate("/api/v1/knowledge/articles");
      close();
      toast("Published. Staff are notified");
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) fail(e);
    }
  };
  return (
    <>
      <Field label="Title" {...f.field("title")}><TextField {...f.field("title")} placeholder={kind === "sop" ? "How do I ...?" : "e.g. Travel policy"} /></Field>
      <Field label="Section" {...f.field("group")}><TextField {...f.field("group")} placeholder={kind === "sop" ? "Money, People, Attendance" : "Current"} /></Field>
      <Field label="Text" info="A blank line starts a paragraph. Start a line with ## for a heading, - for a list item, > for a highlighted note, and wrap words in ** for bold." {...f.field("body")}>
        <TextAreaField {...f.field("body")} rows={12} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Publish</Button>
      </FormFooter>
    </>
  );
}
