import policies from "@mycity/contract/schemas/policies.js";
import type { Policy, PolicyAck, PolicyRow, PolicyVersion } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { usePhotos } from "@/api/download";
import { useAuth } from "@/auth/AuthProvider";
import { useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Banner, Button, Card, CardHeader, Chips, DataView, ErrorState, ExportButton, Field, formatDate, FormFooter, KeyValue, LoadingRows, PageHeader, Pill, TextField, toast, useContractForm, useModal, Who } from "@mycity/ui";
import { KIND_LABEL, POLICY_STATE, versionPill } from "./labels";
import { DraftEditor, textOf } from "./PolicyDraft";
import { ReasonForm, SendForm } from "./PolicyForms";
import { PolicyContent, Signatures, WhatChanged } from "./PolicyText";

/**
 * Knowledge Hub · Policies (docs/guides/policies.md §2, §10): every policy for the people who write
 * them (`policies.manage`), and one policy opened in place (`?policy=`): its state, a version
 * waiting or a submission, the draft (the editor or the Attendance worksheet), and its versions
 * with who has acknowledged each. `?policy=attendance` opens the Attendance policy.
 */
export function PoliciesTab() {
  const [params] = useSearchParams();
  const linked = params.get("policy");
  return linked ? <PolicyPage linked={linked} /> : <PolicyList />;
}

const STATE_FILTER: ReadonlyArray<["" | PolicyRow["state"], string]> = [
  ["", "All"],
  ["in_force", "In Force"],
  ["awaiting_approval", "Awaiting Approval"],
  ["waiting", "Starts Soon"],
  ["draft", "Draft"],
  ["archived", "Archived"],
];

function PolicyList() {
  const { can } = useAuth();
  const modal = useModal();
  const { navigate } = useRouter();
  const [state, setState] = useState<"" | PolicyRow["state"]>("");
  const list = usePaged("GET /api/v1/policies", { filters: state ? { state } : {} });
  const open = (r: PolicyRow) => navigate(`/knowledge?tab=policies&policy=${r.policy_id}`);
  const create = () => modal.open({ title: "New Policy", body: (close) => <NewPolicyForm close={close} onCreated={(id) => navigate(`/knowledge?tab=policies&policy=${id}`)} /> });
  const mayCreate = can("knowledge", "create");
  useScreenAction(mayCreate ? { label: "New Policy", onSelect: create } : null);
  return (
    <>
      <PageHeader
        title="Policies"
        sub="Every company policy, versioned"
        actions={
          mayCreate ? (
            <Button variant="primary" icon="plus" onClick={create}>
              New Policy
            </Button>
          ) : undefined
        }
      />
      <Chips label="State" value={state} onChange={setState} options={STATE_FILTER} />
      <DataView
        title="Policies"
        list={list}
        search="Search policies"
        rowKey={(r) => r.policy_id}
        onRowClick={open}
        noun="policy"
        nounPlural="policies"
        empty={{ icon: "book", title: "No Policies Yet", text: "Write the first one." }}
        columns={[
          { key: "title", label: "Policy", sortable: true, render: (r) => <span data-copy="content" className="font-semibold">{r.title}</span> },
          { key: "k", label: "Type", desktop: true, render: (r) => KIND_LABEL[r.kind] },
          { key: "a", label: "Applies To", render: (r) => <span data-copy="content">{r.applies_to_text}</span> },
          { key: "v", label: "In Force", desktop: true, render: (r) => (r.version_in_force ? `Version ${r.version_in_force}` : null) },
          { key: "s", label: "State", render: (r) => <Pill tone={POLICY_STATE[r.state].tone}>{POLICY_STATE[r.state].text}</Pill> },
          { key: "c", label: "Acknowledged", render: (r) => (r.asked ? `${r.acknowledged} of ${r.asked}` : null) },
        ]}
      />
    </>
  );
}

function NewPolicyForm({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const create = useMutation("POST /api/v1/policies");
  const f = useContractForm({ title: "" }, { safeParse: (v: unknown) => policies.PolicyCreate.pick({ title: true }).safeParse(v) });
  const send = async () => {
    if (!f.check()) return;
    try {
      const p = await create.run({
        body: {
          title: f.values.title.trim(),
          applies_to: { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] },
          needs_acknowledgement: true,
          acknowledge_within_days: 7,
          needs_approval: false,
        },
      });
      invalidate("/api/v1/policies");
      close();
      onCreated(p.policy_id);
      toast("Policy started");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Policy not started");
    }
  };
  return (
    <>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="Dress Code" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Start Policy
        </Button>
      </FormFooter>
    </>
  );
}

