import knowledge from "@mycity/contract/schemas/knowledge.js";
import type { Sop, SopDraftSave, SopDraftSuggestion, SopRow, SopStep, SopVersion, SopVersionRow } from "@mycity/contract/contract.gen.ts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { useFileViewer } from "@/features/shared/files";
import { paging } from "@/features/shared/wire";
import { hrefFor, moduleKeyOf, useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { MODULES } from "@/shell/catalogue";
import {
  ActionGroup,
  Banner,
  Button,
  Card,
  CardHeader,
  ChoiceField,
  Chips,
  DataView,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  FormFooter,
  formatDate,
  Grid,
  IconButton,
  KeyValue,
  ListDetail,
  LoadingRows,
  Menu,
  PageHeader,
  Pill,
  RichText,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  UploadField,
  useContractForm,
  useIsPhone,
  useModal,
  useSideBySide,
  type ContractSchema,
} from "@mycity/ui";

/**
 * Knowledge Hub · SOPs (#63, `sops`; docs/guides/knowledge.md §2, §3, §10): each department's own
 * procedures. Everyone reads the published ones, chosen by department; an SOP opens beside the list
 * on desktop and in a sheet on a phone (F31) with its Purpose, Scope, Roles Involved and numbered
 * Steps (who does each, the screen it happens on, its file) and its versions. A writer (the
 * department's head, or Manage SOPs; the server decides, §6.2) also sees the Draft and Archived
 * chips, starts an SOP, edits its draft with Draft With AI, publishes it with a note from Version 2
 * and archives it.
 */

type State = "published" | "draft" | "archived";
const STATES: Array<[State, string]> = [
  ["published", "Published"],
  ["draft", "Draft"],
  ["archived", "Archived"],
];
const STATE_PILL: Record<SopRow["state"], { tone: "ok" | "info" | "neutral"; text: string }> = {
  published: { tone: "ok", text: "Published" },
  draft: { tone: "info", text: "Draft" },
  archived: { tone: "neutral", text: "Archived" },
};

/** What a refusal says, or a plain retry when the server could not be reached. */
const sayRefusal = (e: unknown, fallback: string) => toast.error(e instanceof ApiError && e.status !== 0 && e.message ? e.message : fallback);

/** Every screen of the hub a step may happen on, as `<module>/<tab>` with its name ("People · Employees"). */
const SCREEN_OPTIONS: Array<[string, string]> = MODULES.flatMap((m) => m.tabs.map((t) => [`${m.key}/${t.slug}`, `${m.label} · ${t.label}`] as [string, string]));

/** The type a file's name says, for the viewer: a PDF, a picture or a video is shown, anything else downloaded. */
function mimeOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (ext === "mp4") return "video/mp4";
  return "application/octet-stream";
}

