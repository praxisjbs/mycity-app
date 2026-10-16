import { useState } from "react";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { Worksite } from "@/api/types/attendance";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Button, Card, CardHeader, Chips, DataView, Field, FormFooter, PageHeader, Pager, Pill, rules, SearchInput, TextField, toast, Toolbar, useContractForm, useModal } from "@mycity/ui";

const COLOR: Record<Worksite["type"], string> = { Office: "var(--chart-1)", "Approved home": "var(--primary)", "Temporary location": "var(--primary)", "Field assignment": "var(--chart-2)" };

/** A schematic of today's fences. Not to scale; homes are shown by area only. */
function FenceMap({ sites }: { sites: Worksite[] }) {
  return (
    <Card>
      <CardHeader title="Lagos Geofences Today" />
      <div className="relative h-72 overflow-hidden rounded-card border border-border bg-muted max-md:h-48">
        <svg data-copy="content" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet" className="block size-full" role="img" aria-label="Schematic map of Lagos geofences">
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
      <div className="mt-2.5 flex flex-wrap gap-3.5 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-1" />Office worksite</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-primary" />Approved home, masked</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-2" />Field assignment today</span>
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
      <PageHeader
        title="Worksites"
        sub="Geofenced offices, homes and field sites"
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Worksite", body: (close) => <WorksiteForm close={close} /> })}>Add Worksite</Button>}
      />
      <KpiTiles items={[{ label: "Office Worksites", value: String(count("Office")) }, { label: "Approved Homes", value: String(count("Approved home")) }, { label: "Field Sites Today", value: String(count("Field assignment")) }, { label: "Outside Any Fence Today", value: "1", tone: "warn" }]} />
      <FenceMap sites={map.rows} />
      <Toolbar className="mt-3">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Location or person" className="w-full md:w-64" />
      </Toolbar>
      <Chips value={type} onChange={setType} options={[["all", "All"], ["Office", "Offices"], ["Approved home", "Homes"], ["Temporary location", "Temporary"], ["Field assignment", "Field"]]} />
      <DataView
        title="All Locations"
        wide
        rows={list.rows}
        rowKey={(r) => r.location_id}
        loading={list.loading}
        error={list.error}
        columns={[
          { key: "n", label: "Location", render: (r) => <b>{r.name}</b> },
          { key: "t", label: "Type", render: (r) => r.type },
          { key: "a", label: "Address", render: (r) => (r.type === "Office" || r.type === "Field assignment" ? r.address : <span className="text-2xs text-subtle-foreground">{r.address}</span>) },
          { key: "r", label: "Radius", render: (r) => `${r.radius_m} m` },
          { key: "e", label: "Assigned Employees", render: (r) => r.assigned },
          { key: "d", label: "Attendance Today", align: "n", render: (r) => r.attendance_today },
          { key: "v", label: "Active Dates", render: (r) => r.dates },
          { key: "m", label: "Enforcement Mode", render: (r) => r.mode },
          { key: "s", label: "Status", render: (r) => <Pill tone={r.status_tone}>{r.status}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="location" />}
      />
    </>
  );
}

function WorksiteForm({ close }: { close: () => void }) {
  const f = useContractForm({ name: "", address: "", radius_m: "120" }, { name: rules.required("Name the worksite"), address: rules.required("Enter the address"), radius_m: (v) => (/^\d+$/.test(v) && Number(v) >= 50 && Number(v) <= 300 ? null : "Between 50 and 300") });
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
      <Field label="Worksite Name" {...f.field("name")}><TextField {...f.field("name")} placeholder="Enugu Office" /></Field>
      <Field label="Address" {...f.field("address")} info="The address is turned into coordinates when saved; check the pin on the map before staff clock in there."><TextField {...f.field("address")} placeholder="Street, area, city" /></Field>
      <Field label="Radius, Metres" {...f.field("radius_m")}><TextField inputMode="numeric" {...f.field("radius_m")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Worksite</Button>
      </FormFooter>
    </>
  );
}