/** `?policy=` names a policy by id, or `attendance`: that one is looked up by its type. */
function PolicyPage({ linked }: { linked: string }) {
  const byKind = useApi("GET /api/v1/policies", { query: { kind: "attendance" }, enabled: linked === "attendance" });
  const id = linked === "attendance" ? (byKind.data?.data[0]?.policy_id ?? "") : linked;
  const { data: p, error, reload } = useApi("GET /api/v1/policies/:id", { params: { id }, enabled: !!id });
  const { navigate } = useRouter();
  // Changes on screen not yet saved: the bar's Publish refuses until Save Draft keeps them.
  const [dirty, setDirty] = useState(false);
  const back = (
    <Button icon="left" onClick={() => navigate("/knowledge?tab=policies")}>
      All Policies
    </Button>
  );
  if (error || byKind.error) return <ErrorState error={(error ?? byKind.error)!} onRetry={reload} />;
  if (!p)
    return (
      <>
        <PageHeader title="Policies" actions={back} />
        <Card>
          <LoadingRows count={8} />
        </Card>
      </>
    );
  return (
    <>
      <PageHeader title="Policies" actions={back} />
      <PolicyOverview p={p} dirty={dirty} />
      <DraftEditor key={`${p.policy_id}:${p.draft?.updated_at ?? "none"}:${p.submission?.policy_version_id ?? ""}`} p={p} onDirty={setDirty} />
      <Versions p={p} />
    </>
  );
}

function PolicyOverview({ p, dirty }: { p: Policy; dirty: boolean }) {
  const { can } = useAuth();
  const edit = p.can_edit && can("knowledge", "edit");
  const modal = useModal();
  const recall = useMutation("POST /api/v1/policies/:id/recall");
  const withdraw = useMutation("POST /api/v1/policies/versions/:id/withdraw");
  const archive = useMutation("POST /api/v1/policies/:id/archive");
  const state = POLICY_STATE[p.state];
  const send = () =>
    dirty
      ? toast.error("Save the draft first")
      : modal.open({ title: p.draft?.needs_approval ? "Submit for Approval" : "Publish Policy", full: true, body: (close) => <SendForm p={p} close={close} /> });
  // A written policy is sent once it has text: an empty new draft offers nothing to publish.
  const sendable = p.kind !== "document" || textOf(p.draft?.body_html) !== "";
  const reason = (title: string, action: string, placeholder: string, done: string, run: (reason: string) => Promise<unknown>, danger = false) =>
    modal.open({ title, body: (close) => <ReasonForm action={action} placeholder={placeholder} done={done} run={run} danger={danger} close={close} /> });
  const changes = p.draft?.changed.length ?? 0;
  return (
    <>
      <Card className="mb-3">
        <CardHeader title={p.title} record right={<Pill tone={state.tone}>{state.text}</Pill>} />
        <KeyValue
          items={[
            ["Number", p.number],
            ["Type", KIND_LABEL[p.kind]],
            ["Applies To", p.kind === "attendance" ? "Everyone" : (p.in_force?.applies_to_text ?? p.waiting?.applies_to_text ?? null)],
            ["In Force", p.in_force ? `Version ${p.in_force.version} since ${formatDate(p.in_force.effective_from)}` : p.kind === "attendance" ? "Default Rules" : null],
          ]}
        />
        {p.can_archive && can("knowledge", "delete") && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                reason(`Archive ${p.number}`, "Archive Policy", "Replaced by the handbook", "Policy archived", (r) => archive.run({ params: { id: p.policy_id }, body: { reason: r } }), true)
              }
            >
              Archive Policy
            </Button>
          </div>
        )}
      </Card>
      {p.waiting && (
        <Banner
          tone="info"
          className="mb-3"
          action={
            edit && (
              <Button
                size="sm"
                onClick={() =>
                  reason(
                    `Withdraw Version ${p.waiting!.version}`,
                    "Withdraw Version",
                    "Not ready yet",
                    `Version ${p.waiting!.version} withdrawn`,
                    (r) => withdraw.run({ params: { id: p.waiting!.policy_version_id }, body: { reason: r } }),
                    true,
                  )
                }
              >
                Withdraw Version
              </Button>
            )
          }
        >
          {`Version ${p.waiting.version} starts ${formatDate(p.waiting.effective_from)}.`}
        </Banner>
      )}
      {p.submission && (
        <Banner
          tone="info"
          className="mb-3"
          action={
            edit &&
            p.submission.can_recall && (
              <Button
                size="sm"
                onClick={() =>
                  reason("Recall Submission", "Recall Submission", "Changing the text", "Back to the draft", (r) => recall.run({ params: { id: p.policy_id }, body: { reason: r } }))
                }
              >
                Recall Submission
              </Button>
            )
          }
        >
          {`Awaiting approval${p.submission.stage_name ? ` by the ${p.submission.stage_name}` : ""}, from ${formatDate(p.submission.effective_from)}.${p.submission.submitted_by_name ? ` Sent by ${p.submission.submitted_by_name}.` : ""}`}
        </Banner>
      )}
      {p.draft && edit && !p.submission && (
        <Banner
          tone="warn"
          className="mb-3"
          action={
            sendable && (
              <Button size="sm" variant="primary" onClick={send}>
                {p.draft.needs_approval ? "Submit for Approval" : "Publish Policy"}
              </Button>
            )
          }
        >
          {changes ? `Draft with ${changes} change${changes === 1 ? "" : "s"}, not published.` : "Draft saved, not published."}
        </Banner>
      )}
    </>
  );
}