export function SopsTab({ id }: { id: string | null }) {
  const modal = useModal();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>("published");
  const [department, setDepartment] = useState("");
  // The departments the reader writes for: none for most staff, who see no writer's controls.
  const writable = useInfinite("GET /api/v1/knowledge/sops/departments", { filters: { writable: "true" } });
  const writer = (writable.page?.total ?? 0) > 0;
  const chips = useApi("GET /api/v1/knowledge/sops/departments", { query: {} });
  const shownState: State = writer ? state : "published";
  const list = usePaged("GET /api/v1/knowledge/sops", { filters: { state: shownState, ...(department ? { department_id: department } : {}) } });
  const beside = useSideBySide();
  const linkedId = id ?? params.get("id");
  const [picked, setPicked] = useState<string | null>(null);
  const [closedLink, setClosedLink] = useState(false);
  const pinned = picked ?? (!closedLink && linkedId ? linkedId : null);
  // Side by side the first SOP shows unasked; on a phone nothing opens until a row is tapped (F31).
  const sel = pinned ?? (beside ? (list.rows[0]?.sop_id ?? null) : null);

  const start = () => modal.open({ title: "New SOP", body: (close) => <NewSopForm close={close} onStarted={(sopId) => (setPicked(sopId), setState("draft"))} /> });
  useScreenAction(writer ? { label: "New SOP", onSelect: start } : null);

  const departmentOptions: Array<[string, string]> = [["", "All"], ...(chips.data?.data ?? []).map((d) => [d.department_id, d.name] as [string, string])];

  return (
    <>
      <PageHeader
        title="SOPs"
        sub="Each department's own procedures"
        actions={
          writer && (
            <Button variant="primary" icon="plus" onClick={start}>
              New SOP
            </Button>
          )
        }
      />
      <ListDetail
        open={pinned !== null}
        onClose={() => (setPicked(null), setClosedLink(true))}
        title="SOP"
        list={
          <>
            {departmentOptions.length > 1 && <Chips label="Department" value={department} onChange={setDepartment} options={departmentOptions} />}
            {writer && <Chips label="State" value={state} onChange={setState} options={STATES} />}
            <DataView
              title="SOPs"
              list={list}
              search="Search SOPs"
              rowKey={(r) => r.sop_id}
              selectedKey={sel ?? undefined}
              onRowClick={(r) => setPicked(r.sop_id)}
              noun="SOP"
              nounPlural="SOPs"
              empty={{ icon: "book", title: "No SOPs Here", text: writer ? "Start one with New SOP." : "Published procedures appear here." }}
              columns={[
                { key: "title", label: "SOP", sortable: true, render: (r) => <span data-copy="content" className="font-semibold">{r.title}</span> },
                { key: "d", label: "Department", render: (r) => <span data-copy="content">{r.department_name}</span> },
                { key: "v", label: "Version", render: (r) => (r.version ? `Version ${r.version}` : <Pill tone="info">Draft</Pill>) },
                { key: "updated_at", label: "Updated", desktop: true, sortable: true, render: (r) => formatDate(r.updated_at) },
              ]}
            />
          </>
        }
        detail={
          sel ? (
            <SopRecord key={sel} id={sel} onGone={() => (setPicked(null), setClosedLink(true))} />
          ) : (
            <Card>
              <p className="text-xs text-subtle-foreground">Pick an SOP to read it.</p>
            </Card>
          )
        }
      />
    </>
  );
}

/* ───────────── New SOP ───────────── */

