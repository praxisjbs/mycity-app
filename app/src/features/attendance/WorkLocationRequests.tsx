import workflow from "@mycity/contract/schemas/workflow.js";
import type { ApprovalDecision, LocationRequest, LocationRequestStatus } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useOpenWhereNews, useViewNews, withNews } from "@/features/notifications/marks";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Button, Card, CardHeader, Chain, Chips, ChoiceField, DataView, DesktopOnly, ErrorState, Field, formatDate, formatDateTime, FormFooter, KeyValue, LoadingRows, PageHeader, PhoneOnly, Pill, TextAreaField, Timeline, toast, todayIso, useConfirm, useContractForm, useModal, Who } from "@mycity/ui";
import { REQUEST_STATUS, REQUEST_TYPE } from "./labels";
import { MySites, useSiteLink, useSiteView, useWorkSiteSheet } from "./TemporarySites";

/**
 * ESS · Work Location Requests (#87, docs/guides/attendance.md §6.11, §10): the temporary sites the
 * person submitted or is on, each with its approval route and Withdraw Submission while it waits,
 * and Add Work Site, the sheet Home opens too. Under them, while any is listed, the work location
 * requests they made before PR 4, which still apply and can still be withdrawn or cancelled. People
 * see and decide those on People · Worksites, Temporary (RequestsView, below).
 */

export const requestPill = (r: Pick<LocationRequest, "status">) => <Pill tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].text}</Pill>;
export const requestDates = (r: Pick<LocationRequest, "starts_on" | "ends_on">) =>
  r.starts_on === r.ends_on ? formatDate(r.starts_on) : `${formatDate(r.starts_on)} to ${formatDate(r.ends_on)}`;
/** Where the request is for: its address, or home for a remote day without one. */
export const requestPlace = (r: Pick<LocationRequest, "address" | "request_type">) => r.address ?? (r.request_type === "remote_day" ? "Home" : null);
/** A client visit's site: its centre and radius, or null for any other request (and one sent before sites). */
export const requestSite = (r: Pick<LocationRequest, "site_latitude" | "site_longitude" | "site_radius_m">) =>
  r.site_latitude !== null && r.site_longitude !== null ? `${r.site_latitude.toFixed(5)}, ${r.site_longitude.toFixed(5)} · ${r.site_radius_m} m` : null;

export function WorkLocationRequestsPage() {
  const [params] = useSearchParams();
  const linked = params.get("request");
  const siteId = params.get("site");
  const modal = useModal();
  const add = useWorkSiteSheet();
  const openSite = useSiteView({ mine: true });
  useScreenAction({ label: "Add Work Site", icon: "pin", onSelect: add });
  useSiteLink(siteId, openSite, { mine: true });
  const requests = usePaged("GET /api/v1/attendance/me/requests");
  const open = useCallback((r: LocationRequest) => modal.open({ title: r.number, body: (close) => <RequestView r={r} close={close} /> }), [modal]);

  const link = useApi("GET /api/v1/attendance/me/requests/:id", { params: { id: linked ?? "" }, enabled: !!linked });
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (link.data && done.current !== link.data.location_request_id) {
      done.current = link.data.location_request_id;
      open(link.data);
    }
  }, [link.data, open]);

  return (
    <>
      <PageHeader
        title="Work Location Requests"
        sub="Working away for some days"
        actions={
          <DesktopOnly>
            <Button variant="primary" icon="plus" onClick={add}>Add Work Site</Button>
          </DesktopOnly>
        }
      />
      <MySites openSite={openSite} />
      {requests.rows.length > 0 && (
        <DataView
          className="mt-3"
          title="My Requests"
          list={requests}
          rowKey={(r) => r.location_request_id}
          onRowClick={open}
          noun="request"
          columns={[
            { key: "n", label: "Request", render: (r) => `${r.number} · ${REQUEST_TYPE[r.request_type]}` },
            { key: "starts_on", label: "Dates", sortable: true, render: requestDates },
            { key: "s", label: "Status", render: requestPill },
            { key: "p", label: "Place", desktop: true, render: requestPlace },
            { key: "w", label: "Waiting On", desktop: true, render: (r) => r.waiting_on },
          ]}
        />
      )}
      <PhoneOnly className="mt-3">
        <Button variant="primary" icon="plus" block onClick={add}>Add Work Site</Button>
      </PhoneOnly>
    </>
  );
}

