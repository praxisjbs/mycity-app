import worksites from "@mycity/contract/schemas/worksites.js";
import type { Worksite, WorksiteEmployee } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { useOpenWhereNews, useViewNews, withNews } from "@/features/notifications/marks";
import { EmployeePicker } from "@/features/shared/pickers";
import { coordinatesOf, lineOf, loadTile, places, placeValue, pointOf, zoomFor } from "@/features/shared/places";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import type { FieldAssignment, LocationRequest } from "@mycity/contract/contract.gen.ts";
import { AddressField, Button, Card, CardHeader, Chips, DataView, Field, FormFooter, Grid, HelpTerm, KeyValue, MapView, NumberField, PageHeader, Pill, SegmentedControl, TextField, toast, useConfirm, useContractForm, useModal, Who, type PlaceValue } from "@mycity/ui";
import { AssignmentView, FieldView, useAssignmentLink } from "./FieldAssignments";
import { PATTERN } from "./labels";
import { SiteMap } from "./SiteMap";
import { TemporarySitesView, useSiteLink, useSiteView, useWorkSiteSheet } from "./TemporarySites";
import { PeopleRequestView, RequestsView, useRequestLink } from "./WorkLocationRequests";

/**
 * People · Worksites (#28, docs/guides/attendance.md §10), Permanent or Temporary. Permanent: the
 * offices a punch is matched to, each a centre, a radius and a timezone, and who is assigned to
 * each. People add, change, retire and restore them; the address is picked from the search or
 * pinned (F27), and the place picked fills the centre, drawn on a map with its fence. Temporary:
 * the temporary sites in the reader's scope (§6.11), Add Temporary Site, each site's approval, and
 * while any made before PR 4 waits or is in force, the old Requests and Field beside them. Each
 * side and view carries what waits on the reader there, and the screen opens where it waits
 * (docs/guides/notifications.md §6).
 */
type Side = "permanent" | "temporary";
type Temporary = "sites" | "requests" | "field";
const SIDES: Array<[Side, string]> = [
  ["permanent", "Permanent"],
  ["temporary", "Temporary"],
];
const VIEWS: Array<[Temporary, string]> = [
  ["sites", "Sites"],
  ["requests", "Requests"],
  ["field", "Field"],
];

export function Worksites() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const linked = params.get("site") || params.get("request") || params.get("assignment");
  const { can } = useAuth();
  const [side, setSide] = useState<Side>(linked ? "temporary" : "permanent");
  const toTemporary = useCallback(() => setSide("temporary"), []);
  // A link that arrives while the screen is open (from the bell, ⌘K) picks its side too.
  useEffect(() => {
    if (linked) setSide("temporary");
    else if (id) setSide("permanent");
  }, [linked, id]);
  const news = useViewNews();
  useOpenWhereNews({ value: side, onChange: setSide, values: ["permanent", "temporary"], skip: Boolean(linked || id) });
  const addSite = useWorkSiteSheet({ direct: true });
  const mayAddSite = can("people", "approve");
  useUrlAction("temporary-site", mayAddSite ? () => (setSide("temporary"), addSite()) : null);
  return (
    <>
      <PageHeader
        title="Worksites"
        sub="Where staff clock in"
        actions={
          side === "permanent" ? (
            can("people", "create") ? <PermanentAdd /> : undefined
          ) : mayAddSite ? (
            <Button variant="primary" icon="plus" onClick={addSite}>Add Temporary Site</Button>
          ) : undefined
        }
      />
      <div className="mb-3">
        <SegmentedControl label="Worksites" value={side} onChange={(v) => setSide(v as Side)} options={withNews(news, SIDES)} />
      </div>
      {side === "permanent" ? <Permanent id={id} /> : <TemporarySide addSite={mayAddSite ? addSite : null} toTemporary={toTemporary} linked={Boolean(linked)} />}
    </>
  );
}

/** The header's Add Worksite, for People who add worksites. */
function PermanentAdd() {
  const modal = useModal();
  return <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Worksite", body: (close) => <WorksiteForm close={close} /> })}>Add Worksite</Button>;
}

/**
 * Temporary: the sites, and while any made before PR 4 is listed or something about one waits on
 * the reader, the old requests and field assignments as their own views. A link (`?site=`,
 * `?request=`, `?assignment=`) opens its record in its view.
 */
function TemporarySide({ addSite, toTemporary, linked }: { addSite: (() => void) | null; toTemporary: () => void; linked: boolean }) {
  const [params] = useSearchParams();
  const modal = useModal();
  const [view, setView] = useState<Temporary>("sites");
  useScreenAction(addSite ? { label: "Add Temporary Site", onSelect: addSite } : null);
  const openSite = useSiteView();
  const toSites = useCallback(() => {
    toTemporary();
    setView("sites");
  }, [toTemporary]);
  useSiteLink(params.get("site"), openSite, { before: toSites });
  const openRequest = useCallback((r: LocationRequest) => modal.open({ title: `${r.number} · ${r.employee.display_name}`, body: (close) => <PeopleRequestView r={r} close={close} /> }), [modal]);
  const toRequests = useCallback(() => setView("requests"), []);
  useRequestLink(params.get("request"), openRequest, toRequests);
  const openAssignment = useCallback((a: FieldAssignment) => modal.open({ title: a.number, wide: true, body: (close) => <AssignmentView a={a} close={close} /> }), [modal]);
  const toField = useCallback(() => setView("field"), []);
  useAssignmentLink(params.get("assignment"), openAssignment, { before: toField });
  // The old views stay while anything made before PR 4 still waits or is in force.
  const waiting = usePaged("GET /api/v1/attendance/requests", { filters: { status: "submitted" } });
  const approved = usePaged("GET /api/v1/attendance/requests", { filters: { status: "approved" } });
  const fieldNow = usePaged("GET /api/v1/attendance/field-assignments", { filters: { state: "in_progress" } });
  const fieldNext = usePaged("GET /api/v1/attendance/field-assignments", { filters: { state: "upcoming" } });
  const live = waiting.rows.length + approved.rows.length + fieldNow.rows.length + fieldNext.rows.length > 0;
  const news = useViewNews();
  useOpenWhereNews({ value: view, onChange: setView, values: ["sites", "requests", "field"], at: "temporary", skip: linked });
  const elsewhere = Boolean(news("temporary/requests") || news("temporary/field"));
  return (
    <>
      {(live || elsewhere || view !== "sites") && (
        <div className="mb-3">
          <SegmentedControl label="Temporary" value={view} onChange={(v) => setView(v as Temporary)} options={withNews(news, VIEWS, { at: "temporary" })} />
        </div>
      )}
      {view === "sites" ? <TemporarySitesView openSite={openSite} /> : view === "requests" ? <RequestsView openRequest={openRequest} /> : <FieldView openAssignment={openAssignment} />}
    </>
  );
}

