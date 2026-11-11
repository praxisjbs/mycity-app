import training from "@mycity/contract/schemas/training.js";
import type { Assignment, Course, CourseRow, CourseState, Department, EnrolmentRow, EnrolmentStatus, ItemCreate, ItemKind, RoleOption, TrainingItem } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { usePhotos } from "@/api/download";
import { upload } from "@/api/upload";
import { useAuth } from "@/auth/AuthProvider";
import { DepartmentPicker, EmployeePicker } from "@/features/shared/pickers";
import { withSignature } from "@/features/shared/signature";
import type { PersonRef } from "@/api/types/common";
import { useScreenAction } from "@/shell/screen-action";
import { ItemLine, minutesText, STATE_PILL, STATUS_PILL } from "./training-labels";
import {
  ActionGroup,
  Banner,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  ChoiceField,
  Chips,
  DataView,
  EmptyState,
  ErrorState,
  Field,
  FileRow,
  formatDate,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  ListDetail,
  LoadingRows,
  Menu,
  Meter,
  NumberField,
  OrderList,
  PageHeader,
  Pill,
  RecordPicker,
  RichTextField,
  SegmentedControl,
  SignatureField,
  TextAreaField,
  TextField,
  toast,
  ToggleRow,
  UploadField,
  useConfirm,
  useContractForm,
  useIsPhone,
  useModal,
  Who,
  type ContractSchema,
  type IconName,
  type SignatureFieldHandle,
} from "@mycity/ui";

/**
 * Knowledge Hub · Training (docs/guides/knowledge.md §2, §3, §6.5 to §6.7, §10), for
 * `training.manage`: every course with its state, and one course opened beside the list (a sheet
 * on a phone): its Items in order (drag on desktop, Move Up and Move Down in each item's menu),
 * its People and where each stands, its Assignments, and its Settings. Publish Course takes the
 * publisher's signature; Assign Training reaches everyone, departments, roles or people.
 * `?id=` opens a course (⌘K, a notice).
 */

const STATE_FILTER: ReadonlyArray<["" | CourseState, string]> = [
  ["", "All"],
  ["draft", "Draft"],
  ["published", "Published"],
  ["archived", "Archived"],
];

/** A refusal on a form: its fields' marks, or the reason as a toast. */
const failed = (e: unknown, fallback: string, setFields?: (f: Record<string, string[]>) => void) => {
  if (e instanceof ApiError && Object.keys(e.fields).length && setFields) setFields(e.fields);
  else toast.error(e instanceof ApiError ? e.message : fallback);
};
const refresh = () => invalidate("/api/v1/training");