function NewSopForm({ close, onStarted }: { close: () => void; onStarted: (sopId: string) => void }) {
  const departments = useInfinite("GET /api/v1/knowledge/sops/departments", { filters: { writable: "true" } });
  const create = useMutation("POST /api/v1/knowledge/sops");
  const only = departments.page?.total === 1 ? (departments.rows[0]?.department_id ?? "") : "";
  const f = useContractForm({ department_id: only, title: "" }, knowledge.SopCreate);
  const options = departments.rows.map((d) => [d.department_id, d.name] as [string, string]);
  // A head writes for one department: it is chosen for them once the list has loaded.
  const { set } = f;
  const picked = f.values.department_id;
  useEffect(() => {
    if (only && !picked) set("department_id", only);
  }, [only, picked, set]);
  const send = async () => {
    if (!f.check()) return;
    try {
      const sop = await create.run({ body: { department_id: f.values.department_id, title: f.values.title.trim() } });
      invalidate("/api/v1/knowledge/sops");
      close();
      toast("SOP started");
      onStarted(sop.sop_id);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else sayRefusal(e, "SOP not started. Try again.");
    }
  };
  return (
    <>
      <Field label="Department" {...f.status("department_id")}>
        <SelectField {...f.field("department_id")} options={options} placeholder="Choose One" {...paging(departments)} />
      </Field>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="Campaign Launch" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Start SOP
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── One SOP ───────────── */

function SopRecord({ id, onGone }: { id: string; onGone: () => void }) {
  const modal = useModal();
  const phone = useIsPhone();
  const read = useApi("GET /api/v1/knowledge/sops/:id", { params: { id } });
  const discard = useMutation("POST /api/v1/knowledge/sops/:id/draft/discard");
  const files = useFileViewer();
  const s = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!s)
    return (
      <Card>
        <LoadingRows count={6} />
      </Card>
    );

  const pill = STATE_PILL[s.state];
  const shown = s.in_force ?? s.draft;
  const edit = () => modal.open({ title: "Edit SOP", side: true, full: true, body: (close) => <SopEditor sop={s} close={close} /> });
  const publish = () => modal.open({ title: "Publish SOP", body: (close) => <PublishForm sop={s} close={close} /> });
  const archive = () => modal.open({ title: "Archive SOP", body: (close) => <ArchiveForm sop={s} close={close} onArchived={onGone} /> });
  const drop = async () => {
    try {
      await discard.run({ params: { id: s.sop_id }, body: {} });
      invalidate("/api/v1/knowledge/sops");
      toast("Draft discarded");
    } catch (e) {
      sayRefusal(e, "Draft not discarded. Try again.");
    }
  };
  const openFile = (step: SopStep) =>
    step.document_id && files.view(`/api/v1/documents/${step.document_id}/content`, { name: step.document_name ?? "File", mime: mimeOf(step.document_name ?? "") });

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader title={s.title} record actions={<Pill tone={pill.tone}>{pill.text}</Pill>} />
        <KeyValue
          items={[
            ["Number", s.number],
            ["Department", s.department_name],
            ["Version", s.in_force ? `Version ${s.in_force.version}` : null],
            ["Updated", s.in_force ? formatDate(s.in_force.published_at) : null],
            ...(s.archive_reason ? ([["Archived", s.archive_reason]] as Array<[string, string]>) : []),
          ]}
        />
        {(s.can_edit || s.can_archive) && (
          <div className="mt-3 flex flex-wrap gap-2 phone:flex-col phone:items-stretch">
            <ActionGroup>
              {s.can_edit && (
                <Button variant={s.draft ? "default" : "primary"} icon="edit" onClick={edit}>
                  Edit SOP
                </Button>
              )}
              {s.can_archive && (
                <Button variant="danger" onClick={archive}>
                  Archive SOP
                </Button>
              )}
            </ActionGroup>
          </div>
        )}
      </Card>

      {s.can_edit && s.draft && (
        <Banner
          tone="info"
          action={
            <ActionGroup>
              <Button size="sm" onClick={drop}>
                Discard Changes
              </Button>
              <Button size="sm" variant="primary" onClick={publish}>
                Publish SOP
              </Button>
            </ActionGroup>
          }
        >
          {s.draft.has_changes ? "Draft saved, not published." : "The draft matches the version in force."}
        </Banner>
      )}

      {shown ? (
        <SopContent content={shown} onFile={openFile} />
      ) : (
        <Card>
          <EmptyState icon="book" title="Nothing Written Yet" text="Press Edit SOP to write it." />
        </Card>
      )}

      {s.in_force &&
        (phone ? (
          <Button icon="history" onClick={() => modal.open({ title: "Versions", full: true, body: <Versions sopId={s.sop_id} /> })}>
            Versions
          </Button>
        ) : (
          <Card>
            <CardHeader title="Versions" />
            <Versions sopId={s.sop_id} />
          </Card>
        ))}
      {files.viewer}
    </div>
  );
}

type Content = Pick<SopVersion, "purpose" | "scope" | "roles" | "steps"> | Pick<NonNullable<Sop["draft"]>, "purpose" | "scope" | "roles" | "steps">;

