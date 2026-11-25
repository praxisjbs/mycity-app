/**
 * My Workspace · Projects (#101; docs/guides/workspace.md §6 Projects, §10.1): every project, and a
 * project's own page, a board of its tasks the reader can see. Anyone starts one and owns it; its
 * owner (or a reader whose grant reaches everyone) changes, completes and reopens it. A project
 * gives nobody a task: its board and its counts hold only what the reader could see on Tasks.
 */
import { useEffect, useState } from "react";
import projects from "@mycity/contract/schemas/projects.js";
import type { Project } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { ColleaguePicker } from "@/features/shared/pickers";
import { useSearchParams } from "@/lib/router";
import { useAddressPrefill, useNewLink, useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  DataView,
  DateField,
  EmptyState,
  ErrorState,
  Field,
  FormFooter,
  formatDate,
  LoadingRows,
  PageHeader,
  Pill,
  SearchInput,
  SegmentedControl,
  TextAreaField,
  TextField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { refresh, say, useLiveTasks } from "./shared";
import { useTaskPanel } from "./TaskPanel";
import { TaskForm } from "./TaskForms";
import { TaskBoard, usePaused } from "./TaskBoard";

/** An owner by name, with Left beside one who has left the staff (§6 Projects): Edit Project hands it on. */
export function OwnerName({ p }: { p: Project }) {
  if (!p.owner) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Who name={p.owner.display_name} />
      {p.owner_left && <Pill tone="warn">Left</Pill>}
    </span>
  );
}
import { filterOf, linkBody, linkEdit, linkOf, linkProblem, NO_LINK, PartnerFilter, PartnerLinkFields, useMayConnect, type PartnerLinkValue } from "./PartnerLink";

type Status = Project["status"];

export function Projects({ openId = null }: { openId?: string | null }) {
  const [, setParams] = useSearchParams();
  const open = (id: string | null) => setParams({ id }, { replace: false });
  return openId ? <ProjectPage key={openId} id={openId} back={() => open(null)} /> : <ProjectList onOpen={open} />;
}

/** Every project, the active ones or the completed, a page of 25 at a time. */
function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const modal = useModal();
  const [status, setStatus] = useState<Status>("active");
  // The Partner filter (workspace.md §10.1), for a reader who may view Partnerships.
  const [partner, setPartner] = useState<PartnerLinkValue>(NO_LINK);
  const mayConnect = useMayConnect();
  const list = usePaged("GET /api/v1/projects", { filters: { status, ...filterOf(partner) } });
  const add = () => modal.open({ title: "New Project", body: (close) => <ProjectForm close={close} onSaved={(p) => onOpen(p.project_id)} /> });
  useScreenAction({ label: "New Project", onSelect: add });
  // ⌘K's New Project (`action=new`) and Praxis AI's "start a project" (`new=1`, ProjectPrefill).
  useUrlAction("new", add);
  useNewLink(add);
  return (
    <>
      <PageHeader
        title="Projects"
        actions={
          <>
            <SegmentedControl label="Project Status" value={status} onChange={setStatus} options={[["active", "Active"], ["completed", "Completed"]]} />
            <Button variant="primary" icon="plus" onClick={add}>New Project</Button>
          </>
        }
      />
      {mayConnect && (
        <Toolbar>
          <PartnerFilter value={partner} onChange={setPartner} />
        </Toolbar>
      )}
      <DataView<Project>
        list={list}
        rowKey={(p) => p.project_id}
        caption="Projects"
        noun="project"
        search="Search projects"
        onRowClick={(p) => onOpen(p.project_id)}
        empty={{ title: "No Projects Yet" }}
        columns={[
          { key: "name", label: "Project", sortable: true, render: (p) => <span data-copy="content"><b className="font-semibold">{p.number}</b> {p.name}</span> },
          { key: "owner", label: "Owner", render: (p) => <OwnerName p={p} /> },
          { key: "due_on", label: "Due", sortable: true, render: (p) => (p.due_on ? formatDate(p.due_on) : "No date") },
          { key: "open", label: "Open", render: (p) => String(p.open) },
          { key: "done", label: "Done", render: (p) => String(p.done) },
        ]}
      />
    </>
  );
}

/** One project: its details and a board of its tasks the reader can see. */
function ProjectPage({ id, back }: { id: string; back: () => void }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/projects/:id", { params: { id } });
  const panel = useTaskPanel();
  const [q, setQ] = useState("");
  const sent = usePaused(q);
  const change = useMutation("PATCH /api/v1/projects/:id");
  useLiveTasks();
  // A project that is gone, or never was: back to the list (§11).
  const missing = read.error?.status === 404;
  useEffect(() => {
    if (missing) back();
  }, [missing, back]);
  const p = read.data;
  const addTask = () => p && modal.open({ title: "New Task", body: (close) => <TaskForm close={close} project={{ project_id: p.project_id, number: p.number, name: p.name }} /> });
  useScreenAction(p && p.status === "active" ? { label: "New Task", onSelect: addTask } : null);
  if (read.error && !missing) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!p) return <LoadingRows count={6} />;
  const edit = () => modal.open({ title: "Edit Project", body: (close) => <ProjectForm close={close} project={p} /> });
  const setStatus = async (status: Status) => {
    try {
      await change.run({ params: { id }, body: { status } });
      refresh();
      read.reload();
      toast(status === "completed" ? `${p.name} completed` : `${p.name} reopened`);
    } catch (e) {
      say(e);
    }
  };
  const subtitle = [p.number, p.owner?.display_name, p.due_on ? `Due ${formatDate(p.due_on)}` : null].filter(Boolean).join(" · ");
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={subtitle}
        actions={
          <>
            <Button icon="left" onClick={back}>Projects</Button>
            {p.can_edit && <Button onClick={edit}>Edit Project</Button>}
            {p.can_edit && p.status === "active" && <Button onClick={() => setStatus("completed")}>Complete Project</Button>}
            {p.can_edit && p.status === "completed" && <Button onClick={() => setStatus("active")}>Reopen Project</Button>}
            {p.status === "active" && <Button variant="primary" icon="plus" onClick={addTask}>New Task</Button>}
          </>
        }
      >
        {p.status === "completed" && <Pill tone="ok">Completed</Pill>}
        {p.owner_left && <Pill tone="warn">Owner Left</Pill>}
        {p.partner_link && <Pill>{p.partner_link.name ?? "A Partner You Cannot See"}</Pill>}
      </PageHeader>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search tasks" className="w-full md:w-64" />
      </Toolbar>
      <TaskBoard filters={{ scope: "team", project_id: id }} q={sent} onOpen={panel.open} empty={<EmptyState title="No Tasks Yet" />} />
      {panel.panel}
    </>
  );
}

