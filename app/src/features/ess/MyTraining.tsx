import training from "@mycity/contract/schemas/training.js";
import type { MyCourse, MyCourseRow, MyItem, MyTrainingList } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { fetchFile, saveFile, useFileBlob } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { ItemLine, KIND_LABEL, minutesText, STATUS_PILL } from "@/features/knowledge/training-labels";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  ChoiceField,
  Chips,
  DataView,
  DocumentPreview,
  EmptyState,
  ErrorState,
  ExportButton,
  Field,
  FileRow,
  formatDate,
  FormFooter,
  HelpTerm,
  KeyValue,
  ListDetail,
  LoadingRows,
  Meter,
  PageHeader,
  Pill,
  RichText,
  TapList,
  TextField,
  toast,
  UploadField,
  useContractForm,
  useIsPhone,
  useModal,
  VideoPlayer,
  type ContractSchema,
} from "@mycity/ui";

/**
 * ESS · My Training (`my-training`; docs/guides/knowledge.md §2, §6.8, §10): the person's own
 * courses, To Do (assigned, not started, due first), In Progress, Completed and the Library. A
 * course opens beside the list (a sheet on a phone, F31) with its items; an item opens in place:
 * a lesson as text, a PDF or a picture in the viewer, an MP4 or a YouTube video in the player
 * (youtube-nocookie.com), any other link in a new tab. Mark Done and Undone on each; Add Proof (a
 * link or a file) where the course asks for it; Start for a Library course. `?id=` opens a course
 * by its id or the person's enrolment's (a task, a notice).
 */

const LISTS: ReadonlyArray<[MyTrainingList, string]> = [
  ["to_do", "To Do"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["library", "Library"],
];
const refresh = () => invalidate("/api/v1/training/me");
const failed = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);
const pct = (done: number, total: number) => (total ? Math.round((done * 100) / total) : 0);

