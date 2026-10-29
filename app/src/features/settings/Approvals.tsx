import { useState } from "react";
import type { ApprovalFlow } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useScreenAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  DataView,
  DesktopOnly,
  FormError,
  FormFooter,
  HelpTerm,
  Inline,
  KeyValue,
  PageHeader,
  Pill,
  Stack,
  toast,
  useModal,
} from "@mycity/ui";
import { NewFlow } from "./NewFlow";
import { CONDITION_HELP, conditionText, hours, StageCards, StageDraftForm, useStageDraft } from "./Stages";

/**
 * Settings · Approvals (#72; docs/guides/foundation.md §6.5, §10): every flow,
 * its stages and its version. New Flow makes one nobody has coded yet; Edit Stages
 * changes a flow's stages one at a time (approver, the condition on its numbers,
 * the time limit) and Save Stages writes them as a new version; a request already
 * open keeps the version it started on. No drag and drop: stages move with Move Up
 * and Move Down.
 */
const UNUSED_HELP = "Nothing has opened this flow yet. A developer connects it to a screen with its key.";

/** Active, or why a flow is not: stages the rules refuse, or no request ever opened on it. */
function Status({ flow }: { flow: ApprovalFlow }) {
  if (flow.problems.length) return <Pill tone="err">Needs Fixing</Pill>;
  if (!flow.used) return <Pill tone="warn">Not Used Yet</Pill>;
  return <Pill tone="ok">Active</Pill>;
}

export function Approvals() {
  const modal = useModal();
  const { can } = useAuth();
  const s = useApi("GET /api/v1/settings/approvals/summary");
  const list = usePaged("GET /api/v1/settings/approvals");
  const canAdd = can("settings", "create");
  const open = (f: ApprovalFlow) => modal.open({ title: f.name, side: true, body: (close) => <FlowDetail flow={f} close={close} editable={can("settings", "edit")} /> });
  const newFlow = () => modal.open({ title: "New Flow", wide: true, full: true, body: (close) => <NewFlow close={close} /> });
  useScreenAction(canAdd ? { label: "New Flow", onSelect: newFlow } : null);
  return (
    <>
      <PageHeader
        title="Approvals"
        sub="Who decides each request"
        actions={
          canAdd && (
            <DesktopOnly>
              <Button variant="primary" icon="plus" onClick={newFlow}>
                New Flow
              </Button>
            </DesktopOnly>
          )
        }
      />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Flows", value: String(s.data.flows) },
            { label: "Open Requests", value: String(s.data.open_requests) },
            { label: "Overdue", value: String(s.data.overdue), tone: s.data.overdue ? "warn" : undefined },
            { label: "Needs Fixing", value: String(s.data.needs_fixing), tone: s.data.needs_fixing ? "err" : undefined },
          ]}
        />
      )}
      <DataView
        list={list}
        title="Approval Flows"
        search="Search Flows"
        noun="flow"
        rowKey={(f) => f.workflow_definition_id}
        onRowClick={open}
        empty={{ title: "No Flows Yet", icon: "check" }}
        columns={[
          { key: "name", label: "Flow", sortable: true, render: (f) => f.name },
          { key: "stages", label: "Stages", render: (f) => f.stages.map((x) => x.name).join(" · ") },
          { key: "version", label: "Version", align: "n", render: (f) => String(f.version) },
          { key: "open", label: "Open Requests", align: "n", render: (f) => String(f.open_requests) },
          { key: "status", label: "Status", render: (f) => <Status flow={f} /> },
        ]}
      />
    </>
  );
}

/** One flow: its route, each stage, and Edit Stages. */
function FlowDetail({ flow, close, editable }: { flow: ApprovalFlow; close: () => void; editable: boolean }) {
  const modal = useModal();
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Pill>{`Version ${flow.version}`}</Pill>
        {flow.open_requests > 0 && <Pill tone="info">{`${flow.open_requests} Open`}</Pill>}
        {!flow.used && !flow.problems.length && (
          <HelpTerm help={UNUSED_HELP}>
            <Pill tone="warn">Not Used Yet</Pill>
          </HelpTerm>
        )}
      </Inline>
      {flow.problems.length > 0 && (
        <Banner tone="err">
          <span className="block font-semibold">Fix these stages before the next request</span>
          <ul className="m-0 list-disc pl-4">
            {flow.problems.map((p) => (
              <li key={p} data-copy="content">{p}</li>
            ))}
          </ul>
        </Banner>
      )}
      <KeyValue items={[["Key", flow.key]]} />
      <Chain steps={flow.stages.map((x) => ({ label: x.name }))} />
      {flow.stages.map((stage) => (
        <Card key={stage.key}>
          <CardHeader title={stage.name} record level={3} />
          <KeyValue
            items={[
              ["Approver", stage.approvers.map((a) => a.label).join(", ")],
              [<HelpTerm key="when" help={CONDITION_HELP}>Applies When</HelpTerm>, conditionText(stage, flow.context_types)],
              ["Time Limit", hours(stage.sla_hours)],
            ]}
          />
        </Card>
      ))}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {editable && (
          <Button variant="primary" icon="edit" onClick={() => modal.open({ title: "Edit Stages", wide: true, full: true, body: (done) => <EditStages flow={flow} close={done} /> })}>
            Edit Stages
          </Button>
        )}
      </FormFooter>
    </Stack>
  );
}

/** The stages of the version on screen, changed one at a time, then saved together as a new version. */
function EditStages({ flow, close }: { flow: ApprovalFlow; close: () => void }) {
  const draft = useStageDraft(flow.stages);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("PUT /api/v1/settings/approvals/:id/steps");

  if (draft.editing !== null) return <StageDraftForm draft={draft} context={flow.context_types} />;

  const submit = async () => {
    setProblem(null);
    if (!draft.stages.length) return setProblem("Keep at least one stage");
    try {
      const saved = await save.run({ params: { id: flow.workflow_definition_id }, body: { stages: draft.stages } });
      invalidate("/api/v1/settings/approvals");
      close();
      toast(`${saved.name} saved as version ${saved.version}`);
    } catch (e) {
      // A refused route names each stage's problem (workflow.service plainly); anything else, its message.
      setProblem(e instanceof ApiError ? (e.fields.stages?.join(" · ") ?? e.message) : "Not saved. Try again.");
    }
  };

  return (
    <>
      <StageCards draft={draft} context={flow.context_types} />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          Save Stages
        </Button>
      </FormFooter>
    </>
  );
}