export function TrainingTab({ id }: { id: string | null }) {
  const { can } = useAuth();
  const modal = useModal();
  const phone = useIsPhone();
  const [state, setState] = useState<"" | CourseState>("");
  const list = usePaged("GET /api/v1/training/courses", { filters: state ? { state } : {} });
  const [sel, setSel] = useState<string | null>(id);
  useEffect(() => setSel(id), [id]);
  const mayCreate = can("knowledge", "create");
  const create = () => modal.open({ title: "New Course", body: (close) => <NewCourseForm close={close} onCreated={setSel} /> });
  useScreenAction(mayCreate ? { label: "New Course", onSelect: create } : null);
  return (
    <>
      <PageHeader
        title="Training"
        sub="Courses, assignments and certificates"
        actions={
          mayCreate ? (
            <Button variant="primary" icon="plus" onClick={create}>
              New Course
            </Button>
          ) : undefined
        }
      />
      <Chips label="State" value={state} onChange={setState} options={STATE_FILTER} />
      <ListDetail
        open={sel !== null}
        onClose={() => setSel(null)}
        title="Course"
        cols="1/1.5"
        full
        fillUntilPicked
        list={
          <DataView<CourseRow>
            title="Courses"
            list={list}
            search="Search courses"
            rowKey={(r) => r.training_course_id}
            selectedKey={sel}
            onRowClick={(r) => setSel(r.training_course_id)}
            noun="course"
            wide
            empty={{ icon: "book", title: "No Courses Yet", text: "Build the first one." }}
            columns={[
              {
                key: "title",
                label: "Course",
                sortable: true,
                render: (r) => (
                  <span className="flex flex-col">
                    <span data-copy="content" className="font-semibold">
                      {r.title}
                    </span>
                    <span className="text-2xs text-subtle-foreground">{r.number}</span>
                  </span>
                ),
              },
              { key: "s", label: "State", badge: true, render: (r) => <Pill tone={STATE_PILL[r.state].tone}>{STATE_PILL[r.state].text}</Pill> },
              { key: "i", label: "Items", align: "n", desktop: true, render: (r) => r.items },
              { key: "l", label: "Library", desktop: true, render: (r) => (r.library ? "Library" : "Assigned Only") },
              { key: "a", label: "Assigned", align: "n", desktop: true, render: (r) => r.assigned },
              { key: "c", label: "Completed", align: "n", render: (r) => (phone ? `${r.completed} of ${r.assigned}` : r.completed) },
              { key: "o", label: "Overdue", render: (r) => (r.overdue ? <Pill tone="warn">{`${r.overdue} Overdue`}</Pill> : null) },
            ]}
          />
        }
        detail={sel ? <CourseRecord id={sel} /> : null}
      />
    </>
  );
}

function NewCourseForm({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const make = useMutation("POST /api/v1/training/courses");
  const f = useContractForm({ title: "", summary: "" }, training.CourseCreate);
  const send = async () => {
    if (!f.check()) return;
    try {
      const c = await make.run({ body: { title: f.values.title.trim(), ...(f.values.summary.trim() && { summary: f.values.summary.trim() }) } });
      refresh();
      close();
      onCreated(c.training_course_id);
      toast("Course created");
    } catch (e) {
      failed(e, "Course not created", f.setServerErrors);
    }
  };
  return (
    <>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="Fire Safety" />
      </Field>
      <Field label="Summary" optional {...f.status("summary")}>
        <TextAreaField {...f.field("summary")} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Create Course
        </Button>
      </FormFooter>
    </>
  );
}

type Section = "items" | "people" | "assignments" | "settings";

/** One course: its facts and actions, then Items, People, Assignments and Settings. */
function CourseRecord({ id }: { id: string }) {
  const { data: c, error, reload } = useApi("GET /api/v1/training/courses/:id", { params: { id } });
  const [section, setSection] = useState<Section>("items");
  const phone = useIsPhone();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!c || c.training_course_id !== id)
    return (
      <Card>
        <LoadingRows count={6} />
      </Card>
    );
  const pill = STATE_PILL[c.state];
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader record title={c.title} right={<Pill tone={pill.tone}>{pill.text}</Pill>} />
        {c.summary && (
          <p data-copy="content" className="mb-2.5 text-sm text-muted-foreground">
            {c.summary}
          </p>
        )}
        <KeyValue
          items={[
            ["Number", c.number],
            ["Items", c.items.length],
            ["Length", minutesText(c.minutes)],
            ["Published", c.published_at ? `${formatDate(c.published_at)}${c.published_by_name ? `, ${c.published_by_name}` : ""}` : null],
            ["Completed", c.counts.assigned ? `${c.counts.completed} of ${c.counts.assigned}` : null],
          ]}
        />
        {!phone && <CourseActions c={c} />}
      </Card>
      {c.state === "archived" && <Banner tone="info">{`Archived ${c.archived_at ? formatDate(c.archived_at) : ""}: ${c.archive_reason ?? ""}`}</Banner>}
      <SegmentedControl<Section>
        label="Show"
        value={section}
        onChange={setSection}
        options={[
          { value: "items", label: "Items", count: c.items.length },
          { value: "people", label: "People", count: c.counts.assigned },
          { value: "assignments", label: "Assignments" },
          { value: "settings", label: "Settings" },
        ]}
      />
      {section === "items" && <Items c={c} />}
      {section === "people" && <People c={c} />}
      {section === "assignments" && <Assignments c={c} />}
      {section === "settings" && <Settings key={`${c.training_course_id}:${c.state}`} c={c} />}
      {phone && <CourseActions c={c} />}
    </div>
  );
}