export function MyTraining({ id }: { id: string | null }) {
  const [list, setList] = useState<MyTrainingList>("to_do");
  const rows = usePaged("GET /api/v1/training/me", { filters: { list } });
  const [sel, setSel] = useState<string | null>(id);
  useEffect(() => setSel(id), [id]);
  const due = list === "to_do" || list === "in_progress";
  return (
    <>
      <PageHeader title="My Training" sub="Your courses and certificates" />
      <Chips label="List" value={list} onChange={setList} options={LISTS} />
      <ListDetail
        open={sel !== null}
        onClose={() => setSel(null)}
        title="Course"
        cols="1/1.5"
        full
        fillUntilPicked
        list={
          <DataView<MyCourseRow>
            title="Courses"
            list={rows}
            search="Search courses"
            rowKey={(r) => r.training_course_id}
            selectedKey={sel}
            onRowClick={(r) => setSel(r.training_course_id)}
            noun="course"
            empty={EMPTY[list]}
            columns={[
              { key: "t", label: "Course", render: (r) => <span data-copy="content" className="font-semibold">{r.title}</span> },
              ...(list === "library"
                ? [{ key: "m", label: "Length", render: (r: MyCourseRow) => minutesText(r.minutes) }]
                : [{ key: "s", label: "Status", badge: true, render: (r: MyCourseRow) => (r.status ? <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].text}</Pill> : null) }]),
              ...(due
                ? [
                    { key: "d", label: <HelpTerm help="The date it was set for.">Due</HelpTerm>, render: (r: MyCourseRow) => (r.due_on ? formatDate(r.due_on) : null) },
                    {
                      key: "p",
                      label: "Progress",
                      render: (r: MyCourseRow) => (
                        <span className="block w-32">
                          <Meter pct={pct(r.items_done, r.items_total)} label={`${r.items_done} of ${r.items_total}`} name={`${r.title} progress`} />
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(list === "completed"
                ? [
                    { key: "c", label: "Completed", render: (r: MyCourseRow) => (r.completed_at ? formatDate(r.completed_at) : null) },
                    { key: "n", label: "Certificate", render: (r: MyCourseRow) => (r.certificate_number ? <span data-copy="content">{r.certificate_number}</span> : null) },
                    { key: "x", label: "", render: (r: MyCourseRow) => (r.certificate_number ? <DownloadCertificate courseId={r.training_course_id} /> : null) },
                  ]
                : []),
            ]}
          />
        }
        detail={sel ? <CourseView id={sel} /> : null}
      />
    </>
  );
}

/** Download Certificate: the PDF made at completion, waited on while it renders and saved on this device. */
function DownloadCertificate({ courseId }: { courseId: string }) {
  return (
    <ExportButton message="Certificate downloaded" onExport={() => saveExport(api.call("POST /api/v1/training/me/courses/:id/certificate", { params: { id: courseId }, body: {} }))}>
      Download Certificate
    </ExportButton>
  );
}

const EMPTY: Record<MyTrainingList, { icon: "book" | "check"; title: string; text: string }> = {
  to_do: { icon: "check", title: "Nothing To Do", text: "Assigned courses appear here." },
  in_progress: { icon: "book", title: "Nothing Started", text: "Open a course to begin." },
  completed: { icon: "book", title: "None Completed Yet", text: "Finished courses and certificates appear here." },
  library: { icon: "book", title: "Library Is Empty", text: "Open courses appear here." },
};

/**
 * Brings an element's top back into view in whatever scrolls it (the pane beside the list, the
 * sheet on a phone), when it has scrolled above: an item opened from far down a long PDF or lesson
 * starts at its top, and All Items returns to the list rather than to the middle of the course.
 */
function toTop(el: HTMLElement | null) {
  for (let box = el?.parentElement; el && box; box = box.parentElement) {
    if (box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
      const above = el.getBoundingClientRect().top - box.getBoundingClientRect().top - parseFloat(getComputedStyle(box).paddingTop || "0");
      if (above < 0) box.scrollTop += above;
      return;
    }
  }
}

/** One course as the person takes it: its facts, its items (one open at a time), proof and completion. */
function CourseView({ id }: { id: string }) {
  const { data: c, error, reload } = useApi("GET /api/v1/training/me/courses/:id", { params: { id } });
  const [open, setOpen] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [id]);
  useEffect(() => toTop(top.current), [open]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!c)
    return (
      <Card>
        <LoadingRows count={6} />
      </Card>
    );
  const item = c.items.find((i) => i.training_item_id === open) ?? null;
  return (
    <div ref={top} className="flex flex-col gap-3">
      <CourseCard c={c} />
      {item ? <ItemView c={c} it={item} back={() => setOpen(null)} next={nextOf(c, item)} onNext={setOpen} /> : <ItemList c={c} onOpen={setOpen} />}
      {!item && <Finish c={c} />}
    </div>
  );
}

const nextOf = (c: MyCourse, it: MyItem) => c.items[c.items.findIndex((i) => i.training_item_id === it.training_item_id) + 1] ?? null;
const doneCount = (c: MyCourse) => c.items.filter((i) => i.done_at).length;

function CourseCard({ c }: { c: MyCourse }) {
  const start = useMutation("POST /api/v1/training/me/courses/:id/start");
  const phone = useIsPhone();
  const go = async () => {
    try {
      await start.run({ params: { id: c.training_course_id }, body: {} });
      refresh();
      toast("Course started");
    } catch (e) {
      failed(e, "Not started, try again");
    }
  };
  const pill = c.status ? STATUS_PILL[c.status] : null;
  return (
    <Card>
      <CardHeader record title={c.title} right={pill && <Pill tone={pill.tone}>{pill.text}</Pill>} />
      {c.summary && (
        <p data-copy="content" className="mb-2.5 text-sm text-muted-foreground">
          {c.summary}
        </p>
      )}
      <KeyValue
        items={[
          ...(c.due_on ? ([[<HelpTerm key="d" help="The date it was set for.">Due</HelpTerm>, formatDate(c.due_on)]] as Array<[React.ReactNode, string]>) : []),
          ["Length", minutesText(c.minutes)],
          ...(c.enrolled ? ([["Progress", <Meter key="p" pct={pct(doneCount(c), c.items.length)} label={`${doneCount(c)} of ${c.items.length}`} name="Course progress" />]] as Array<[string, React.ReactNode]>) : []),
        ]}
      />
      {!c.enrolled && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" icon="play" onClick={go} block={phone}>
            Start Course
          </Button>
        </div>
      )}
    </Card>
  );
}