/** What staff read: Purpose, Scope, Roles Involved and the numbered Steps. */
function SopContent({ content, onFile }: { content: Content; onFile?: (step: SopStep) => void }) {
  const { navigate } = useRouter();
  const open = (key: string) => {
    const [module, tab] = key.split("/");
    navigate(hrefFor(moduleKeyOf(module ?? ""), tab));
  };
  return (
    <>
      <Card>
        <CardHeader title="Purpose" level={3} />
        <p data-copy="content" className="text-sm text-foreground">
          {content.purpose || "None yet"}
        </p>
        {content.scope && (
          <>
            <h4 data-ui="title" className="mt-3 text-xs font-strong text-subtle-foreground">
              Scope
            </h4>
            <p data-copy="content" className="text-sm text-foreground">
              {content.scope}
            </p>
          </>
        )}
        {content.roles.length > 0 && (
          <>
            <h4 data-ui="title" className="mt-3 text-xs font-strong text-subtle-foreground">
              Roles Involved
            </h4>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {content.roles.map((r) => (
                <Pill key={r}>{r}</Pill>
              ))}
            </div>
          </>
        )}
      </Card>
      <Card>
        <CardHeader title="Steps" level={3} />
        {content.steps.length === 0 ? (
          <p className="text-xs text-subtle-foreground">No steps yet.</p>
        ) : (
          <ol className="grid gap-3">
            {content.steps.map((step) => (
              <li key={step.position} className="flex gap-3">
                <span className="flex size-7 flex-none items-center justify-center rounded-ctl bg-accent text-xs font-strong text-accent-foreground">{step.position}</span>
                <div className="min-w-0 flex-1" data-copy="content">
                  <RichText blocks={step.blocks} top={4} />
                  {(step.who || step.screen_label || step.document_id) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {step.who && <Pill tone="info">{step.who}</Pill>}
                      {step.screen_key && step.screen_label && (
                        <Button size="sm" icon="external" onClick={() => open(step.screen_key as string)}>
                          Open Screen
                        </Button>
                      )}
                      {step.document_id && onFile && (
                        <Button size="sm" icon="doc" onClick={() => onFile(step)}>
                          {step.document_name ?? "File"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

/** An SOP's versions, newest first; one opens to be read as it was published. */
function Versions({ sopId }: { sopId: string }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/knowledge/sops/:id/versions", { params: { id: sopId } });
  const open = (r: SopVersionRow) => modal.open({ title: `Version ${r.version}`, full: true, wide: true, body: <VersionReader id={r.sop_version_id} /> });
  return (
    <DataView
      list={list}
      rowKey={(r) => r.sop_version_id}
      onRowClick={open}
      noun="version"
      columns={[
        { key: "v", label: "Version", render: (r) => `Version ${r.version}` },
        { key: "p", label: "Published", render: (r) => formatDate(r.published_at) },
        { key: "b", label: "By", desktop: true, render: (r) => r.published_by_name ?? null },
        { key: "n", label: "Note", render: (r) => (r.note ? <span data-copy="content">{r.note}</span> : null) },
      ]}
    />
  );
}

function VersionReader({ id }: { id: string }) {
  const read = useApi("GET /api/v1/knowledge/sops/versions/:id", { params: { id } });
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  const v = read.data;
  return (
    <div className="grid gap-3">
      <KeyValue
        items={[
          ["Title", v.title],
          ["Published", formatDate(v.published_at)],
          ["By", v.published_by_name],
          ["Note", v.note],
        ]}
      />
      <SopContent content={v} />
    </div>
  );
}

/* ───────────── Publish and archive ───────────── */

function PublishForm({ sop, close }: { sop: Sop; close: () => void }) {
  const publish = useMutation("POST /api/v1/knowledge/sops/:id/publish");
  const later = Boolean(sop.in_force);
  const f = useContractForm({ note: "" }, knowledge.SopPublish);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    if (later && !f.values.note.trim()) {
      f.setServerErrors({ note: ["Required"] });
      return;
    }
    if (!f.check()) return;
    try {
      const s = await publish.run({ params: { id: sop.sop_id }, body: f.values.note.trim() ? { note: f.values.note.trim() } : {} });
      invalidate("/api/v1/knowledge/sops");
      close();
      toast(`Version ${s.in_force?.version ?? 1} published`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).some((k) => k === "note")) f.setServerErrors(e.fields);
      else setProblem(e instanceof ApiError && e.status !== 0 && e.message ? e.message : "Not published. Try again.");
    }
  };
  return (
    <>
      <Field label="Note" optional={!later} help="What changed, for the version's history." {...f.status("note")}>
        <TextAreaField {...f.field("note")} rows={3} placeholder="Added a step" />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Publish SOP
        </Button>
      </FormFooter>
    </>
  );
}

function ArchiveForm({ sop, close, onArchived }: { sop: Sop; close: () => void; onArchived: () => void }) {
  const archive = useMutation("POST /api/v1/knowledge/sops/:id/archive");
  const f = useContractForm({ reason: "" }, knowledge.SopReason);
  const send = async () => {
    if (!f.check()) return;
    try {
      await archive.run({ params: { id: sop.sop_id }, body: { reason: f.values.reason.trim() } });
      invalidate("/api/v1/knowledge/sops");
      close();
      toast("SOP archived");
      onArchived();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else sayRefusal(e, "Not archived. Try again.");
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} placeholder="Process replaced" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={send}>
          Archive SOP
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── The draft ───────────── */

/**
 * The editor's values: the SOP's fields, and each step's by a key that stays with it as steps
 * move (`text_<key>`, `who_<key>`, `screen_<key>`, `file_<key>`, `fname_<key>`), in `order`.
 */
type Values = { title: string; purpose: string; scope: string; roles: string; order: string[] } & Record<string, unknown>;

let seq = 0;
const newKey = () => `s${(seq += 1)}`;

function stepValues(steps: Array<Partial<SopStep> & { text: string }>) {
  const order: string[] = [];
  const out: Record<string, string> = {};
  for (const s of steps) {
    const k = newKey();
    order.push(k);
    out[`text_${k}`] = s.text;
    out[`who_${k}`] = s.who ?? "";
    out[`screen_${k}`] = s.screen_key ?? "";
    out[`file_${k}`] = s.document_id ?? "";
    out[`fname_${k}`] = s.document_name ?? "";
  }
  return { order, ...out };
}

/** The draft's fields, else the version in force's, else the SOP's title alone. */
function valuesOf(sop: Sop): Values {
  const base = sop.draft ?? sop.in_force;
  return {
    title: base?.title ?? sop.title,
    purpose: base?.purpose ?? "",
    scope: base?.scope ?? "",
    roles: (base?.roles ?? []).join("\n"),
    ...stepValues(base?.steps ?? []),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The body Save Draft sends: a role a line, the steps in order, an empty optional left out. */
function bodyOf(v: Values): SopDraftSave {
  return {
    title: v.title.trim(),
    purpose: v.purpose,
    scope: v.scope,
    roles: v.roles
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean),
    steps: v.order.map((k) => {
      const who = str(v[`who_${k}`]).trim();
      const screen = str(v[`screen_${k}`]);
      const file = str(v[`file_${k}`]);
      return { text: str(v[`text_${k}`]), ...(who ? { who } : {}), ...(screen ? { screen_key: screen } : {}), ...(file ? { document_id: file } : {}) };
    }),
  };
}

/** Where a contract problem sits in the form: a step's field by its key, a role on Roles Involved. */
function fieldOf(order: string[], path: ReadonlyArray<PropertyKey>): string {
  const [head, i, field] = path;
  if (head === "steps" && typeof i === "number") {
    const k = order[i] ?? "";
    return field === "who" ? `who_${k}` : field === "screen_key" ? `screen_${k}` : field === "document_id" ? `file_${k}` : `text_${k}`;
  }
  if (head === "steps") return "order";
  return String(head ?? "");
}

/** The contract's Save Draft schema over the form: its marks land on the field that holds each value. */
const draftSchema: ContractSchema = {
  safeParse: (value: unknown) => {
    const v = value as Values;
    const r = knowledge.SopDraftSave.safeParse(bodyOf(v));
    if (r.success) return r;
    return { success: false, error: { issues: (r.error?.issues ?? []).map((i: { path: PropertyKey[]; message: string }) => ({ ...i, path: [fieldOf(v.order, i.path)] })) } };
  },
};

/** A server 422's fields (`steps.1.screen_key`) on the form's own keys. */
const serverFields = (order: string[], fields: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(fields).map(([k, m]) => [fieldOf(order, k.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p))), m]));

function SopEditor({ sop, close }: { sop: Sop; close: () => void }) {
  const save = useMutation("PUT /api/v1/knowledge/sops/:id/draft");
  const initial = useMemo(() => valuesOf(sop), [sop]);
  const f = useContractForm<Values>(initial, draftSchema);
  const [mode, setMode] = useState<"form" | "ai" | "compare">("form");
  const [suggestion, setSuggestion] = useState<SopDraftSuggestion | null>(null);
  const v = f.values;

  const setOrder = (order: string[]) => f.set("order", order);
  const addStep = () => {
    const k = newKey();
    f.setValues((p) => ({ ...p, [`text_${k}`]: "", [`who_${k}`]: "", [`screen_${k}`]: "", [`file_${k}`]: "", [`fname_${k}`]: "", order: [...p.order, k] }));
  };
  const move = (k: string, by: -1 | 1) => {
    const i = v.order.indexOf(k);
    const j = i + by;
    if (j < 0 || j >= v.order.length) return;
    const next = [...v.order];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setOrder(next);
  };
  const remove = (k: string) => setOrder(v.order.filter((x) => x !== k));

  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: sop.sop_id }, body: bodyOf(f.values) });
      invalidate("/api/v1/knowledge/sops");
      close();
      toast("Draft saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(serverFields(f.values.order, e.fields));
      else sayRefusal(e, "Draft not saved. Try again.");
    }
  };

  const takeDraft = (s: SopDraftSuggestion) => {
    f.setValues((p) => ({
      ...p,
      title: s.title,
      purpose: s.purpose,
      scope: s.scope ?? "",
      roles: s.roles.join("\n"),
      ...stepValues(s.steps.map((x) => ({ text: x.text, who: x.who }))),
    }));
    setMode("form");
    toast("Draft placed in the form");
  };

  if (mode === "ai") return <DraftWithAi sop={sop} back={() => setMode("form")} onDrafted={(s) => (setSuggestion(s), setMode("compare"))} />;
  if (mode === "compare" && suggestion)
    return (
      <>
        <Grid cols={2}>
          <Card>
            <CardHeader title="Yours" level={3} />
            <Outline title={v.title} purpose={v.purpose} roles={bodyOf(v).roles} steps={v.order.map((k) => ({ text: str(v[`text_${k}`]), who: str(v[`who_${k}`]) || null }))} />
          </Card>
          <Card>
            <CardHeader title="Drafted" level={3} />
            <Outline title={suggestion.title} purpose={suggestion.purpose} roles={suggestion.roles} steps={suggestion.steps} />
          </Card>
        </Grid>
        <FormFooter>
          <Button onClick={() => setMode("form")}>Keep Mine</Button>
          <Button variant="primary" onClick={() => takeDraft(suggestion)}>
            Use This Draft
          </Button>
        </FormFooter>
      </>
    );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button icon="spark" onClick={() => setMode("ai")}>
          Draft With AI
        </Button>
      </div>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} />
      </Field>
      <Field label="Purpose" {...f.status("purpose")}>
        <TextAreaField {...f.field("purpose")} rows={3} />
      </Field>
      <Field label="Scope" optional {...f.status("scope")}>
        <TextAreaField {...f.field("scope")} rows={2} />
      </Field>
      <Field label="Roles Involved" optional help="One role a line, up to 10." {...f.status("roles")}>
        <TextAreaField {...f.field("roles")} rows={3} placeholder="Campaign Lead" />
      </Field>

      <h3 data-ui="title" className="mb-2 mt-4 text-md font-strong text-foreground">
        Steps
      </h3>
      {v.order.length === 0 && <p className="mb-2 text-xs text-subtle-foreground">No steps yet.</p>}
      <ol className="grid gap-3">
        {v.order.map((k, i) => (
          <StepEditor key={k} index={i} stepKey={k} f={f} last={i === v.order.length - 1} onMove={(by) => move(k, by)} onRemove={() => remove(k)} />
        ))}
      </ol>
      {f.errors.order && <FormError>{String(f.errors.order)}</FormError>}
      {v.order.length < 50 && (
        <Button className="mt-3" icon="plus" onClick={addStep}>
          Add Step
        </Button>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Save Draft
        </Button>
      </FormFooter>
    </>
  );
}

type Form = ReturnType<typeof useContractForm<Values>>;

function StepEditor({ index, stepKey: k, f, last, onMove, onRemove }: { index: number; stepKey: string; f: Form; last: boolean; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const file = str(f.values[`file_${k}`]);
  const name = str(f.values[`fname_${k}`]);
  const items = [
    ...(index > 0 ? [{ label: "Move Up", icon: "up" as const, onSelect: () => onMove(-1) }] : []),
    ...(!last ? [{ label: "Move Down", icon: "down" as const, onSelect: () => onMove(1) }] : []),
    "sep" as const,
    { label: "Remove Step", icon: "trash" as const, danger: true, onSelect: onRemove },
  ];
  return (
    <li>
      <Card>
        <CardHeader title={`Step ${index + 1}`} level={4} actions={<Menu label="Step Actions" trigger={(p) => <IconButton {...p} icon="dots" label={`Step ${index + 1} Actions`} />} items={items} />} />
        <Field label="Step" {...f.status(`text_${k}`)}>
          <TextAreaField {...(f.field(`text_${k}`) as ReturnType<Form["field"]> & { value: string })} rows={3} />
        </Field>
        <Field label="Who" optional {...f.status(`who_${k}`)}>
          <TextField {...(f.field(`who_${k}`) as ReturnType<Form["field"]> & { value: string })} placeholder="Campaign Lead" />
        </Field>
        <Field label="Screen" optional help="The hub's screen this step happens on. The SOP is listed under Procedures in that screen's help." {...f.status(`screen_${k}`)}>
          <SelectField {...(f.field(`screen_${k}`) as ReturnType<Form["field"]> & { value: string })} options={SCREEN_OPTIONS} placeholder="None" searchable />
        </Field>
        <Field label="File" optional {...f.status(`file_${k}`)}>
          {file ? (
            <div className="flex flex-wrap items-center gap-2">
              <Pill>{name || "File"}</Pill>
              <Button size="sm" onClick={() => (f.set(`file_${k}`, ""), f.set(`fname_${k}`, ""))}>
                Remove File
              </Button>
            </div>
          ) : (
            <UploadField
              purpose="document"
              upload={upload}
              multiple={false}
              compact
              onUploaded={(docs) => {
                f.set(`file_${k}`, docs[0]?.document_id ?? "");
                f.set(`fname_${k}`, docs[0]?.file_name ?? "");
              }}
            />
          )}
        </Field>
      </Card>
    </li>
  );
}

/** A step's words without their Markdown marks, for an outline. */
const plain = (md: string) => md.replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_, b: string | undefined, i: string | undefined) => b ?? i ?? "");

/** A draft at a glance, for Yours beside Drafted. */
function Outline({ title, purpose, roles, steps }: { title: string; purpose: string; roles: string[]; steps: Array<{ text: string; who: string | null }> }) {
  return (
    <div data-copy="content" className="grid gap-2 text-sm">
      <p className="font-strong text-foreground">{title}</p>
      <p className="text-muted-foreground">{purpose}</p>
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <Pill key={r}>{r}</Pill>
          ))}
        </div>
      )}
      <ol className="grid list-decimal gap-1 pl-5">
        {steps.map((s, i) => (
          <li key={i}>
            {plain(s.text)}
            {s.who ? ` (${s.who})` : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Draft With AI's source: a procedure pasted, or a PDF; the answer comes back beside the form. */
function DraftWithAi({ sop, back, onDrafted }: { sop: Sop; back: () => void; onDrafted: (s: SopDraftSuggestion) => void }) {
  const draft = useMutation("POST /api/v1/knowledge/sops/draft-with-ai");
  const [from, setFrom] = useState<"text" | "pdf">("text");
  const f = useContractForm({ text: "", document_id: "" }, { text: (t: string) => (from === "text" && t.trim().length < 20 ? "Paste the procedure" : null), document_id: (d: string) => (from === "pdf" && !d ? "Pick a PDF" : null) });
  const send = async () => {
    if (!f.check()) return;
    try {
      const s = await draft.run({ body: { department_id: sop.department_id, ...(from === "text" ? { text: f.values.text } : { document_id: f.values.document_id }) } });
      onDrafted(s);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else sayRefusal(e, "Draft With AI is unavailable right now.");
    }
  };
  const body: ReactNode =
    from === "text" ? (
      <Field label="Procedure" help="Its wording is kept; the steps are found in it." {...f.status("text")}>
        <TextAreaField {...f.field("text")} rows={10} />
      </Field>
    ) : (
      <Field label="PDF" {...f.status("document_id")}>
        <UploadField purpose="document" accept=".pdf,application/pdf" kinds="PDF" upload={upload} multiple={false} compact onUploaded={(docs) => f.set("document_id", docs[0]?.document_id ?? "")} />
      </Field>
    );
  return (
    <>
      <Field label="From">
        <ChoiceField
          label="From"
          value={from}
          onChange={setFrom}
          options={[
            ["text", "Pasted Text"],
            ["pdf", "PDF File"],
          ]}
        />
      </Field>
      {body}
      <FormFooter>
        <Button onClick={back}>Cancel</Button>
        <Button variant="primary" icon="spark" onClick={send}>
          Draft With AI
        </Button>
      </FormFooter>
    </>
  );
}
