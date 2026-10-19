import attendance from "@mycity/contract/schemas/attendance.js";
import type { ApprovalDecision, LocationRequest, LocationRequestType } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Button, Card, CardHeader, Chain, ChoiceField, DataView, DateField, DesktopOnly, Field, formatDate, formatDateTime, FormFooter, KeyValue, LoadingRows, PageHeader, PhoneOnly, Pill, TextAreaField, TextField, Timeline, toast, todayIso, useConfirm, useContractForm, useModal } from "@mycity/ui";
import { useClock } from "./ClockButton";
import { ReadingStep, useReading } from "./HomeLocation";
import { REQUEST_STATUS, REQUEST_TYPE, REQUEST_TYPE_HELP } from "./labels";

/**
 * ESS · Work Location Requests (#87, docs/guides/attendance.md §6.11, §10): the person's own
 * requests to work somewhere else for some days, each with its approval route, and the New Request
 * sheet. A temporary home carries one reading taken there, as a home does. The sheet offers the
 * types the person's work pattern allows; the API decides.
 */

/** The types each work pattern may ask for (§6.11). */
const TYPES_FOR: Record<string, LocationRequestType[]> = {
  remote: ["temporary_home", "client_visit"],
  hybrid: ["remote_day", "client_visit"],
  on_site: ["remote_day", "client_visit"],
};

export const requestPill = (r: Pick<LocationRequest, "status">) => <Pill tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].text}</Pill>;
export const requestDates = (r: Pick<LocationRequest, "starts_on" | "ends_on">) =>
  r.starts_on === r.ends_on ? formatDate(r.starts_on) : `${formatDate(r.starts_on)} to ${formatDate(r.ends_on)}`;
/** Where the request is for: its address, or home for a remote day without one. */
export const requestPlace = (r: Pick<LocationRequest, "address" | "request_type">) => r.address ?? (r.request_type === "remote_day" ? "Home" : null);

export function WorkLocationRequestsPage() {
  const [params] = useSearchParams();
  const linked = params.get("request");
  const modal = useModal();
  const { today } = useClock();
  const list = usePaged("GET /api/v1/attendance/me/requests");
  const pattern = today?.work_pattern;
  const types = useMemo(() => (pattern ? (TYPES_FOR[pattern] ?? []) : []), [pattern]);
  const max = today?.policy.max_accuracy_m;
  const ask = useCallback(() => modal.open({ title: "New Request", body: (close) => <RequestForm close={close} types={types} max={max ?? 0} /> }), [modal, types, max]);
  useScreenAction(types.length ? { label: "New Request", onSelect: ask } : null);
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
        actions={types.length ? <DesktopOnly><Button variant="primary" icon="plus" onClick={ask}>New Request</Button></DesktopOnly> : undefined}
      />
      <DataView
        title="My Requests"
        list={list}
        rowKey={(r) => r.location_request_id}
        onRowClick={open}
        noun="request"
        empty={{ icon: "target", title: "No Requests Yet", text: "Use New Request to work elsewhere." }}
        columns={[
          { key: "n", label: "Request", render: (r) => `${r.number} · ${REQUEST_TYPE[r.request_type]}` },
          { key: "starts_on", label: "Dates", sortable: true, render: requestDates },
          { key: "s", label: "Status", render: requestPill },
          { key: "p", label: "Place", desktop: true, render: requestPlace },
          { key: "w", label: "Waiting On", desktop: true, render: (r) => r.waiting_on },
        ]}
      />
      {types.length > 0 && (
        <PhoneOnly className="mt-3">
          <Button variant="primary" icon="plus" block onClick={ask}>New Request</Button>
        </PhoneOnly>
      )}
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
        <p className="text-2xs text-subtle-foreground">Not available now</p>
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

type Values = {
  request_type: LocationRequestType;
  starts_on: string;
  ends_on: string;
  address: string;
  reason: string;
  home_latitude: number | null;
  home_longitude: number | null;
  accuracy_m: number | null;
};

/** The body the API takes: the reading only for a temporary home, the address only when written. */
const bodyOf = (v: Values) => ({
  request_type: v.request_type,
  starts_on: v.starts_on,
  ends_on: v.ends_on,
  ...(v.address.trim() && { address: v.address.trim() }),
  reason: v.reason.trim(),
  ...(v.request_type === "temporary_home" && { home_latitude: v.home_latitude, home_longitude: v.home_longitude, accuracy_m: v.accuracy_m }),
});

/** The sheet: the type, the days, where and why; a temporary home takes its reading first. */
function RequestForm({ types, max, close }: { types: LocationRequestType[]; max: number; close: () => void }) {
  const f = useContractForm<Values>(
    { request_type: types[0], starts_on: "", ends_on: "", address: "", reason: "", home_latitude: null, home_longitude: null, accuracy_m: null },
    { safeParse: (v: unknown) => attendance.LocationRequestCreate.safeParse(bodyOf(v as Values)) },
  );
  const send = useMutation("POST /api/v1/attendance/me/requests");
  const { reading, setReading, locate } = useReading(max, (fix) => {
    f.set("home_latitude", fix.latitude);
    f.set("home_longitude", fix.longitude);
    f.set("accuracy_m", fix.accuracy_m);
  });
  const v = f.values;
  const home = v.request_type === "temporary_home";

  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await send.run({ body: bodyOf(v) });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(`${r.number} sent to your line manager`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "HOME_READING_WEAK" && reading.kind === "fix") setReading({ kind: "weak", fix: reading.fix });
      else if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Request not sent");
    }
  };

  return (
    <>
      {home && (
        <div className="mb-3">
          <ReadingStep reading={reading} idle={{ title: "At That Home", text: "Take the reading where you will work." }} />
        </div>
      )}
      <Field label="Type" help={REQUEST_TYPE_HELP} {...f.status("request_type")}>
        <ChoiceField value={v.request_type} onChange={(t) => f.set("request_type", t)} options={types.map((t) => [t, REQUEST_TYPE[t]] as [LocationRequestType, string])} />
      </Field>
      <Field label="First Day" {...f.status("starts_on")}>
        <DateField {...f.field("starts_on")} min={todayIso()} />
      </Field>
      <Field label="Last Day" {...f.status("ends_on")}>
        <DateField {...f.field("ends_on")} min={v.starts_on || todayIso()} />
      </Field>
      <Field label="Address" optional={v.request_type === "remote_day"} {...f.status("address")}>
        <TextField {...f.field("address")} placeholder="Street, area, city" />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Family visit" rows={2} />
      </Field>
      <FormFooter>
        {home && reading.kind !== "fix" ? (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon="target" busy={reading.kind === "locating"} onClick={locate}>
              {reading.kind === "none" ? "Use This Location" : "Retry Location"}
            </Button>
          </>
        ) : (
          <>
            {home ? <Button icon="refresh" onClick={locate}>Retry Location</Button> : <Button onClick={close}>Cancel</Button>}
            <Button variant="primary" icon="send" busy={send.pending} onClick={submit}>Send Request</Button>
          </>
        )}
      </FormFooter>
    </>
  );
}