/** Permanent: the worksites, and one opened by its link (`?id=`). */
function Permanent({ id }: { id: string | null }) {
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
          <MapView
            className="mt-3"
            height="sm"
            zoom={zoomFor(w.radius_m)}
            markers={[{ key: w.worksite_id, lat: w.latitude, lon: w.longitude, label: w.name, tone: "brand" }]}
            radiusMetres={w.radius_m}
            loadTile={loadTile}
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

type Values = { name: string; address: PlaceValue | null; latitude: string; longitude: string; radius_m: string };
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const bodyOf = (v: Values) => ({ name: v.name, ...(v.address ? { address: v.address } : {}), latitude: num(v.latitude), longitude: num(v.longitude), radius_m: num(v.radius_m) });

/**
 * Add a worksite, or change one. The address is picked or pinned (F27) and the place picked
 * fills Latitude and Longitude, which stay open to correct, by typing or by tapping the map.
 * A centre the person gives with no address yet is named from a pin. The numbers are typed as
 * text and checked as numbers by the contract.
 */
function WorksiteForm({ close, site }: { close: () => void; site?: Worksite }) {
  const f = useContractForm<Values>(
    {
      name: site?.name ?? "",
      address: placeValue(site?.address_place),
      latitude: site ? String(site.latitude) : "",
      longitude: site ? String(site.longitude) : "",
      radius_m: site ? String(site.radius_m) : "100",
    },
    { safeParse: (v: Values) => worksites.WorksiteCreate.safeParse(bodyOf(v)) },
  );
  const create = useMutation("POST /api/v1/worksites");
  const update = useMutation("PATCH /api/v1/worksites/:id");
  const busy = create.pending || update.pending;
  const { set } = f;
  const point = pointOf(f.values.latitude, f.values.longitude);
  // Only a centre the person moved is named: a picked place brings its own address, and an
  // existing worksite opened for a change is left as it was. Each centre is asked about once,
  // so an address cleared on purpose is not written back for the same point.
  const moved = useRef(false);
  const asked = useRef<string | null>(null);
  const typed = (key: "latitude" | "longitude") => (value: string) => {
    moved.current = true;
    set(key, value);
  };
  const address = f.values.address;
  const lat = point?.lat;
  const lon = point?.lon;
  useEffect(() => {
    if (!moved.current || lat === undefined || lon === undefined || address) return;
    const at = `${lat},${lon}`;
    if (asked.current === at) return;
    let live = true;
    const timer = setTimeout(() => {
      asked.current = at;
      places
        .pin({ lat, lon }, { level: "address" })
        .then((found) => live && found.token && set("address", { token: found.token, details: null }))
        // Address search is off or down: the field stays the person's to pick.
        .catch(() => undefined);
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lat, lon, address, set]);
  const submit = async () => {
    if (!f.check()) return;
    const b = bodyOf(f.values) as { name: string; address?: PlaceValue; latitude: number; longitude: number; radius_m: number };
    try {
      // A change sends the address as it stands: null clears it, an untouched one goes back as it came.
      if (site) await update.run({ params: { id: site.worksite_id }, body: { ...b, address: f.values.address } });
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
        <AddressField
          {...f.field("address")}
          places={places}
          near={point}
          onPick={(place) => {
            const at = coordinatesOf(place);
            f.set("latitude", at.latitude);
            f.set("longitude", at.longitude);
          }}
        />
      </Field>
      <Grid cols={2}>
        <Field label="Latitude" {...f.status("latitude")}>
          <NumberField decimal {...f.field("latitude")} onChange={typed("latitude")} placeholder="6.4470" />
        </Field>
        <Field label="Longitude" {...f.status("longitude")}>
          <NumberField decimal {...f.field("longitude")} onChange={typed("longitude")} placeholder="3.4720" />
        </Field>
      </Grid>
      <Field label={<HelpTerm help="A punch inside this distance from the centre counts as on site. Between 25 and 1000 metres.">Radius, Metres</HelpTerm>} {...f.status("radius_m")}>
        <NumberField {...f.field("radius_m")} />
      </Field>
      <SiteMap
        latitude={f.values.latitude}
        longitude={f.values.longitude}
        radius={f.values.radius_m}
        min={25}
        max={1000}
        label={lineOf(f.values.address) || f.values.name}
        onMove={(latitude, longitude) => {
          typed("latitude")(latitude);
          typed("longitude")(longitude);
        }}
      />
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
