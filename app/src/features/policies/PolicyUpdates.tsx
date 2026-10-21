import type { MyPolicyRow, MyPolicyVersion } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import { useSearchParams } from "@/lib/router";
import { ActionGroup, Button, Card, CardHeader, DataView, ExportButton, formatDate, FormFooter, KeyValue, PageHeader, Pill, SegmentedControl, toast, useModal } from "@mycity/ui";
import { KIND_LABEL, versionPill } from "./labels";
import { ApproveForm, ReasonForm } from "./PolicyForms";
import { PolicyContent, Signatures, WhatChanged } from "./PolicyText";

/**
 * ESS · Policy Updates (docs/guides/policies.md §2, §10): what the reader owes an acknowledgement
 * for first, then every policy that applies to them, and for an approver the versions waiting on
 * them. A policy opens as its text or sentences with what changed, its signatures, Download PDF and
 * its earlier versions; an approver approves with a signature or rejects with a reason. A notice
 * links a version by `?version=`.
 */
type View = "to_acknowledge" | "all" | "waiting_on_me";
const VIEWS: ReadonlyArray<[View, string]> = [
  ["to_acknowledge", "To Acknowledge"],
  ["all", "All Policies"],
  ["waiting_on_me", "Waiting On You"],
];

export function PolicyUpdatesPage() {
  const modal = useModal();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>("to_acknowledge");
  const list = usePaged("GET /api/v1/policies/me", { filters: { state: view } });
  const ack = useMutation("POST /api/v1/policies/me/versions/:id/acknowledge");

  const openVersion = async (id: string) => {
    try {
      const v = await api.call("GET /api/v1/policies/me/versions/:id", { params: { id } });
      modal.open({ title: v.title, wide: true, full: true, body: (close) => <VersionReader v={v} close={close} /> });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Policy not found");
    }
  };

  // A notice opens its version (`?version=`), once.
  const linked = params.get("version");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || opened.current === linked) return;
    opened.current = linked;
    void openVersion(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked version
  }, [linked]);

  const acknowledge = async (r: MyPolicyRow) => {
    try {
      await ack.run({ params: { id: r.policy_version_id }, body: {} });
      invalidate("/api/v1/policies/me");
      toast(`${r.title} acknowledged`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not acknowledged, try again");
    }
  };

  return (
    <>
      <PageHeader title="Policy Updates" sub="The policies that apply to you" />
      <SegmentedControl className="mb-3" label="Policies" value={view} onChange={setView} options={VIEWS} />
      <DataView<MyPolicyRow>
        title={VIEWS.find(([v]) => v === view)![1]}
        list={list}
        search="Search policies"
        rowKey={(r) => r.policy_version_id}
        onRowClick={(r) => openVersion(r.policy_version_id)}
        noun="policy"
        nounPlural="policies"
        empty={
          view === "to_acknowledge"
            ? { icon: "ok", title: "All Acknowledged", text: "Nothing waiting for you." }
            : view === "waiting_on_me"
              ? { icon: "ok", title: "Nothing Waiting", text: "No policy waits on you." }
              : { icon: "book", title: "No Policies Yet", text: "None applies to you yet." }
        }
        columns={[
          { key: "t", label: "Policy", render: (r) => <span data-copy="content" className="font-semibold">{r.title}</span> },
          { key: "k", label: "Type", desktop: true, render: (r) => KIND_LABEL[r.kind] },
          { key: "v", label: "Version", render: (r) => (r.version ? `Version ${r.version}` : "New Version") },
          {
            key: "s",
            label: "State",
            render: (r) =>
              r.to_acknowledge ? (
                <Pill tone={r.overdue ? "warn" : "info"}>{r.overdue ? "Overdue" : `Due ${formatDate(r.due_on)}`}</Pill>
              ) : r.acknowledged_at ? (
                <Pill tone="ok">Acknowledged</Pill>
              ) : (
                <Pill tone={versionPill(r.state, r.effective_from).tone}>{versionPill(r.state, r.effective_from).text}</Pill>
              ),
          },
          {
            key: "a",
            label: "Action",
            render: (r) =>
              r.to_acknowledge ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon="ok"
                  className="phone:w-full"
                  onClick={(e) => {
                    // The row opens the policy; this button only acknowledges it.
                    e.stopPropagation();
                    return acknowledge(r);
                  }}
                >
                  Acknowledge
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}

/** One version: the note, what changed, the text or sentences, the signatures, then what to do. */
function VersionReader({ v, close }: { v: MyPolicyVersion; close: () => void }) {
  const modal = useModal();
  const ack = useMutation("POST /api/v1/policies/me/versions/:id/acknowledge");
  const reject = useMutation("POST /api/v1/policies/me/versions/:id/reject");
  const pill = versionPill(v.state, v.effective_from);
  const acknowledge = async () => {
    try {
      await ack.run({ params: { id: v.policy_version_id }, body: {} });
      invalidate("/api/v1/policies/me");
      close();
      toast(`${v.title} acknowledged`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not acknowledged, try again");
    }
  };
  const approve = () => modal.open({ title: "Approve Policy", full: true, body: (done) => <ApproveForm versionId={v.policy_version_id} close={done} onDone={() => invalidate("/api/v1/policies/me")} /> });
  const decline = () =>
    modal.open({
      title: "Reject Policy",
      body: (done) => (
        <ReasonForm
          action="Reject Policy"
          placeholder="Name the equipment"
          done="Policy rejected"
          danger
          run={(reason) => reject.run({ params: { id: v.policy_version_id }, body: { reason } })}
          close={done}
        />
      ),
    });
  return (
    <>
      <Card className="mb-3">
        <CardHeader title={v.version ? `Version ${v.version}` : "New Version"} record right={<Pill tone={pill.tone}>{pill.text}</Pill>} />
        <KeyValue
          items={[
            ["Number", v.number],
            ["First Day", formatDate(v.effective_from)],
            ["Due", v.due_on ? formatDate(v.due_on) : null],
            ["Acknowledged", v.acknowledged_at ? formatDate(v.acknowledged_at) : null],
          ]}
        />
        {v.note && (
          <p data-copy="content" className="mt-2 text-sm leading-normal text-muted-foreground">
            {v.note}
          </p>
        )}
        <div className="mt-2">
          <WhatChanged lines={v.change_lines} />
        </div>
      </Card>
      <PolicyContent body={v.body} sections={v.sections} />
      <Signatures items={v.signatures} />
      {v.earlier.length > 0 && (
        <DataView
          className="mt-3"
          title="Earlier Versions"
          rows={v.earlier}
          rowKey={(e) => e.policy_version_id}
          noun="version"
          columns={[
            { key: "v", label: "Version", render: (e) => `Version ${e.version}` },
            { key: "f", label: "First Day", render: (e) => formatDate(e.effective_from) },
            { key: "s", label: "State", render: (e) => <Pill tone={versionPill(e.state, e.effective_from).tone}>{versionPill(e.state, e.effective_from).text}</Pill> },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {v.version && (
          <ExportButton message="Policy downloaded" onExport={() => saveExport(api.call("POST /api/v1/policies/me/versions/:id/pdf", { params: { id: v.policy_version_id }, body: {} }))}>
            Download PDF
          </ExportButton>
        )}
        {v.approval?.waiting_on_me && (
          <ActionGroup>
            <Button variant="danger" onClick={decline}>
              Reject Policy
            </Button>
            <Button variant="primary" onClick={approve}>
              Approve Policy
            </Button>
          </ActionGroup>
        )}
        {v.can_acknowledge && (
          <Button variant="primary" icon="ok" onClick={acknowledge}>
            Acknowledge
          </Button>
        )}
      </FormFooter>
    </>
  );
}
