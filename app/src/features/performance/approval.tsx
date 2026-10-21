import { useState } from "react";
import goals from "@mycity/contract/schemas/goals.js";
import type { ApprovalDecision, RouteStage } from "@mycity/contract/contract.gen.ts";
import { ActionGroup, Button, Card, CardHeader, Chain, Field, formatDateTime, TextAreaField, Timeline, useContractForm } from "@mycity/ui";

/**
 * Where a goal, a department's month or a review stands on its approval, and Approve or
 * Return for whoever it waits on (docs/guides/performance.md §10.1). Return asks its reason
 * here, in the same card: a modal is never stacked on another.
 */
export function ApprovalCard({
  route,
  decisions,
  canDecide,
  noun,
  decide,
}: {
  route: RouteStage[];
  decisions: ApprovalDecision[];
  canDecide: boolean;
  /** The thing decided, for the buttons: "Goal", "Month", "Review". */
  noun: string;
  decide: (body: { decision: "approve" | "return"; reason?: string }) => Promise<unknown>;
}) {
  const [returning, setReturning] = useState(false);
  const f = useContractForm({ decision: "return" as const, reason: "" }, goals.DecideBody);
  if (!route.length) return null;
  const sendBack = f.submit((v) => decide({ decision: "return", reason: v.reason }));
  return (
    <Card>
      <CardHeader title="Approval" />
      <Chain
        steps={route
          .filter((s) => s.state !== "skipped")
          .map((s) => ({ label: s.name, state: s.state === "done" ? "done" : s.state === "now" ? "now" : undefined }))}
      />
      {decisions.length > 0 && (
        <Timeline
          className="mt-3"
          items={decisions.map((d) => ({
            title: `${d.decision === "approve" ? "Approved" : d.decision === "cancel" ? "Withdrawn" : "Returned"} by ${d.actor_name ?? "the system"}`,
            when: formatDateTime(d.decided_at),
            text: d.reason ?? undefined,
            tone: d.decision === "approve" ? "done" : undefined,
          }))}
        />
      )}
      {canDecide && !returning && (
        <ActionGroup>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button onClick={() => setReturning(true)}>{`Return ${noun}`}</Button>
            <Button variant="primary" onClick={() => decide({ decision: "approve" })}>{`Approve ${noun}`}</Button>
          </div>
        </ActionGroup>
      )}
      {canDecide && returning && (
        <div className="mt-3">
          <Field label="Reason" {...f.status("reason")}>
            <TextAreaField {...f.field("reason")} rows={3} />
          </Field>
          <ActionGroup>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setReturning(false)}>Cancel</Button>
              <Button variant="danger" onClick={sendBack}>{`Return ${noun}`}</Button>
            </div>
          </ActionGroup>
        </div>
      )}
    </Card>
  );
}
