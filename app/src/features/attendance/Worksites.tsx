import worksites from "@mycity/contract/schemas/worksites.js";
import type { Worksite, WorksiteEmployee } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { EmployeePicker } from "@/features/shared/pickers";
import { useScreenAction } from "@/shell/screen-action";
import { Button, Card, CardHeader, Chips, DataView, Field, FormFooter, Grid, HelpTerm, KeyValue, NumberField, PageHeader, Pill, TextField, toast, useConfirm, useContractForm, useModal, Who } from "@mycity/ui";
import { PATTERN } from "./labels";

/**
 * People · Worksites (#28, docs/guides/attendance.md §10): the offices a punch is matched to, each
 * a centre, a radius and a timezone, and who is assigned to each. People add, change, retire and
 * restore them; the coordinates are typed until the map's address search is served (§13).
 */
export function Worksites() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const { can } = useAuth();
  const modal = useModal();
  const [active, setActive] = useState<"true" | "false" | "all">("true");
  const list = usePaged("GET /api/v1/worksites", { filters: active === "all" ? {} : { active }, sort: "name" });
  const add = () => modal.open({ title: "Add Worksite", body: (close) => <WorksiteForm close={close} /> });
  const open = (w: Worksite) => modal.open({ title: w.name, wide: true, body: (close) => <WorksiteView id={w.worksite_id} close={close} /> });
  useScreenAction(can("people", "create") ? { label: "Add Worksite", onSelect: add } : null);

  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (id && opened.current !== id) {
      opened.current = id;
      modal.open({ title: "Worksite", wide: true, body: (close) => <WorksiteView id={id} close={close} /> });
    }
  }, [id, modal]);

  return (
    <>
      <PageHeader title="Worksites" sub="Where staff clock in" actions={can("people", "create") ? <Button variant="primary" icon="plus" onClick={add}>Add Worksite</Button> : undefined} />
      <Chips
        label="Status"
        value={active}
        onChange={setActive}
        options={[
          ["true", "In Use"],
          ["false", "Retired"],
          ["all", "All"],
        ]}
      />
      <DataView
        title="Worksites"
        list={list}
        search="Name or Address"
        rowKey={(w) => w.worksite_id}
        onRowClick={open}
        noun="worksite"
        empty={{ icon: "pin", title: "No Worksites Yet", text: "Add the offices staff clock in at." }}
        columns={[
          { key: "name", label: "Worksite", sortable: true, render: (w) => w.name },
          { key: "c", label: "Code", desktop: true, render: (w) => w.code },
          { key: "a", label: "Address", desktop: true, render: (w) => w.address },
          { key: "r", label: <HelpTerm help="A punch inside this distance from the centre counts as on site.">Radius</HelpTerm>, align: "n", render: (w) => `${w.radius_m} m` },
          { key: "e", label: "Assigned", align: "n", render: (w) => w.assigned_count },
          { key: "s", label: "Status", render: (w) => (w.active ? <Pill tone="ok">In Use</Pill> : <Pill>Retired</Pill>) },
        ]}
      />
    </>
  );
}