function Versions({ p }: { p: Policy }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/policies/:id/versions", { params: { id: p.policy_id } });
  const open = (v: PolicyVersion) => modal.open({ title: `Version ${v.version}`, wide: true, full: true, body: (close) => <VersionView v={v} close={close} /> });
  return (
    <DataView
      className="mt-3"
      title="Versions"
      list={list}
      rowKey={(v) => v.policy_version_id}
      onRowClick={open}
      noun="version"
      empty={{ icon: "doc", title: "No Versions Yet", text: "Publish the draft to start." }}
      columns={[
        { key: "v", label: "Version", render: (v) => `Version ${v.version}` },
        { key: "f", label: "First Day", render: (v) => formatDate(v.effective_from) },
        { key: "s", label: "State", render: (v) => <Pill tone={versionPill(v.state, v.effective_from).tone}>{versionPill(v.state, v.effective_from).text}</Pill> },
        { key: "b", label: "Published By", desktop: true, render: (v) => v.published_by_name },
        { key: "a", label: "Acknowledged", render: (v) => (v.state === "withdrawn" || !v.needs_acknowledgement ? null : `${v.acknowledged} of ${v.asked}`) },
      ]}
    />
  );
}

const ACK_FILTER: ReadonlyArray<["" | "acknowledged" | "pending" | "overdue", string]> = [
  ["", "Everyone"],
  ["acknowledged", "Acknowledged"],
  ["pending", "Pending"],
  ["overdue", "Overdue"],
];
const ACK_PILL = { acknowledged: { tone: "ok", text: "Acknowledged" }, pending: { tone: "neutral", text: "Pending" }, overdue: { tone: "warn", text: "Overdue" } } as const;

/** A version as staff read it, who signed it, and who has acknowledged it. */
function VersionView({ v, close }: { v: PolicyVersion; close: () => void }) {
  const [status, setStatus] = useState<"" | "acknowledged" | "pending" | "overdue">("");
  const acks = usePaged("GET /api/v1/policies/versions/:id/acknowledgements", { params: { id: v.policy_version_id }, filters: status ? { status } : {} });
  const photo = usePhotos(acks.rows.map((r) => r.employee.photo_url));
  const pill = versionPill(v.state, v.effective_from);
  return (
    <>
      <KeyValue
        items={[
          ["State", <Pill key="s" tone={pill.tone}>{pill.text}</Pill>],
          ["First Day", formatDate(v.effective_from)],
          ["Applies To", <span key="a" data-copy="content">{v.applies_to_text}</span>],
          ["Published", v.published_at ? `${formatDate(v.published_at)}${v.published_by_name ? `, ${v.published_by_name}` : ""}` : null],
          ...(v.withdraw_reason ? ([["Withdrawn", <span key="w" data-copy="content">{v.withdraw_reason}</span>]] as const) : []),
        ]}
      />
      <p data-copy="content" className="my-3 text-sm leading-normal text-muted-foreground">
        {v.note}
      </p>
      <WhatChanged lines={v.change_lines} />
      <div className="mt-3">
        <PolicyContent body={v.body} sections={v.sections} />
      </div>
      <Signatures items={v.signatures} />
      {v.state !== "withdrawn" && v.needs_acknowledgement && (
        <>
          <Chips className="mt-3" label="Acknowledgement" value={status} onChange={setStatus} options={ACK_FILTER} />
          <DataView<PolicyAck>
            title="Acknowledgements"
            list={acks}
            search="Name"
            rowKey={(r) => r.employee.employee_id}
            noun="person"
            nounPlural="people"
            columns={[
              { key: "display_name", label: "Person", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} src={photo(r.employee.photo_url)} /> },
              { key: "s", label: "Status", render: (r) => <Pill tone={ACK_PILL[r.status].tone}>{ACK_PILL[r.status].text}</Pill> },
              { key: "d", label: "Due", desktop: true, render: (r) => formatDate(r.due_on) },
              { key: "acknowledged_at", label: "Acknowledged", sortable: true, render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : null) },
            ]}
          />
        </>
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        <ExportButton message="Policy downloaded" onExport={() => saveExport(api.call("POST /api/v1/policies/versions/:id/pdf", { params: { id: v.policy_version_id }, body: {} }))}>
          Download PDF
        </ExportButton>
      </FormFooter>
    </>
  );
}
