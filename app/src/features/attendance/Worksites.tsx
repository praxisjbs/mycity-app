import { useState } from "react";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { Worksite } from "@/api/types/attendance";
import { Button } from "@/components/ui/Button";
import { KV, Pill } from "@/components/ui/data";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Chips, Pager, Table, Toolbar } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Field, Input, rules, SearchBox, useForm } from "@/components/form";

const COLOR: Record<Worksite["type"], string> = { Office: "var(--chart-1)", "Approved home": "var(--primary)", "Temporary location": "var(--primary)", "Field assignment": "var(--chart-2)" };

/** A schematic of today's fences. Not to scale; homes are shown by area only. */
function FenceMap({ sites }: { sites: Worksite[] }) {
  return (
    <Card>
      <CardHeader title="Lagos Geofences Today" right={<span className="text-[11.5px] text-subtle-foreground">Schematic, not to scale · homes masked</span>} />
      <div className="relative h-[300px] overflow-hidden rounded-card border border-border bg-muted max-md:h-[200px]">
        <svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet" className="block size-full" role="img" aria-label="Schematic map of Lagos geofences">
          <rect width="1000" height="300" fill="var(--muted)" />
          <path d="M0 230 Q 250 205 500 240 T 1000 228 L1000 300 L0 300Z" fill="var(--chart-2)" opacity=".10" />
          {sites.filter((s) => s.map).map((s, i) => {
            const r = Math.max(9, s.radius_m / 12);
            return (
              <g key={s.location_id}>
                <circle cx={s.map!.x} cy={s.map!.y} r={r} fill={COLOR[s.type]} opacity=".18" />
                <circle cx={s.map!.x} cy={s.map!.y} r="5" fill={COLOR[s.type]} stroke="var(--chart-1)" strokeWidth="1.2" />
                <text x={s.map!.x + 9} y={s.map!.y + (i % 2 ? 14 : -7)} fontSize="11" fill="var(--muted-foreground)">
                  {s.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-[11px] flex flex-wrap gap-[14px] text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="size-[9px] rounded-full bg-chart-1" />Office worksite</span>
        <span className="flex items-center gap-1.5"><i className="size-[9px] rounded-full bg-primary" />Approved home, masked</span>
        <span className="flex items-center gap-1.5"><i className="size-[9px] rounded-full bg-chart-2" />Field assignment today</span>
      </div>
    </Card>
  );
}

export function Worksites() {
  const modal = useModal();
  const [type, setType] = useState("all");
  const list = usePaged("GET /api/v1/attendance/worksites", { filters: type === "all" ? {} : { type } });
  const map = usePaged("GET /api/v1/attendance/worksites");
  const count = (t: string) => map.rows.filter((s) => s.type === t).length;
  return (
    <>
      <PageHead
        title="Worksites"
        sub="Geofenced locations · MTN Head Office is the principal worksite"
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Worksite", body: (close) => <WorksiteForm close={close} /> })}>Add Worksite</Button>}
      />
      <KpiTiles items={[{ label: "Office worksites", value: String(count("Office")) }, { label: "Approved homes", value: String(count("Approved home")) }, { label: "Field sites today", value: String(count("Field assignment")) }, { label: "Outside any fence today", value: "1", tone: "warn" }]} />
      <FenceMap sites={map.rows} />
      <Toolbar className="mt-3">
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Location or person" className="w-full md:w-[260px]" />
      </Toolbar>
      <Chips value={type} onChange={setType} options={[["all", "All"], ["Office", "Offices"], ["Approved home", "Homes"], ["Temporary location", "Temporary"], ["Field assignment", "Field"]]} />
      <Table
        title="All Locations"
        wide
        rows={list.rows}
        rowKey={(r) => r.location_id}
        loading={list.loading}
        error={list.error}
        columns={[
          { key: "n", label: "Location", render: (r) => <b>{r.name}</b> },
          { key: "t", label: "Type", render: (r) => r.type },
          { key: "a", label: "Address", render: (r) => (r.type === "Office" || r.type === "Field assignment" ? r.address : <span className="text-[11.5px] text-subtle-foreground">{r.address}</span>) },
          { key: "r", label: "Radius", render: (r) => `${r.radius_m} m` },
          { key: "e", label: "Assigned Employees", render: (r) => r.assigned },
          { key: "d", label: "Attendance Today", align: "n", render: (r) => r.attendance_today },
          { key: "v", label: "Active Dates", render: (r) => r.dates },
          { key: "m", label: "Enforcement Mode", render: (r) => r.mode },
          { key: "s", label: "Status", render: (r) => <Pill tone={r.status_tone}>{r.status}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="location" />}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="How the Geofence Behaves" />
          <KV items={[["Remote", "Warned outside the approved home, fixed 100 m"], ["Hybrid", "The office on office days, home on remote days"], ["Field", "An approved assignment overrides office and home"], ["Office-only", "Blocked outside the assigned office"], ["Tracking", "None. Location is read only at clock-in and clock-out"]]} />
        </Card>
        <Card>
          <CardHeader title="Why Homes Are Masked" />
          <KV items={[["In this list", "Area only: Approved home · Lekki"], ["Full address", "In the HR detail view, and each view is logged"], ["Who can open it", "People and the CEO. Managers see the area only"], ["History", "A changed home is superseded, never overwritten"]]} />
        </Card>
      </Grid>
    </>
  );
}

function WorksiteForm({ close }: { close: () => void }) {
  const f = useForm({ name: "", address: "", radius_m: "120" }, { name: rules.required("Name the worksite"), address: rules.required("Enter the address"), radius_m: (v) => (/^\d+$/.test(v) && Number(v) >= 50 && Number(v) <= 300 ? null : "Between 50 and 300") });
  const save = useMutation("POST /api/v1/attendance/worksites");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name, address: f.values.address, radius_m: Number(f.values.radius_m) } });
      invalidate("/api/v1/attendance/worksites");
      close();
      toast("Worksite added. It applies from the next punch.");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Worksite Name" {...f.field("name")}><Input {...f.field("name")} placeholder="Enugu Office" /></Field>
      <Field label="Address" {...f.field("address")} info="The address is turned into coordinates when saved; check the pin on the map before staff clock in there."><Input {...f.field("address")} placeholder="Street, area, city" /></Field>
      <Field label="Radius, Metres" {...f.field("radius_m")}><Input inputMode="numeric" {...f.field("radius_m")} /></Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Worksite</Button>
      </div>
    </>
  );
}
