import { Fragment, useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/knowledge";
import "@/api/types/community";
import type { Announcement } from "@/api/types/community";
import type { ArticleKind, Block, Overdue, Resource } from "@/api/types/knowledge";
import { useAuth } from "@/auth/AuthProvider";
import { Button, formatDate, todayIso, Meter, Pill, Who, Card, Grid, PageHeader, useModal, Chips, ErrorState, toast, StatusPill, DateField, Field, FormRow, TextField, ChoiceField, SelectField, TextAreaField, useForm } from "@mycity/ui";
import { Accordion, StatStrip } from "@/components/ui/data";
import { ArticleBody, Reader } from "@/components/ui/Reader";
import { LoadingRows, Table } from "@/components/ui/Table";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { KvCard, ModalFoot, PagedTable, TrailCard, useDepartmentOptions } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";

export default function Knowledge({ tab, id }: ModuleScreenProps) {
  if (tab === "sops") return <Articles kind="sop" id={id} />;
  if (tab === "faqs") return <Faqs />;
  if (tab === "training") return <Training />;
  if (tab === "announcements") return <Announcements />;
  return <Articles kind="policy" id={id} />;
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
        b.type === "h" ? <h4 key={i}>{b.text}</h4> : b.type === "quote" ? <blockquote key={i}><Rich text={b.text} /></blockquote> : b.type === "ul" ? <ul key={i}>{b.items.map((x, j) => <li key={j}><Rich text={x} /></li>)}</ul> : <p key={i}><Rich text={b.text} /></p>,
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
  const f = useForm({ title: "", group: kind === "policy" ? "Current" : "", body: "" }, { title: (v) => (v.trim().length < 4 ? "Give it a title" : null), group: (v) => (!v.trim() ? "Which section it sits in" : null), body: (v) => (v.trim().length < 40 ? "Write the text (40 characters or more)" : null) });
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
      <FormRow>
        <Field label="Title" {...f.field("title")}><TextField {...f.field("title")} placeholder={kind === "sop" ? "How do I ...?" : "e.g. Travel policy"} /></Field>
        <Field label="Section" {...f.field("group")}><TextField {...f.field("group")} placeholder={kind === "sop" ? "Money, People, Attendance" : "Current"} /></Field>
      </FormRow>
      <Field label="Text" info="A blank line starts a paragraph. Start a line with ## for a heading, - for a list item, > for a highlighted note, and wrap words in ** for bold." {...f.field("body")}>
        <TextAreaField {...f.field("body")} rows={12} />
      </Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Publish</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── FAQs ───────────── */

function Faqs() {
  const modal = useModal();
  const { can } = useAuth();
  const s = useApi("GET /api/v1/knowledge/faqs/summary");
  const [topic, setTopic] = useState("");
  const list = usePaged("GET /api/v1/knowledge/faqs", { filters: topic ? { topic } : {} });
  return (
    <>
      <PageHeader title="FAQs" sub="Answered in a sentence or two" actions={can("people", "create") && <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New FAQ", body: (close) => <FaqForm close={close} topics={s.data?.topics.map((t) => t.topic) ?? []} /> })}>New FAQ</Button>} />
      {s.data && <StatStrip items={[{ label: "Questions", value: s.data.questions }, { label: "Asked This Month", value: s.data.asked_this_month }, { label: "Most Asked", value: s.data.most_asked }, { label: "Unanswered", value: s.data.unanswered, tone: s.data.unanswered ? "warn" : "ok" }, { label: "From Praxis AI", value: s.data.from_ai, desktop: true }]} />}
      <Grid cols="1.4/1">
        <div>
          {s.data && <Chips value={topic} onChange={setTopic} options={[["", `All ${s.data.questions}`], ...s.data.topics.map((t) => [t.topic, `${t.topic} ${t.count}`] as [string, string])]} />}
          {list.loading && !list.rows.length ? <LoadingRows /> : <Accordion items={list.rows.map((q, i) => ({ title: q.question, body: q.answer ?? <span className="text-warning">Waiting for a decision, not for wording.</span>, open: i === 0 }))} />}
        </div>
        <KvCard
          title="Where an FAQ Comes From"
          items={[
            ["Asked twice", "A question asked twice goes on this list"],
            ["From Praxis AI", "Many of this month’s questions were asked of the assistant first"],
            ["Who writes them", "People and Operations"],
            ["Length", "A sentence or two. If it needs more, it is a policy or an SOP"],
            ["Unanswered", "They wait in a queue for a decision, not for wording"],
            ["Search", "Everything here is findable from Ctrl K"],
          ]}
        />
      </Grid>
    </>
  );
}

function FaqForm({ close, topics }: { close: () => void; topics: string[] }) {
  const f = useForm({ question: "", answer: "", topic: topics[0] ?? "" }, { question: (v) => (v.trim().length < 8 ? "Write the question as staff ask it" : null), answer: (v) => (v.trim().length < 8 ? "A sentence or two" : v.length > 400 ? "Longer than two sentences. Make it a policy or an SOP" : null) });
  const save = useMutation("POST /api/v1/knowledge/faqs");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/knowledge/faqs");
      close();
      toast("FAQ added");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Question" {...f.field("question")}><TextField {...f.field("question")} /></Field>
      <Field label="Answer" {...f.field("answer")}><TextAreaField {...f.field("answer")} /></Field>
      <Field label="Topic"><SelectField options={topics.map((t) => [t, t])} {...f.field("topic")} /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add FAQ</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Training ───────────── */

function Training() {
  const modal = useModal();
  const { can } = useAuth();
  const s = useApi("GET /api/v1/knowledge/training/summary");
  const list = usePaged("GET /api/v1/knowledge/training");
  const overdue = usePaged("GET /api/v1/knowledge/training/overdue");
  const remind = useMutation("POST /api/v1/knowledge/training/overdue/remind");
  return (
    <>
      <PageHeader title="Training" sub="Resources and onboarding material" actions={can("people", "create") && <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Resource", body: (close) => <ResourceForm close={close} /> })}>New Resource</Button>} />
      {s.data && <KpiTiles items={[{ label: "Resources", value: String(s.data.resources) }, { label: "Completion", value: `${s.data.completion_pct}%` }, { label: "Overdue", value: String(s.data.overdue), tone: s.data.overdue ? "warn" : "ok" }, { label: "Certificates Issued", value: String(s.data.certificates) }]} />}
      <Grid cols={2}>
        {list.rows.map((r: Resource) => (
          <div key={r.resource_id} className="rounded-box border border-border bg-card p-[14px]">
            <h4 className="text-[13.5px] font-semibold">{r.title}</h4>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{r.description}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5"><Pill>{r.kind}</Pill>{r.due && <Pill tone="warn">Due {formatDate(r.due)}</Pill>}</div>
          </div>
        ))}
      </Grid>
      <Grid cols={2} className="mt-3">
        <Table
          title="Completion"
          right={<span className="text-[11.5px] text-subtle-foreground">Across all staff</span>}
          rows={list.rows}
          rowKey={(r) => r.resource_id}
          loading={list.loading}
          columns={[
            { key: "t", label: "Resource", render: (r) => r.title },
            { key: "a", label: "Assigned", align: "n", render: (r) => r.assigned },
            { key: "c", label: "Completed", align: "n", render: (r) => r.completed },
            { key: "p", label: "Progress", render: (r) => <span className="block w-[130px]"><Meter pct={Math.round((r.completed * 100) / Math.max(1, r.assigned))} label={`${Math.round((r.completed * 100) / Math.max(1, r.assigned))}%`} /></span> },
          ]}
        />
        <PagedTable<Overdue>
          title="Who Has Not Finished"
          right={
            <span className="flex items-center gap-2">
              <Pill tone="warn">{overdue.page?.total ?? 0} people</Pill>
              {can("people", "create") && (overdue.page?.total ?? 0) > 0 && <Button size="sm" icon="bell" disabled={remind.pending} onClick={async () => { const r = await remind.run({ body: {} }); toast(`Reminder sent to ${r.reminded} people`); }}>Remind</Button>}
            </span>
          }
          list={overdue}
          rowKey={(o) => o.key}
          noun="person"
          nounPlural="people"
          columns={[
            { key: "p", label: "Employee", render: (o) => <Who name={o.person.display_name} sub={o.person.department ?? undefined} /> },
            { key: "r", label: "Resource", render: (o) => o.resource },
            { key: "d", label: "Due", render: (o) => formatDate(o.due) },
          ]}
        />
      </Grid>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">The NDPA refresher issues a certificate into the employee’s document vault with an expiry date, which is what the expiry alert reads.</p>
    </>
  );
}

function ResourceForm({ close }: { close: () => void }) {
  const depts = useDepartmentOptions("Pick the department");
  const [aud, setAud] = useState<"everyone" | "department">("everyone");
  const f = useForm({ title: "", description: "", kind: "Document", due: "", department: "" }, { title: (v) => (!v.trim() ? "Name the resource" : null), description: (v) => (v.trim().length < 10 ? "What it covers, in a sentence" : null) });
  const save = useMutation("POST /api/v1/knowledge/training");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { title: f.values.title, description: f.values.description, kind: f.values.kind as Resource["kind"], ...(f.values.due && { due: f.values.due }), audience: aud, ...(aud === "department" && { department: f.values.department }) } });
      invalidate("/api/v1/knowledge/training");
      close();
      toast("Assigned. Staff see it in their tasks");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Title" {...f.field("title")}><TextField {...f.field("title")} /></Field>
      <Field label="What It Covers" {...f.field("description")}><TextAreaField {...f.field("description")} /></Field>
      <FormRow>
        <Field label="Kind"><SelectField options={[["Document", "Document"], ["Video", "Video"], ["Course", "Course"]]} {...f.field("kind")} /></Field>
        <Field label="Due (Optional)"><DateField {...f.field("due")} min={todayIso()} /></Field>
      </FormRow>
      <Field label="Assign To"><ChoiceField value={aud} onChange={setAud} options={[["everyone", "Everyone"], ["department", "A Department"]]} /></Field>
      {aud === "department" && <Field label="Department" {...f.field("department")}><SelectField placeholder="Pick the department" options={depts.slice(1)} {...f.field("department")} /></Field>}
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Assign</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Announcements: the permanent record of what Staff Community posts ───────────── */

function Announcements() {
  const { navigate } = useRouter();
  const { can } = useAuth();
  const list = usePaged("GET /api/v1/community/announcements");
  const pub = list.rows.filter((a) => !a.scheduled);
  const avg = pub.length ? Math.round((pub.reduce((s, a) => s + a.reads / Math.max(1, a.audience), 0) * 100) / pub.length) : 0;
  return (
    <>
      <PageHeader title="Announcements" sub="Also posted to the staff community" actions={can("people", "create") && <Button variant="primary" icon="plus" onClick={() => navigate("/community?tab=announcements")}>New Announcement</Button>} />
      <KpiTiles items={[{ label: "Published", value: String(pub.length) }, { label: "Scheduled", value: String(list.rows.length - pub.length) }, { label: "Average Read", value: `${avg}%`, tone: "ok" }, { label: "This Quarter", value: String(list.page?.total ?? 0) }]} />
      <PagedTable<Announcement>
        title="Announcements"
        list={list}
        search="Search announcements"
        rowKey={(a) => a.announcement_id}
        noun="announcement"
        columns={[
          { key: "t", label: "Title", render: (a) => <span className="font-semibold">{a.title}</span> },
          { key: "b", label: "Posted By", render: (a) => a.author.display_name, desktop: true },
          { key: "d", label: "Date", render: (a) => formatDate(a.publish_at) },
          { key: "a", label: "Audience", render: () => "Everyone", desktop: true },
          { key: "r", label: "Read", align: "n", render: (a) => (a.scheduled ? "None yet" : `${a.reads} of ${a.audience}`) },
          { key: "s", label: "Status", render: (a) => (a.scheduled ? <Pill>Scheduled {formatDate(a.publish_at)}</Pill> : <Pill tone="ok">Published</Pill>) },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <KvCard
          title="The Same Announcement, Two Places"
          items={[
            ["Here", "The permanent record, with read counts"],
            ["#announcements", "The channel, read only, so it appears where people already are"],
            ["Notification", "In app, and by email if the person has that switched on"],
            ["Who can post", "People, and the CEO. Nobody else"],
            ["Editing", "A published announcement can be corrected. The edit is logged"],
            ["Scheduling", "Dated forward, and released on the day"],
          ]}
        />
        <TrailCard title="Recent" items={pub.slice(0, 4).map((a) => ({ title: a.title, when: formatDate(a.publish_at), text: `Posted by ${a.author.display_name}. ${a.reads} of ${a.audience} have read it.`, tone: a.reads === a.audience ? "ok" : "hi" }))} />
      </Grid>
    </>
  );
}