/**
 * New Project's warning (§6 Projects): an active project already holding the name typed, case and
 * accents aside. Advisory: the project still saves. Edit Project leaves out the project itself.
 */
export function SameNameNotice({ name, except }: { name: string; except?: string }) {
  const typed = usePaused(name);
  const ask = typed.length >= 3 && projects.ProjectNameQuery.safeParse({ name: typed }).success;
  const same = useApi("GET /api/v1/projects/same-name", { query: { name: typed, ...(except ? { except } : {}) }, enabled: ask });
  const hit = ask ? same.data?.project : null;
  if (!hit) return null;
  return (
    <Banner tone="warn" className="mb-3">
      {`Already a project: ${hit.number} ${hit.name}.`}
    </Banner>
  );
}

/**
 * New Project and Edit Project. A new one is the reader's; the address may fill it (ProjectPrefill), and
 * from a Partner 360 or a Lead 360 it opens already connected (`link`, partnerships.md §6.16). Edit
 * Project hands it to another owner (a leaver's projects, §6 Projects).
 */
export function ProjectForm({ close, project, onSaved, link: inLink }: { close: () => void; project?: Project; onSaved?: (p: Project) => void; link?: PartnerLinkValue }) {
  const filled = useAddressPrefill(projects.ProjectPrefill, !project);
  const initial = {
    name: project?.name ?? filled.name ?? "",
    description: project?.description ?? filled.description ?? "",
    due_on: project?.due_on ?? filled.due_on ?? "",
  };
  const f = useContractForm(initial, project ? projects.ProjectEdit : projects.ProjectCreate);
  const create = useMutation("POST /api/v1/projects");
  const save = useMutation("PATCH /api/v1/projects/:id");
  const [link, setLink] = useState<PartnerLinkValue>(project ? linkOf(project.partner_link) : (inLink ?? NO_LINK));
  const [linkMark, setLinkMark] = useState<{ record?: string; deal?: string } | null>(null);
  const [owner, setOwner] = useState<PersonRef[]>(project?.owner ? [project.owner] : []);
  const [ownerMark, setOwnerMark] = useState<string | null>(null);
  const submit = async () => {
    if (!f.check()) return;
    if (project && !owner.length) return setOwnerMark("Pick an owner");
    const v = f.values;
    try {
      if (project) {
        const handed = owner[0] && owner[0].employee_id !== project.owner?.employee_id ? { owner_employee_id: owner[0].employee_id } : {};
        await save.run({ params: { id: project.project_id }, body: { name: v.name, description: v.description || null, due_on: v.due_on || null, ...handed, ...linkEdit(linkOf(project.partner_link), link) } });
        toast("Project saved");
      } else {
        const made = await create.run({ body: { name: v.name, ...(v.description && { description: v.description }), ...(v.due_on && { due_on: v.due_on }), ...linkBody(link) } });
        toast(`${made.number} started`);
        onSaved?.(made);
      }
      refresh();
      close();
    } catch (e) {
      const onLink = linkProblem(e);
      setLinkMark(onLink);
      if (onLink) return;
      const onOwner = e instanceof ApiError ? e.fields.owner_employee_id?.[0] : undefined;
      if (onOwner) return setOwnerMark(onOwner);
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <SameNameNotice name={String(f.values.name ?? "")} except={project?.project_id} />
      <Field label="Name" {...f.field("name")}><TextField {...f.field("name")} placeholder="Lekki Launch" /></Field>
      {project && (
        <Field label="Owner" state={ownerMark ? "bad" : undefined} message={ownerMark ?? undefined}>
          <ColleaguePicker
            withSelf
            placeholder="Search staff"
            value={owner}
            onChange={(p) => {
              setOwner(p);
              setOwnerMark(null);
            }}
          />
        </Field>
      )}
      <Field label="Notes" optional {...f.field("description")}><TextAreaField {...f.field("description")} /></Field>
      <Field label="Due" optional {...f.field("due_on")}><DateField {...f.field("due_on")} /></Field>
      <PartnerLinkFields
        value={link}
        onChange={(v) => {
          setLink(v);
          setLinkMark(null);
        }}
        view={project?.partner_link}
        problem={linkMark}
      />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{project ? "Save Project" : "Create Project"}</Button>
      </FormFooter>
    </>
  );
}
