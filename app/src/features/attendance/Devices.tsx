import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { Device } from "@/api/types/attendance";
import { Button } from "@/components/ui/Button";
import { KV, Pill, StatStrip, Who } from "@/components/ui/data";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { Chips, Pager, SearchBox, Table, Toolbar } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { WithInfo } from "@/components/ui/Info";
import { formatDate, formatDateTime } from "@/lib/format";
import { hrefFor, useRouter } from "@/lib/router";

export const DEVICE_TONE: Record<Device["status"], "ok" | "warn" | "err" | "neutral"> = { Enrolled: "ok", "Pending review": "warn", Blocked: "err", Revoked: "neutral", "Verification unavailable": "warn" };

/** People · Devices: devices used to clock in, and what the current policy does with each. */
export function Devices() {
  const { navigate } = useRouter();
  const summary = useApi("GET /api/v1/attendance/devices/summary");
  const [status, setStatus] = useState("all");
  const list = usePaged("GET /api/v1/attendance/devices", { filters: status === "all" ? {} : { status } });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.rows.find((d) => d.device_id === selId) ?? list.rows.find((d) => d.status === "Pending review") ?? list.rows[0];
  const act = useMutation("POST /api/v1/attendance/devices/:id/status");
  const set = async (d: Device, s: Device["status"]) => {
    await act.run({ params: { id: d.device_id }, body: { status: s } });
    invalidate("/api/v1/attendance/devices");
    toast(`${d.name}: ${s.toLowerCase()}. ${d.employee.display_name} has been told.`);
  };
  const others = (d: Device) => list.rows.filter((x) => x.employee.employee_id === d.employee.employee_id && x.device_id !== d.device_id);
  return (
    <>
      <PageHead title="Devices" sub="Devices used to clock in" actions={<Button onClick={() => navigate(hrefFor("settings", "attendance-policy"))}>Device Policy</Button>} />
      {summary.data && <StatStrip items={summary.data.counts} />}
      <Toolbar>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Search device or person" className="w-full md:w-[260px]" />
      </Toolbar>
      <Chips value={status} onChange={setStatus} options={[["all", "All"], ["Pending review", "Pending review"], ["Enrolled", "Enrolled"], ["Blocked", "Blocked"], ["Revoked", "Revoked"]]} />
      <Grid cols="1.4/1">
        <Table
          title="Devices"
          right={<span className="text-[11.5px] text-subtle-foreground">Click a row to review</span>}
          rows={list.rows}
          rowKey={(d) => d.device_id}
          selectedKey={sel?.device_id}
          loading={list.loading}
          error={list.error}
          onRowClick={(d) => setSelId(d.device_id)}
          columns={[
            { key: "e", label: "Employee", render: (d) => <Who name={d.employee.display_name} sub={d.employee.department} /> },
            { key: "n", label: "Device", render: (d) => d.name },
            { key: "f", label: "First Seen", desktop: true, render: (d) => formatDate(d.first_seen) },
            { key: "l", label: "Last Punch", desktop: true, render: (d) => (d.last_punch ? formatDateTime(d.last_punch) : "None") },
            { key: "s", label: "Status", render: (d) => <Pill tone={DEVICE_TONE[d.status]}>{d.status}</Pill> },
            { key: "x", label: "Effect on a Punch", desktop: true, render: (d) => <Pill tone={d.effect.tone}>{d.effect.text}</Pill> },
          ]}
          footer={<Pager page={list.page} onPage={list.setPage} noun="device" />}
        />
        {sel && (
          <Card>
            <CardHeader title={`${sel.employee.display_name} · ${sel.name}`} right={<Pill tone={DEVICE_TONE[sel.status]}>{sel.status}</Pill>} />
            <KV items={[["First seen", formatDateTime(sel.first_seen)], ["Last punch", sel.last_punch ? formatDateTime(sel.last_punch) : "None"], ["Note", sel.note ?? "None"], ["Other devices", others(sel).map((d) => `${d.name} (${d.status.toLowerCase()})`).join(", ") || "None"], ["Next punch", <Pill tone={sel.effect.tone}>{sel.effect.text}</Pill>]]} />
            <div className="mt-[14px] flex flex-wrap gap-2">
              {sel.status !== "Enrolled" && <Button variant="primary" icon="ok" disabled={act.pending} onClick={() => set(sel, "Enrolled")}>Enrol This Device</Button>}
              {sel.status === "Pending review" && <Button disabled={act.pending} onClick={() => set(sel, "Blocked")}>Reject</Button>}
              {sel.status === "Enrolled" && (
                <>
                  <Button disabled={act.pending} onClick={() => set(sel, "Revoked")}>Revoke</Button>
                  <Button disabled={act.pending} onClick={() => set(sel, "Blocked")}>Block</Button>
                </>
              )}
            </div>
            <div className="mt-[11px]">
              <WithInfo heading="Why Devices Are Recorded" label="About device recording">
                Devices register on every punch whether the policy is on or off, so it can be tightened later without losing history.
              </WithInfo>
            </div>
          </Card>
        )}
      </Grid>
      {summary.data && (
        <Table
          title={`How the Current Device Policy Affects a Punch, v${summary.data.policy_version}`}
          rows={summary.data.effects}
          rowKey={(r) => r.state}
          columns={[
            { key: "s", label: "Device State", render: (r) => r.state },
            { key: "e", label: "What Happens on a Punch", render: (r) => <Pill tone={r.effect.tone}>{r.effect.text}</Pill> },
          ]}
        />
      )}
    </>
  );
}