function ItemList({ c, onOpen }: { c: MyCourse; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader title="Items" />
      <TapList
        label="Course Items"
        items={c.items.map((it) => ({
          key: it.training_item_id,
          title: it.title,
          sub: [KIND_LABEL[it.kind], minutesText(it.minutes)].filter(Boolean).join(", "),
          end: it.done_at ? <Pill tone="ok">Done</Pill> : null,
          onSelect: () => onOpen(it.training_item_id),
        }))}
      />
    </Card>
  );
}

/**
 * The item open: its content, then Mark Done (or Undone), the next item and All Items again at the
 * foot (a PDF grows to its pages, so the way back is beside where the reading ends), full width on a
 * phone.
 */
function ItemView({ c, it, back, next, onNext }: { c: MyCourse; it: MyItem; back: () => void; next: MyItem | null; onNext: (id: string) => void }) {
  const done = useMutation("POST /api/v1/training/me/items/:id/done");
  const undone = useMutation("POST /api/v1/training/me/items/:id/undone");
  const phone = useIsPhone();
  const mark = async () => {
    try {
      const after = await done.run({ params: { id: it.training_item_id }, body: {} });
      refresh();
      toast(after.completed_at ? "Course completed" : "Marked done");
    } catch (e) {
      failed(e, "Not marked, try again");
    }
  };
  const unmark = async () => {
    try {
      await undone.run({ params: { id: it.training_item_id }, body: {} });
      refresh();
      toast("Marked not done");
    } catch (e) {
      failed(e, "Not changed, try again");
    }
  };
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" icon="left" onClick={back}>
          All Items
        </Button>
      </div>
      <ItemLine it={it} end={it.done_at ? <Pill tone="ok">Done</Pill> : null} />
      <div className="mt-3">
        <ItemContent it={it} />
      </div>
      <ActionGroup>
        <div className="mt-3 flex flex-wrap justify-end gap-2 phone:flex-col-reverse">
          <Button icon="left" onClick={back} block={phone} className="desk:mr-auto">
            All Items
          </Button>
          {next && (
            <Button iconRight="right" onClick={() => onNext(next.training_item_id)} block={phone}>
              Next Item
            </Button>
          )}
          {c.enrolled && !c.completed_at && it.done_at && (
            <Button onClick={unmark} block={phone}>
              Mark Not Done
            </Button>
          )}
          {c.enrolled && !it.done_at && (
            <Button variant="primary" icon="check" onClick={mark} block={phone}>
              Mark Done
            </Button>
          )}
        </div>
      </ActionGroup>
    </Card>
  );
}

const fileUrl = (documentId: string) => `/api/v1/documents/${documentId}/content`;

function ItemContent({ it }: { it: MyItem }) {
  if (it.kind === "lesson") return it.lesson?.length ? <RichText blocks={it.lesson} top={3} /> : null;
  if (it.kind === "video" && it.youtube_id) return <VideoPlayer key={it.training_item_id} title={it.title} youtubeId={it.youtube_id} />;
  if (it.kind === "video" || it.kind === "link")
    return it.url ? (
      <Button icon="external" asChild>
        <a href={it.url} target="_blank" rel="noopener noreferrer">
          Open Link
        </a>
      </Button>
    ) : null;
  if (!it.document_id) return null;
  const type = it.document_type ?? "";
  const name = it.document_name ?? it.title;
  if (type.startsWith("video/")) return <VideoPlayer key={it.training_item_id} title={it.title} load={() => fetchFile(fileUrl(it.document_id!))} />;
  if (type === "application/pdf" || type.startsWith("image/")) return <FilePreview documentId={it.document_id} name={name} mime={type} />;
  return (
    <FileRow
      name={name}
      action={
        <Button size="sm" icon="download" onClick={() => saveFile(fileUrl(it.document_id!), name)}>
          Download File
        </Button>
      }
    />
  );
}

/**
 * A PDF or a picture from the vault, drawn in the viewer once its bytes arrive. A PDF grows to its
 * pages (`page`), so the pane or the sheet scrolls through it to the item's actions and back to the
 * top, rather than a frame inside the course holding the scroll.
 */
