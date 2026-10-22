/**
 * ESS · My Performance · My Commitments (docs/guides/performance.md §6.11, §10): this month's
 * commitments with their state and original date, and Send Commitments while some are not sent.
 * A part of the page: `<MyCommitments />` reads its own data, so the page places it as a card on
 * desktop and inside its icon card's sheet on a phone. A row opens its task on My Workspace.
 */
import type { Commitment } from "@mycity/contract/contract.gen.ts";
import { usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { commitmentMonths, commitmentPill, ORIGINAL_HELP, SendCommitmentsForm } from "@/features/workspace/Commitment";
import { useRouter } from "@/lib/router";
import { Button, DataView, formatDate, HelpTerm, StatusPill, useModal } from "@mycity/ui";

export function MyCommitments() {
  const me = useMe();
  const modal = useModal();
  const { navigate } = useRouter();
  const month = commitmentMonths()[0][0].slice(0, 7);
  const list = usePaged("GET /api/v1/performance/commitments", {
    filters: { month, ...(me.employee_id ? { employee_id: me.employee_id } : {}) },
    sort: "due_at",
    enabled: Boolean(me.employee_id),
  });
  const unsent = list.rows.some((c) => c.state === "awaiting_approval" && c.set_status !== "submitted");
  const send = () => modal.open({ title: "Send Commitments", wide: true, body: (close) => <SendCommitmentsForm close={close} /> });
  return (
    <DataView
      title="My Commitments"
      list={list}
      rowKey={(c: Commitment) => c.task_id}
      noun="commitment"
      onRowClick={(c) => c.link && navigate(c.link.path)}
      actions={unsent ? <Button size="sm" onClick={send}>Send Commitments</Button> : undefined}
      empty={{ title: "No Commitments Yet" }}
      columns={[
        { key: "title", label: "Commitment", render: (c) => <span data-copy="content">{c.title}</span> },
        { key: "original", label: <HelpTerm help={ORIGINAL_HELP}>Original Date</HelpTerm>, render: (c) => (c.original_due_at ? formatDate(c.original_due_at) : "–") },
        { key: "state", label: "State", render: (c) => <StatusPill s={commitmentPill(c.state, c.set_status)} /> },
      ]}
    />
  );
}
