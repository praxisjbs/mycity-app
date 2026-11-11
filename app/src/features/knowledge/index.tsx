import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/knowledge";
import "@/api/types/community";
import type { Overdue, Resource } from "@/api/types/knowledge";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable, useDepartmentOptions } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { PoliciesTab } from "@/features/policies/PoliciesHub";
import { Button, ChoiceField, DataView, DateField, Field, formatDate, FormFooter, Grid, Meter, PageHeader, Pill, SelectField, TextAreaField, TextField, toast, todayIso, useContractForm, useModal, Who } from "@mycity/ui";
import { SopsTab } from "./Sops";
import { UserGuide } from "./UserGuide";

export default function Knowledge({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "sops": return <SopsTab id={id} />;
    case "training": return <Training />;
    case "user-guide":
      return <UserGuide id={id} />;
    default: return <PoliciesTab />;
  }
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
          <div key={r.resource_id} className="rounded-box border border-border bg-card p-3.5">
            <h2 data-copy="content" className="text-sm font-semibold">{r.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5"><Pill>{r.kind}</Pill>{r.due && <Pill tone="warn">Due {formatDate(r.due)}</Pill>}</div>
          </div>
        ))}
      </Grid>
      <Grid cols={2} className="mt-3">
        <DataView
          title="Completion"
          right={<span className="text-2xs text-subtle-foreground">Across all staff</span>}
          rows={list.rows}
          rowKey={(r) => r.resource_id}
          loading={list.loading}
          columns={[
            { key: "t", label: "Resource", render: (r) => r.title },
            { key: "a", label: "Assigned", align: "n", render: (r) => r.assigned },
            { key: "c", label: "Completed", align: "n", render: (r) => r.completed },
            { key: "p", label: "Progress", render: (r) => <span className="block w-32"><Meter pct={Math.round((r.completed * 100) / Math.max(1, r.assigned))} label={`${Math.round((r.completed * 100) / Math.max(1, r.assigned))}%`} /></span> },
          ]}
        />
        <PagedTable<Overdue>
          title="Who Has Not Finished"
          right={
            <span className="flex items-center gap-2">
              <Pill tone="warn">{overdue.page?.total ?? 0} people</Pill>
              {can("people", "create") && (overdue.page?.total ?? 0) > 0 && <Button size="sm" icon="bell" busy={remind.pending} onClick={async () => { const r = await remind.run({ body: {} }); toast(`Reminder sent to ${r.reminded} people`); }}>Remind</Button>}
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
    </>
  );
}

function ResourceForm({ close }: { close: () => void }) {
  const { options: depts, ...deptPaging } = useDepartmentOptions();
  const [aud, setAud] = useState<"everyone" | "department">("everyone");
  const f = useContractForm({ title: "", description: "", kind: "Document", due: "", department: "" }, { title: (v) => (!v.trim() ? "Name the resource" : null), description: (v) => (v.trim().length < 10 ? "Say what it covers" : null) });
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
      <Field label="Kind"><SelectField options={[["Document", "Document"], ["Video", "Video"], ["Course", "Course"]]} {...f.field("kind")} /></Field>
      <Field label="Due (Optional)"><DateField {...f.field("due")} min={todayIso()} /></Field>
      <Field label="Assign To"><ChoiceField value={aud} onChange={setAud} options={[["everyone", "Everyone"], ["department", "A Department"]]} /></Field>
      {aud === "department" && <Field label="Department" {...f.field("department")}><SelectField placeholder="Pick the department" options={depts} {...deptPaging} {...f.field("department")} /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Assign</Button>
      </FormFooter>
    </>
  );
}