function FilePreview({ documentId, name, mime }: { documentId: string; name: string; mime: string }) {
  const { blob, href, failed: refused } = useFileBlob(fileUrl(documentId));
  if (refused) return <EmptyState bare icon="doc" title="File Not Open" text="Try again shortly." />;
  if (!blob || !href)
    return (
      <FileRow
        name={name}
        action={
          <Button size="sm" icon="download" onClick={() => saveFile(fileUrl(documentId), name)}>
            Download File
          </Button>
        }
      />
    );
  return <DocumentPreview name={name} mime={mime} href={href} file={blob} height="page" />;
}

/** Add Proof once every item is done, where the course asks; the course's completion and its certificate. */
function Finish({ c }: { c: MyCourse }) {
  const modal = useModal();
  const phone = useIsPhone();
  const all = c.items.length > 0 && doneCount(c) === c.items.length;
  if (c.completed_at)
    return (
      <Card>
        <CardHeader title="Completed" right={<Pill tone="ok">{formatDate(c.completed_at)}</Pill>} />
        <KeyValue
          items={[
            ["Certificate", c.certificate_number ? <span key="n" data-copy="content">{c.certificate_number}</span> : null],
            ...(c.proof_url || c.proof_document_name ? ([["Proof", <span key="p" data-copy="content" className="wrap-any">{c.proof_url ?? c.proof_document_name}</span>]] as Array<[string, React.ReactNode]>) : []),
          ]}
        />
        {c.certificate_number && (
          <div className="mt-3 flex justify-end">
            <DownloadCertificate courseId={c.training_course_id} />
          </div>
        )}
      </Card>
    );
  if (!c.enrolled || !c.proof_required || !all) return null;
  return (
    <Card>
      <CardHeader title="Proof" />
      {c.proof_prompt && (
        <p data-copy="content" className="mb-3 text-sm text-muted-foreground">
          {c.proof_prompt}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="primary" icon="upload" block={phone} onClick={() => modal.open({ title: "Add Proof", body: (close) => <ProofForm c={c} close={close} /> })}>
          Add Proof
        </Button>
      </div>
    </Card>
  );
}

type ProofValues = { how: "link" | "file"; url: string; document_id: string };
const proofBody = (v: ProofValues) => (v.how === "link" ? { url: v.url.trim() } : { document_id: v.document_id || undefined });
const proofSchema: ContractSchema = {
  safeParse: (v: unknown) => {
    const values = v as ProofValues;
    const r = training.ProofAdd.safeParse(proofBody(values));
    if (r.success || values.how === "link") return r;
    return { success: false, error: { issues: [{ path: ["document_id"], message: "Pick a file" }] } };
  },
};

function ProofForm({ c, close }: { c: MyCourse; close: () => void }) {
  const add = useMutation("POST /api/v1/training/me/courses/:id/proof");
  const [file, setFile] = useState<string | null>(null);
  const f = useContractForm<ProofValues>({ how: "link", url: "", document_id: "" }, proofSchema);
  const send = async () => {
    if (!f.check()) return;
    try {
      await add.run({ params: { id: c.training_course_id }, body: proofBody(f.values) });
      refresh();
      close();
      toast("Course completed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else failed(e, "Proof not added, try again");
    }
  };
  return (
    <>
      <Field label="Proof">
        <ChoiceField<ProofValues["how"]> value={f.values.how} onChange={(v) => f.set("how", v)} options={[["link", "Link"], ["file", "File"]]} />
      </Field>
      {f.values.how === "link" ? (
        <Field label="Certificate Link" {...f.status("url")}>
          <TextField type="url" {...f.field("url")} placeholder="https://" />
        </Field>
      ) : (
        <Field label="Certificate File" {...f.status("document_id")}>
          {file ? (
            <FileRow name={file} action={<Button size="sm" onClick={() => (f.set("document_id", ""), setFile(null))}>Replace File</Button>} />
          ) : (
            <UploadField
              purpose="attachment"
              multiple={false}
              upload={upload}
              accept=".pdf,.jpg,.jpeg,.png"
              kinds="PDF or a picture"
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
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Add Proof
        </Button>
      </FormFooter>
    </>
  );
}