const MOVE: Record<ApprovalDecision["decision"], (who: string) => string> = {
  approve: (who) => `Approved by ${who}`,
  reject: (who) => `Rejected by ${who}`,
  cancel: () => "Withdrawn",
  timeout_approve: () => "Approved when time ran out",
  timeout_reject: () => "Rejected when time ran out",
  reassign: (who) => `Passed on by ${who}`,
  request_changes: (who) => `Changes asked by ${who}`,
};

/** A request's approval: the route, then each move on it with its reason. */
export function RequestApproval({ instanceId }: { instanceId: string }) {
  const flow = useApi("GET /api/v1/workflow/instances/:id", { params: { id: instanceId } });
  const f = flow.data;
  return (
    <Card className="mt-3">
      <CardHeader title="Approval" />
      {f ? (
        <>
          <Chain steps={f.route.map((s) => ({ label: s.name, state: s.state === "done" || s.state === "now" ? s.state : undefined }))} />
          {f.decisions.length > 0 && (
            <Timeline
              className="mt-3"
              items={f.decisions.map((d) => ({
                title: MOVE[d.decision](d.actor_name ?? d.stage_name ?? "People"),
                when: formatDateTime(d.decided_at),
                text: d.reason ?? undefined,
                tone: d.decision === "approve" ? ("done" as const) : undefined,
              }))}
            />
          )}
        </>
      ) : flow.error ? (
        <ErrorState error={flow.error} onRetry={flow.reload} />
      ) : (
        <LoadingRows count={2} />
      )}
    </Card>
  );
}

/** One of the person's requests: what was asked, its approval, and Withdraw or Cancel while it may. */
function RequestView({ r, close }: { r: LocationRequest; close: () => void }) {
  const confirm = useConfirm();
  const cancel = useMutation("POST /api/v1/attendance/me/requests/:id/cancel");
  const waiting = r.status === "submitted";
  const cancellable = waiting || (r.status === "approved" && r.starts_on > todayIso());
  const label = waiting ? "Withdraw Request" : "Cancel Request";
  const stop = async () => {
    const yes = await confirm({
      title: label,
      body: waiting ? "It stops waiting on approval." : "Those days go back to your usual clock-in.",
      confirmLabel: label,
      cancelLabel: "Keep It",
      destructive: true,
    });
    if (!yes) return;
    try {
      await cancel.run({ params: { id: r.location_request_id }, body: {} });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(waiting ? "Request withdrawn" : "Request cancelled");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not cancelled. Try again.");
    }
  };
  return (
    <>
      <Card>
        <CardHeader record title={REQUEST_TYPE[r.request_type]} right={requestPill(r)} />
        <KeyValue
          items={[
            ["First Day", formatDate(r.starts_on)],
            ["Last Day", formatDate(r.ends_on)],
            ["Days", String(r.days)],
            ["Place", requestPlace(r)],
            ...(requestSite(r) ? ([["Site", requestSite(r)]] as Array<[string, string]>) : []),
            ...(r.accuracy_m !== null ? ([["Reading", `Accurate to ${Math.round(r.accuracy_m)} m`]] as Array<[string, string]>) : []),
            ["Reason", r.reason],
            ["Requested", formatDateTime(r.requested_at)],
            ...(r.waiting_on ? ([["Waiting On", r.waiting_on]] as Array<[string, string]>) : []),
            ...(r.cancelled_at ? ([["Cancelled", formatDateTime(r.cancelled_at)]] as Array<[string, string]>) : []),
          ]}
        />
      </Card>
      {r.workflow_instance_id && <RequestApproval instanceId={r.workflow_instance_id} />}
      <FormFooter>
        {cancellable && (
          <Button variant="danger" busy={cancel.pending} onClick={stop}>
            {label}
          </Button>
        )}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/** People: a link to a work location request (`?request=`, from a notice or search) opens it in Requests, once. */
export function useRequestLink(id: string | null, openRequest: (r: LocationRequest) => void, toRequests: () => void) {
  const request = useApi("GET /api/v1/attendance/requests/:id", { params: { id: id ?? "" }, enabled: !!id });
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (request.data && done.current !== request.data.location_request_id) {
      done.current = request.data.location_request_id;
      toRequests();
      openRequest(request.data);
    }
  }, [request.data, openRequest, toRequests]);
}