/** Publish Course or Assign Training, and Archive Course: at the card's foot on desktop, the sheet's on a phone. */
function CourseActions({ c }: { c: Course }) {
  const { can } = useAuth();
  const modal = useModal();
  const phone = useIsPhone();
  const publish = () => modal.open({ title: "Publish Course", body: (close) => <PublishForm c={c} close={close} /> });
  const assign = () => modal.open({ title: "Assign Training", full: true, body: (close) => <AssignForm c={c} close={close} /> });
  const archive = () => modal.open({ title: `Archive ${c.number}`, body: (close) => <ArchiveForm c={c} close={close} /> });
  const edit = can("knowledge", "edit");
  const main =
    c.state === "draft" && edit ? (
      <Button variant="primary" icon="signature" onClick={publish} block={phone}>
        Publish Course
      </Button>
    ) : c.state === "published" && edit ? (
      <Button variant="primary" icon="userplus" onClick={assign} block={phone}>
        Assign Training
      </Button>
    ) : null;
  const archivable = c.state !== "archived" && can("knowledge", "delete");
  if (!main && !archivable) return null;
  return (
    <ActionGroup>
      <div className="mt-3 flex flex-wrap justify-end gap-2 phone:flex-col-reverse">
        {archivable && (
          <Button variant="danger" onClick={archive} block={phone}>
            Archive Course
          </Button>
        )}
        {main}
      </div>
    </ActionGroup>
  );
}