/** One worksite: where it is, its fence, and the people assigned to it. */
function WorksiteView({ id, close }: { id: string; close: () => void }) {
  const { can } = useAuth();
  const modal = useModal();
  const confirm = useConfirm();
  const site = useApi("GET /api/v1/worksites/:id", { params: { id } });
  const people = usePaged("GET /api/v1/worksites/:id/employees", { params: { id } });
  const photo = usePhotos(people.rows.map((e) => e.photo_url));
  const save = useMutation("PATCH /api/v1/worksites/:id");
  const w = site.data;
  if (!w) return site.error ? <p className="text-sm">{site.error.message}</p> : null;

  const setActive = async (active: boolean) => {
    if (!active && !(await confirm({ title: "Retire Worksite", body: `Punches from its ${w.assigned_count} people stop being matched to it.`, confirmLabel: "Retire Worksite", destructive: true }))) return;
    try {
      await save.run({ params: { id }, body: { active } });
      invalidate("/api/v1/worksites");
      toast(active ? "Worksite restored" : "Worksite retired");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not saved");
    }
  };
  const edit = () => modal.open({ title: "Edit Worksite", body: (c) => <WorksiteForm close={c} site={w} /> });
  const assign = () => modal.open({ title: "Assign Employee", body: (c) => <AssignForm close={c} site={w} /> });

  return (
    <>
      <Grid cols={2}>
        <Card>
          <CardHeader record title={w.code} right={w.active ? <Pill tone="ok">In Use</Pill> : <Pill>Retired</Pill>} />
          <KeyValue
            items={[
              ["Address", w.address],
              ["Centre", `${w.latitude.toFixed(5)}, ${w.longitude.toFixed(5)}`],
              ["Radius", `${w.radius_m} m`],
              ["Timezone", w.timezone],
              ["Assigned", String(w.assigned_count)],
            ]}
          />
        </Card>
        <DataView
          title="Assigned People"
          list={people}
          rowKey={(e: WorksiteEmployee) => e.employee_id}
          noun="person"
          nounPlural="people"
          actions={can("people", "edit") && w.active ? <Button size="sm" icon="plus" onClick={assign}>Assign Employee</Button> : undefined}
          empty={{ icon: "users", title: "Nobody Assigned", text: "Assign the people who work here." }}
          columns={[
            { key: "n", label: "Employee", render: (e: WorksiteEmployee) => <Who name={e.display_name} sub={e.job_title} src={photo(e.photo_url)} /> },
            { key: "p", label: "Arrangement", render: (e: WorksiteEmployee) => PATTERN[e.work_pattern] },
          ]}
        />
      </Grid>
      <FormFooter>
        {can("people", "edit") && (
          <>
            <Button busy={save.pending} onClick={() => setActive(!w.active)}>{w.active ? "Retire Worksite" : "Restore Worksite"}</Button>
            <Button icon="edit" onClick={edit}>Edit Worksite</Button>
          </>
        )}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

type Values = { name: string; address: string; latitude: string; longitude: string; radius_m: string };
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const bodyOf = (v: Values) => ({ name: v.name, address: v.address, latitude: num(v.latitude), longitude: num(v.longitude), radius_m: num(v.radius_m) });

/** Add a worksite, or change one. The numbers are typed as text and checked as numbers by the contract. */
function WorksiteForm({ close, site }: { close: () => void; site?: Worksite }) {
  const f = useContractForm<Values>(
    {
      name: site?.name ?? "",
      address: site?.address ?? "",
      latitude: site ? String(site.latitude) : "",
      longitude: site ? String(site.longitude) : "",
      radius_m: site ? String(site.radius_m) : "100",
    },
    { safeParse: (v: Values) => worksites.WorksiteCreate.safeParse(bodyOf(v)) },
  );
  const create = useMutation("POST /api/v1/worksites");
  const update = useMutation("PATCH /api/v1/worksites/:id");
  const busy = create.pending || update.pending;
  const submit = async () => {
    if (!f.check()) return;
    const b = bodyOf(f.values) as { name: string; address: string; latitude: number; longitude: number; radius_m: number };
    try {
      if (site) await update.run({ params: { id: site.worksite_id }, body: b });
      else await create.run({ body: b });
      invalidate("/api/v1/worksites");
      close();
      toast(site ? "Worksite saved" : "Worksite added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Not saved");
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Lekki Office" maxLength={120} />
      </Field>
      <Field label="Address" optional {...f.status("address")}>
        <TextField {...f.field("address")} placeholder="7 Admiralty Way" maxLength={300} />
      </Field>
      <Grid cols={2}>
        <Field label="Latitude" {...f.status("latitude")}>
          <NumberField decimal {...f.field("latitude")} placeholder="6.4470" />
        </Field>
        <Field label="Longitude" {...f.status("longitude")}>
          <NumberField decimal {...f.field("longitude")} placeholder="3.4720" />
        </Field>
      </Grid>
      <Field label={<HelpTerm help="A punch inside this distance from the centre counts as on site. Between 25 and 1000 metres.">Radius, Metres</HelpTerm>} {...f.status("radius_m")}>
        <NumberField {...f.field("radius_m")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => submit()}>{site ? "Save Worksite" : "Add Worksite"}</Button>
      </FormFooter>
    </>
  );
}

/** Assign someone to a worksite; assigning someone already elsewhere moves them. */
function AssignForm({ close, site }: { close: () => void; site: Worksite }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/worksites/:id/employees");
  const submit = async () => {
    setTried(true);
    if (!who[0]) return;
    try {
      await save.run({ params: { id: site.worksite_id }, body: { employee_id: who[0].employee_id } });
      invalidate("/api/v1/worksites");
      close();
      toast(`${who[0].display_name} assigned`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not assigned");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who[0] ? "bad" : undefined} message="Pick someone">
        <EmployeePicker value={who} onChange={setWho} placeholder="Search people" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>Assign Employee</Button>
      </FormFooter>
    </>
  );
}