const REQUEST_CHIPS: Array<[LocationRequestStatus | "all", string]> = [
  ["submitted", "Waiting"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
];

/** People · Worksites, Temporary, Requests: the work location requests in the reader's scope made before PR 4, waiting first. */
export function RequestsView({ openRequest }: { openRequest: (r: LocationRequest) => void }) {
  const [status, setStatus] = useState<LocationRequestStatus | "all">("submitted");
  const list = usePaged("GET /api/v1/attendance/requests", { filters: status === "all" ? {} : { status } });
  const news = useViewNews();
  useOpenWhereNews({ value: status, onChange: setStatus, values: REQUEST_CHIPS.map(([v]) => v), at: "temporary/requests", all: "all" });
  return (
    <>
      <Chips label="Requests" value={status} onChange={setStatus} options={withNews(news, REQUEST_CHIPS, { at: "temporary/requests", all: "all" })} />
      <DataView
        title="Requests"
        list={list}
        search="Name or Number"
        rowKey={(r) => r.location_request_id}
        onRowClick={openRequest}
        noun="request"
        empty={{ icon: "target", title: "No Requests Here", text: "Choose All to see every request." }}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
          { key: "n", label: "Request", render: (r) => `${r.number} · ${REQUEST_TYPE[r.request_type]}` },
          { key: "starts_on", label: "Dates", sortable: true, render: requestDates },
          { key: "w", label: "Waiting On", desktop: true, render: (r) => r.waiting_on },
          { key: "s", label: "Status", render: requestPill },
        ]}
      />
    </>
  );
}

/** One request as People see it: what was asked, its approval, and the decision when it waits on the reader. */
export function PeopleRequestView({ r, close }: { r: LocationRequest; close: () => void }) {
  return (
    <>
      <Card>
        <CardHeader record title={REQUEST_TYPE[r.request_type]} right={requestPill(r)} />
        <KeyValue
          items={[
            ["Employee", r.employee.display_name],
            ["First Day", formatDate(r.starts_on)],
            ["Last Day", formatDate(r.ends_on)],
            ["Days", String(r.days)],
            ["Place", requestPlace(r)],
            ...(requestSite(r) ? ([["Site", requestSite(r)]] as Array<[string, string]>) : []),
            ...(r.home_latitude !== null && r.home_longitude !== null
              ? ([["Coordinates", `${r.home_latitude.toFixed(5)}, ${r.home_longitude.toFixed(5)}`]] as Array<[string, string]>)
              : []),
            ...(r.accuracy_m !== null ? ([["Accuracy", `${Math.round(r.accuracy_m)} m`]] as Array<[string, string]>) : []),
            ["Reason", r.reason],
            ["Requested", formatDateTime(r.requested_at)],
            ...(r.waiting_on ? ([["Waiting On", r.waiting_on]] as Array<[string, string]>) : []),
            ...(r.cancel_reason ? ([["Cancel Reason", r.cancel_reason]] as Array<[string, string]>) : []),
          ]}
        />
      </Card>
      {r.workflow_instance_id && <RequestApproval instanceId={r.workflow_instance_id} />}
      {r.can_decide && r.workflow_instance_id ? (
        <RequestDecisionForm r={r} instanceId={r.workflow_instance_id} close={close} />
      ) : (
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      )}
    </>
  );
}

const REQUEST_DECISIONS: Array<["approve" | "reject", string]> = [
  ["approve", "Approve"],
  ["reject", "Reject"],
];

/** The stage waiting on the reader: approve it, or reject it with a reason the person reads. */
function RequestDecisionForm({ r, instanceId, close }: { r: LocationRequest; instanceId: string; close: () => void }) {
  const f = useContractForm({ decision: "approve" as "approve" | "reject", reason: "" }, {
    safeParse: (v: unknown) => {
      const x = v as { decision: "approve" | "reject"; reason: string };
      return x.decision === "reject" ? workflow.ReasonBody.safeParse({ reason: x.reason.trim() }) : workflow.ApproveBody.safeParse({});
    },
  });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      if (v.decision === "approve") await approve.run({ params: { id: instanceId }, body: {} });
      else await reject.run({ params: { id: instanceId }, body: { reason: v.reason.trim() } });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(v.decision === "approve" ? `${r.number} approved` : `${r.number} rejected`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Decision not recorded");
    }
  };
  return (
    <Card className="mt-3">
      <CardHeader title="Decide" />
      <Field label="Outcome" {...f.status("decision")}>
        <ChoiceField value={v.decision} onChange={(d) => f.set("decision", d)} options={REQUEST_DECISIONS} />
      </Field>
      {v.decision === "reject" && (
        <Field label="Reason" {...f.status("reason")}>
          <TextAreaField {...f.field("reason")} placeholder="Team is short" rows={3} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={approve.pending || reject.pending} onClick={submit}>Record Decision</Button>
      </FormFooter>
    </Card>
  );
}