function PublishForm({ c, close }: { c: Course; close: () => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const publish = useMutation("POST /api/v1/training/courses/:id/publish");
  const f = useContractForm({ signature: "" }, withSignature(training.CoursePublish, pad));
  const send = async () => {
    if (!f.check()) return;
    try {
      await publish.run({ params: { id: c.training_course_id }, body: { signature: pad.current?.toPng() ?? "" } });
      refresh();
      close();
      toast("Course published");
    } catch (e) {
      failed(e, "Not published, try again", f.setServerErrors);
    }
  };
  return (
    <>
      <Field label="Your Signature" help="Printed on every certificate of this course." {...f.status("signature")}>
        <SignatureField ref={pad} label="Your Signature" onChange={(ink) => f.set("signature", ink ? "drawn" : "")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Publish Course
        </Button>
      </FormFooter>
    </>
  );
}

function ArchiveForm({ c, close }: { c: Course; close: () => void }) {
  const archive = useMutation("POST /api/v1/training/courses/:id/archive");
  const f = useContractForm({ reason: "" }, training.CourseReason);
  const send = async () => {
    if (!f.check()) return;
    try {
      await archive.run({ params: { id: c.training_course_id }, body: { reason: f.values.reason.trim() } });
      refresh();
      close();
      toast("Course archived");
    } catch (e) {
      failed(e, "Not archived, try again", f.setServerErrors);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} placeholder="Replaced by 2027" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={send}>
          Archive Course
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Items ───────────── */

const ADD: ReadonlyArray<{ kind: ItemKind; label: string; icon: IconName }> = [
  { kind: "file", label: "Upload File", icon: "upload" },
  { kind: "video", label: "Video Link", icon: "video" },
  { kind: "link", label: "Course Link", icon: "external" },
  { kind: "lesson", label: "Lesson", icon: "book" },
];

function Items({ c }: { c: Course }) {
  const { can } = useAuth();
  const modal = useModal();
  const confirm = useConfirm();
  const order = useMutation("PUT /api/v1/training/courses/:id/order");
  const remove = useMutation("DELETE /api/v1/training/items/:id");
  const editable = c.state !== "archived" && can("knowledge", "edit");
  const open = (kind: ItemKind, it?: TrainingItem) =>
    modal.open({
      title: it ? "Edit Item" : (ADD.find((a) => a.kind === kind)?.label ?? "Add Item"),
      wide: kind === "lesson",
      full: kind === "lesson",
      body: (close) => <ItemForm c={c} kind={kind} it={it ?? null} close={close} />,
    });
  const move = async (key: string, to: number) => {
    const ids = c.items.map((i) => i.training_item_id).filter((x) => x !== key);
    ids.splice(to, 0, key);
    try {
      await order.run({ params: { id: c.training_course_id }, body: { item_ids: ids } });
      refresh();
    } catch (e) {
      failed(e, "Order not saved");
    }
  };
  const drop = async (it: TrainingItem) => {
    if (!(await confirm({ title: "Remove Item", body: "Its done marks go with it.", confirmLabel: "Remove Item", destructive: true }))) return;
    try {
      await remove.run({ params: { id: it.training_item_id } });
      refresh();
      toast("Item removed");
    } catch (e) {
      failed(e, "Item not removed");
    }
  };
  return (
    <Card>
      <CardHeader
        title="Items"
        actions={
          editable && (
            <Menu
              label="Add Item"
              items={ADD.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => open(a.kind) }))}
              trigger={(p) => (
                <Button {...p} size="sm" icon="plus">
                  Add Item
                </Button>
              )}
            />
          )
        }
      />
      <OrderList
        label="Course Items"
        items={c.items.map((it) => ({
          key: it.training_item_id,
          name: it.title,
          content: <ItemLine it={it} />,
          menu: editable
            ? [
                { label: "Edit Item", icon: "edit", onSelect: () => open(it.kind, it) },
                { label: "Remove Item", icon: "trash", danger: true, onSelect: () => void drop(it) },
              ]
            : undefined,
        }))}
        onMove={editable ? move : undefined}
        empty={<EmptyState bare icon="book" title="No Items Yet" text="Add a file, a video, a link or a lesson." />}
      />
    </Card>
  );
}

type ItemValues = { title: string; url: string; document_id: string; lesson_html: string; minutes: string };

/** The body ItemCreate takes for a kind, from the form's flat values. */
const itemBody = (kind: ItemKind, v: ItemValues) => {
  const minutes = v.minutes.trim() ? Number(v.minutes) : undefined;
  const base = { kind, title: v.title.trim(), ...(minutes !== undefined && { minutes }) };
  if (kind === "file") return { ...base, document_id: v.document_id };
  if (kind === "lesson") return { ...base, lesson_html: v.lesson_html };
  return { ...base, url: v.url.trim() };
};
const itemSchema = (kind: ItemKind): ContractSchema => ({ safeParse: (v: unknown) => training.ItemCreate.safeParse(itemBody(kind, v as ItemValues)) });

function ItemForm({ c, kind, it, close }: { c: Course; kind: ItemKind; it: TrainingItem | null; close: () => void }) {
  const add = useMutation("POST /api/v1/training/courses/:id/items");
  const save = useMutation("PATCH /api/v1/training/items/:id");
  const [file, setFile] = useState<string | null>(it?.document_name ?? null);
  const [step, setStep] = useState<"edit" | "source" | "compare">("edit");
  const [drafted, setDrafted] = useState("");
  const f = useContractForm<ItemValues>(
    { title: it?.title ?? "", url: it?.url ?? "", document_id: it?.document_id ?? "", lesson_html: it?.lesson_html ?? "", minutes: it?.minutes ? String(it.minutes) : "" },
    itemSchema(kind),
  );
  const send = async () => {
    if (!f.check()) return;
    const body = itemBody(kind, f.values) as ItemCreate;
    try {
      if (it) await save.run({ params: { id: it.training_item_id }, body });
      else await add.run({ params: { id: c.training_course_id }, body });
      refresh();
      close();
      toast(it ? "Item saved" : "Item added");
    } catch (e) {
      failed(e, "Item not saved", f.setServerErrors);
    }
  };
  if (kind === "lesson" && step === "source")
    return (
      <DraftLesson
        title={f.values.title}
        back={() => setStep("edit")}
        onDrafted={(html) => {
          setDrafted(html);
          setStep("compare");
        }}
      />
    );
  if (kind === "lesson" && step === "compare")
    return (
      <>
        <Grid cols={2}>
          <Field label="Yours">
            <RichTextField label="Yours" value={f.values.lesson_html} onChange={() => undefined} readOnly />
          </Field>
          <Field label="Drafted">
            <RichTextField label="Drafted" value={drafted} onChange={() => undefined} readOnly />
          </Field>
        </Grid>
        <FormFooter>
          <Button onClick={() => setStep("edit")}>Keep Mine</Button>
          <Button
            variant="primary"
            onClick={() => {
              f.set("lesson_html", drafted);
              setStep("edit");
            }}
          >
            Use Lesson
          </Button>
        </FormFooter>
      </>
    );
  return (
    <>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder={kind === "lesson" ? "Key Rules" : kind === "file" ? "Staff Handbook" : "Why Data Matters"} />
      </Field>
      {kind === "file" && (
        <Field label="File" {...f.status("document_id")}>
          {file && f.values.document_id ? (
            <FileRow
              name={file}
              action={
                <Button size="sm" onClick={() => (f.set("document_id", ""), setFile(null))}>
                  Replace File
                </Button>
              }
            />
          ) : (
            <UploadField
              purpose="attachment"
              multiple={false}
              upload={upload}
              kinds="PDF, slides, Word, pictures or MP4"
              accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.jpeg,.png,.webp,.mp4"
              onUploaded={(docs) => {
                const d = docs[0];
                if (!d) return;
                f.set("document_id", d.document_id);
                setFile(d.file_name);
              }}
            />
          )}
        </Field>
      )}
      {(kind === "video" || kind === "link") && (
        <Field label="Link" help={kind === "video" ? "A YouTube link plays in the course; any other opens in a new tab." : undefined} {...f.status("url")}>
          <TextField type="url" {...f.field("url")} placeholder="https://" />
        </Field>
      )}
      {kind === "lesson" && (
        <Field label="Lesson" {...f.status("lesson_html")}>
          <RichTextField label="Lesson" {...f.field("lesson_html")} />
        </Field>
      )}
      <Field label="Minutes" optional {...f.status("minutes")}>
        <NumberField {...f.field("minutes")} placeholder="10" className="w-28" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {kind === "lesson" && (
          <Button icon="spark" onClick={() => setStep("source")}>
            Draft Lesson
          </Button>
        )}
        <Button variant="primary" onClick={send}>
          {it ? "Save Item" : "Add Item"}
        </Button>
      </FormFooter>
    </>
  );
}

/** Draft Lesson: a pasted text or a PDF, sent to the Default job; the suggestion comes back to compare (§6.5). */
function DraftLesson({ title, back, onDrafted }: { title: string; back: () => void; onDrafted: (html: string) => void }) {
  const draft = useMutation("POST /api/v1/training/lesson-with-ai");
  const [pdf, setPdf] = useState<{ id: string; name: string } | null>(null);
  const bodyOf = (text: string) => ({ title: title.trim().length >= 2 ? title.trim() : "Lesson", ...(pdf ? { document_id: pdf.id } : { text: text.trim() || undefined }) });
  const f = useContractForm({ text: "" }, { safeParse: (v: unknown) => training.LessonWithAi.safeParse(bodyOf((v as { text: string }).text)) });
  const send = async () => {
    if (!f.check()) return;
    try {
      const out = await draft.run({ body: bodyOf(f.values.text) });
      onDrafted(out.lesson_html);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) toast.error("Draft Lesson is unavailable");
      else failed(e, "Draft Lesson is unavailable", f.setServerErrors);
    }
  };
  return (
    <>
      {pdf ? (
        <Field label="Source PDF">
          <FileRow name={pdf.name} action={<Button size="sm" onClick={() => setPdf(null)}>Remove File</Button>} />
        </Field>
      ) : (
        <>
          <Field label="Source Text" {...f.status("text")}>
            <TextAreaField {...f.field("text")} rows={8} />
          </Field>
          <Field label="Or a PDF" optional>
            <UploadField purpose="attachment" multiple={false} upload={upload} accept=".pdf" kinds="PDF" compact onUploaded={(docs) => docs[0] && setPdf({ id: docs[0].document_id, name: docs[0].file_name })} />
          </Field>
        </>
      )}
      <FormFooter>
        <Button onClick={back}>Back</Button>
        <Button variant="primary" icon="spark" onClick={send}>
          Draft Lesson
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── People ───────────── */

const STATUS_FILTER: ReadonlyArray<["" | EnrolmentStatus, string]> = [
  ["", "Everyone"],
  ["not_started", "Not Started"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["overdue", "Overdue"],
];

function People({ c }: { c: Course }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<"" | EnrolmentStatus>("");
  const list = usePaged("GET /api/v1/training/courses/:id/people", { params: { id: c.training_course_id }, filters: status ? { status } : {} });
  const photo = usePhotos(list.rows.map((r) => r.person.photo_url));
  const remind = useMutation("POST /api/v1/training/courses/:id/remind");
  const nudge = async () => {
    try {
      const r = await remind.run({ params: { id: c.training_course_id }, body: {} });
      toast(r.reminded ? `Reminded ${r.reminded} ${r.reminded === 1 ? "person" : "people"}` : "Everyone was reminded today");
    } catch (e) {
      failed(e, "Nobody reminded, try again");
    }
  };
  return (
    <>
      <Chips label="Status" value={status} onChange={setStatus} options={STATUS_FILTER} />
      <DataView<EnrolmentRow>
        title="People"
        list={list}
        search="Search people"
        rowKey={(r) => r.training_enrolment_id}
        noun="person"
        nounPlural="people"
        wide
        actions={
          c.counts.overdue > 0 &&
          can("knowledge", "edit") && (
            <Button size="sm" icon="bell" onClick={nudge}>
              Remind Overdue
            </Button>
          )
        }
        empty={{ icon: "users", title: "Nobody Here Yet", text: "Assign the course to start." }}
        columns={[
          { key: "p", label: "Employee", render: (r) => <Who name={r.person.display_name} sub={r.person.job_title} src={photo(r.person.photo_url)} /> },
          { key: "s", label: "Status", badge: true, render: (r) => <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].text}</Pill> },
          { key: "d", label: "Department", desktop: true, render: (r) => r.person.department },
          { key: "due_on", label: <HelpTerm help="The date it was set for.">Due</HelpTerm>, sortLabel: "Due", sortable: true, render: (r) => (r.due_on ? formatDate(r.due_on) : null) },
          {
            key: "g",
            label: "Progress",
            render: (r) => (
              <span className="block w-32">
                <Meter pct={r.items_total ? Math.round((r.items_done * 100) / r.items_total) : 0} label={`${r.items_done} of ${r.items_total}`} name={`${r.person.display_name}'s progress`} />
              </span>
            ),
          },
          { key: "completed_at", label: "Completed", sortable: true, render: (r) => (r.completed_at ? formatDate(r.completed_at) : null) },
          { key: "c", label: "Certificate", desktop: true, render: (r) => (r.certificate_number ? <span data-copy="content">{r.certificate_number}</span> : null) },
        ]}
      />
    </>
  );
}

/* ───────────── Assignments ───────────── */

function Assignments({ c }: { c: Course }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const list = usePaged("GET /api/v1/training/courses/:id/assignments", { params: { id: c.training_course_id } });
  const withdraw = useMutation("POST /api/v1/training/assignments/:id/withdraw");
  const edit = can("knowledge", "edit");
  const pull = async (a: Assignment) => {
    if (!(await confirm({ title: "Withdraw Assignment", body: "People who have not started leave the course.", confirmLabel: "Withdraw Assignment", destructive: true }))) return;
    try {
      await withdraw.run({ params: { id: a.training_assignment_id }, body: {} });
      refresh();
      toast("Assignment withdrawn");
    } catch (e) {
      failed(e, "Not withdrawn, try again");
    }
  };
  return (
    <DataView<Assignment>
      title="Assignments"
      list={list}
      rowKey={(a) => a.training_assignment_id}
      noun="assignment"
      wide
      empty={{ icon: "userplus", title: "Not Assigned Yet", text: c.state === "published" ? "Assign it to who must take it." : "Publish the course first." }}
      columns={[
        { key: "a", label: "Audience", render: (a) => <span data-copy="content">{a.audience_text}</span> },
        { key: "w", label: "State", badge: true, render: (a) => (a.withdrawn_at ? <Pill tone="neutral">Withdrawn</Pill> : <Pill tone="ok">Open</Pill>) },
        { key: "d", label: "Due Within", render: (a) => (a.due_within_days ? `${a.due_within_days} days` : "No Due Date") },
        { key: "j", label: <HelpTerm help="Enrols those who join later.">New Joiners</HelpTerm>, render: (a) => (a.keep_assigning ? "Assigned" : "Not Assigned") },
        { key: "n", label: "Assigned", align: "n", render: (a) => a.enrolled },
        { key: "c", label: "Assigned On", desktop: true, render: (a) => `${formatDate(a.created_at)}${a.created_by_name ? `, ${a.created_by_name}` : ""}` },
        {
          key: "x",
          label: "",
          render: (a) =>
            edit && !a.withdrawn_at ? (
              <Button size="sm" onClick={() => pull(a)}>
                Withdraw
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

type Audience = "everyone" | "pick";
type AssignValues = { who: Audience; departments: Department[]; roles: RoleOption[]; people: PersonRef[]; due: string; keep: boolean };
const assignBody = (v: AssignValues) => ({
  everyone: v.who === "everyone",
  department_ids: v.who === "everyone" ? [] : v.departments.map((d) => d.department_id),
  role_ids: v.who === "everyone" ? [] : v.roles.map((r) => r.role_id),
  employee_ids: v.who === "everyone" ? [] : v.people.map((p) => p.employee_id),
  due_within_days: v.due.trim() ? Number(v.due) : null,
  keep_assigning: v.keep,
});
const ASSIGN_FIELDS: Record<string, string> = { everyone: "who", department_ids: "departments", role_ids: "roles", employee_ids: "people", due_within_days: "due", keep_assigning: "keep" };
const assignSchema: ContractSchema = {
  safeParse: (v: unknown) => {
    const r = training.AssignmentCreate.safeParse(assignBody(v as AssignValues));
    if (r.success) return r;
    return { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: [ASSIGN_FIELDS[String(i.path[0])] ?? String(i.path[0])] })) } };
  },
};

function AssignForm({ c, close }: { c: Course; close: () => void }) {
  const assign = useMutation("POST /api/v1/training/courses/:id/assignments");
  const roles = usePaged("GET /api/v1/access/roles");
  const f = useContractForm<AssignValues>({ who: "everyone", departments: [], roles: [], people: [], due: "30", keep: true }, assignSchema);
  const send = async () => {
    if (!f.check()) return;
    try {
      const a = await assign.run({ params: { id: c.training_course_id }, body: assignBody(f.values) });
      refresh();
      close();
      toast(`Assigned to ${a.enrolled} ${a.enrolled === 1 ? "person" : "people"}`);
    } catch (e) {
      failed(e, "Not assigned, try again", (fields) => f.setServerErrors(Object.fromEntries(Object.entries(fields).map(([k, m]) => [ASSIGN_FIELDS[k] ?? k, m]))));
    }
  };
  const pick = f.values.who === "pick";
  return (
    <>
      <Field label="Who Takes It" {...f.status("who")}>
        <ChoiceField<Audience> value={f.values.who} onChange={(v) => f.set("who", v)} options={[["everyone", "Everyone"], ["pick", "Pick Who"]]} />
      </Field>
      {pick && (
        <>
          <Field label="Departments" optional {...f.status("departments")}>
            <DepartmentPicker multiple value={f.values.departments} onChange={(v) => f.set("departments", v)} />
          </Field>
          <Field label="Roles" optional {...f.status("roles")}>
            <RecordPicker<RoleOption>
              list={{ rows: roles.rows, page: roles.page, loading: roles.loading, error: roles.error, q: roles.q, setQ: roles.setQ }}
              value={f.values.roles}
              onChange={(v) => f.set("roles", v)}
              id={(r) => r.role_id}
              title={(r) => r.name}
              multiple
              placeholder="Search roles"
            />
          </Field>
          <Field label="People" optional {...f.status("people")}>
            <EmployeePicker multiple value={f.values.people} onChange={(v) => f.set("people", v)} filters={{ status: "active" }} />
          </Field>
        </>
      )}
      <Field label="Due Within (Days)" optional {...f.status("due")}>
        <NumberField {...f.field("due")} placeholder="30" className="w-28" />
      </Field>
      <CheckboxField value={f.values.keep} onChange={(v) => f.set("keep", v)} label="Keep Assigning New Joiners" />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Assign Training
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Settings ───────────── */

function Settings({ c }: { c: Course }) {
  const { can } = useAuth();
  const patch = useMutation("PATCH /api/v1/training/courses/:id");
  const fixed = c.state === "archived" || !can("knowledge", "edit");
  const f = useContractForm({ title: c.title, summary: c.summary ?? "", proof_prompt: c.proof_prompt ?? "" }, training.CourseUpdate);
  const set = async (body: { library?: boolean; proof_required?: boolean; issue_certificate?: boolean }) => {
    try {
      await patch.run({ params: { id: c.training_course_id }, body });
      refresh();
      toast("Setting saved");
    } catch (e) {
      failed(e, "Setting not saved");
    }
  };
  const save = async () => {
    if (!f.check()) return;
    try {
      await patch.run({
        params: { id: c.training_course_id },
        body: { title: f.values.title.trim(), summary: f.values.summary.trim(), ...(c.proof_required && { proof_prompt: f.values.proof_prompt.trim() }) },
      });
      refresh();
      toast("Course saved");
    } catch (e) {
      failed(e, "Course not saved", f.setServerErrors);
    }
  };
  return (
    <>
      <Card>
        <CardHeader title="Settings" />
        <ToggleRow title={<HelpTerm help="Anyone may take it, assigned or not.">Library</HelpTerm>} checked={c.library} disabled={fixed} onChange={(v) => set({ library: v })} />
        <ToggleRow title={<HelpTerm help="Asked at the end: a certificate link or a file.">Proof Required</HelpTerm>} checked={c.proof_required} disabled={fixed} onChange={(v) => set({ proof_required: v })} />
        <ToggleRow title="Issue Certificate" checked={c.issue_certificate} disabled={fixed} onChange={(v) => set({ issue_certificate: v })} />
      </Card>
      {!fixed && (
        <Card className="mt-3">
          <CardHeader title="Course Details" />
          <Field label="Title" {...f.status("title")}>
            <TextField {...f.field("title")} />
          </Field>
          <Field label="Summary" optional {...f.status("summary")}>
            <TextAreaField {...f.field("summary")} rows={3} />
          </Field>
          {c.proof_required && (
            <Field label="Proof Prompt" optional {...f.status("proof_prompt")}>
              <TextField {...f.field("proof_prompt")} />
            </Field>
          )}
          <FormFooter>
            <Button variant="primary" onClick={save}>
              Save Course
            </Button>
          </FormFooter>
        </Card>
      )}
    </>
  );
}
