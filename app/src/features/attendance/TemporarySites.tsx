import attendance from "@mycity/contract/schemas/attendance.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { AttendanceEvent, CheckIn, TemporarySite, TemporarySiteCreate, TemporarySiteHours, TemporarySiteLocation, TemporarySitePurpose, TemporarySiteState } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { ColleaguePicker, EmployeePicker } from "@/features/shared/pickers";
import { lineOf, loadTile, places, zoomFor } from "@/features/shared/places";
import { AddressField, Button, Card, CardHeader, ChoiceField, Chips, DataView, DateField, Field, formatDate, formatDateTime, formatTime, FormFooter, Grid, HelpTerm, KeyValue, MapView, NumberField, Pill, SelectField, TextAreaField, TextField, TimeField, Timeline, toast, todayIso, useContractForm, useModal, Who, type PlaceValue } from "@mycity/ui";
import { checkInShown, SITE_PURPOSE, SITE_STATE } from "./labels";
import { RequestApproval } from "./WorkLocationRequests";

/**
 * Temporary sites (docs/guides/attendance.md §6.11, §10): somewhere else to work for some days.
 * The Add Work Site sheet, opening on the site's hours (Home · Overview and ESS · Work Location
 * Requests, sent for approval; People · Worksites' Add Temporary Site, in force once saved), a site's own view with its
 * addresses, people and approval, People's list on Worksites' Temporary side, and the person's own
 * on Work Location Requests and My Attendance. The API decides who may see, decide or change one;
 * `can_decide`, `can_change` and `can_withdraw` say what this reader may.
 */

/** The most addresses a site takes (the contract's), and the radius a new one starts at (T9). */
const MAX_ADDRESSES = 8;
const RADIUS = "150";
const RADIUS_HELP = "A punch within it counts here. Between 150 and 500 metres.";
const DESCRIPTION_HELP = "People approve from this; name an out-of-station letter if you have one.";

export const sitePill = (s: Pick<TemporarySite, "state">) => <Pill tone={SITE_STATE[s.state].tone}>{SITE_STATE[s.state].text}</Pill>;
/** A site's hours as people read them: Usual Shift, or its own start and end. */
export const siteHours = (s: Pick<TemporarySite, "hours" | "starts_at" | "ends_at">) => (s.hours === "site" ? `${s.starts_at} to ${s.ends_at}` : "Usual Shift");
const HOURS: Array<[TemporarySiteHours, string]> = [
  ["usual", "Usual Shift"],
  ["site", "Site Hours"],
];
const HOURS_HELP = "Site Hours: every day of the site, weekends too, from its start to its end. Usual Shift: your normal hours.";
export const siteDates = (s: Pick<TemporarySite, "starts_on" | "ends_on">) =>
  s.starts_on === s.ends_on ? formatDate(s.starts_on) : `${formatDate(s.starts_on)} to ${formatDate(s.ends_on)}`;
const peopleOf = (s: TemporarySite) => {
  const on = s.members.filter((m) => !m.removed_at).map((m) => m.employee.display_name);
  return on.length <= 2 ? on.join(", ") : `${on.slice(0, 2).join(", ")} and ${on.length - 2} more`;
};
/** An address's label: its own, else Temporary Home or its place in the list. */
const addressName = (s: Pick<TemporarySite, "purpose">, l: Pick<TemporarySiteLocation, "name" | "position">) =>
  l.name ?? (s.purpose === "temporary_home" ? "Temporary Home" : `Address ${l.position}`);

const PURPOSES = (Object.keys(SITE_PURPOSE) as TemporarySitePurpose[]).map((p) => [p, SITE_PURPOSE[p]] as [TemporarySitePurpose, string]);

const STATE_CHIPS: Array<[TemporarySiteState | "all", string]> = [
  ["all", "All"],
  ["submitted", "Awaiting Approval"],
  ["in_progress", "In Progress"],
  ["upcoming", "Upcoming"],
  ["done", "Done"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
];

/**
 * Opens the sheet. `direct` is People's Add Temporary Site: anyone but the reader, from the
 * employee list, in force once saved; otherwise Add Work Site, for the reader and colleagues,
 * sent to People for approval.
 */
export function useWorkSiteSheet({ direct = false }: { direct?: boolean } = {}) {
  const modal = useModal();
  return useCallback(
    () => modal.open({ title: direct ? "Add Temporary Site" : "Add Work Site", wide: true, full: true, body: (close) => <WorkSiteForm close={close} direct={direct} /> }),
    [modal, direct],
  );
}

/** Opens one site: the person's own (`mine`), or as People see it. */
export function useSiteView({ mine = false }: { mine?: boolean } = {}) {
  const modal = useModal();
  return useCallback(
    (s: TemporarySite) => modal.open({ title: `${s.number} · ${s.name}`, wide: true, body: (close) => <SiteView s={s} mine={mine} close={close} /> }),
    [modal, mine],
  );
}

/** A link to a site (`?site=`, from a notice or search) opens it, once. */
export function useSiteLink(id: string | null, open: (s: TemporarySite) => void, { mine = false, before }: { mine?: boolean; before?: () => void } = {}) {
  const people = useApi("GET /api/v1/attendance/temporary-sites/:id", { params: { id: id ?? "" }, enabled: !!id && !mine });
  const own = useApi("GET /api/v1/attendance/me/temporary-sites/:id", { params: { id: id ?? "" }, enabled: !!id && mine });
  const data = mine ? own.data : people.data;
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (data && done.current !== data.temporary_site_id) {
      done.current = data.temporary_site_id;
      before?.();
      open(data);
    }
  }, [data, open, before]);
}

/** People · Worksites, Temporary: the sites with anyone in the reader's scope on them, waiting first. */
export function TemporarySitesView({ openSite }: { openSite: (s: TemporarySite) => void }) {
  const [state, setState] = useState<TemporarySiteState | "all">("all");
  const list = usePaged("GET /api/v1/attendance/temporary-sites", { filters: state === "all" ? {} : { state } });
  return (
    <>
      <Chips label="Temporary Sites" value={state} onChange={setState} options={STATE_CHIPS} />
      <DataView
        title="Temporary Sites"
        list={list}
        search="Name, Number or Person"
        rowKey={(s) => s.temporary_site_id}
        onRowClick={openSite}
        noun="site"
        empty={{ icon: "pin", title: "No Sites Here", text: "Choose All to see every site." }}
        columns={[
          { key: "n", label: "Site", render: (s) => `${s.number} · ${s.name}` },
          { key: "p", label: "Purpose", render: (s) => SITE_PURPOSE[s.purpose] },
          { key: "starts_on", label: "Dates", sortable: true, render: siteDates },
          { key: "e", label: "People", desktop: true, render: peopleOf },
          { key: "s", label: "State", render: sitePill },
        ]}
      />
    </>
  );
}

/** ESS · Work Location Requests: the sites the person submitted or is on. */
export function MySites({ openSite }: { openSite: (s: TemporarySite) => void }) {
  const list = usePaged("GET /api/v1/attendance/me/temporary-sites");
  return (
    <DataView
      title="My Temporary Sites"
      list={list}
      rowKey={(s) => s.temporary_site_id}
      onRowClick={openSite}
      noun="site"
      empty={{ icon: "pin", title: "No Temporary Sites", text: "Use Add Work Site to work elsewhere." }}
      columns={[
        { key: "n", label: "Site", render: (s) => `${s.number} · ${s.name}` },
        { key: "p", label: "Purpose", desktop: true, render: (s) => SITE_PURPOSE[s.purpose] },
        { key: "starts_on", label: "Dates", sortable: true, render: siteDates },
        { key: "s", label: "State", render: sitePill },
      ]}
    />
  );
}

/** My Attendance: the person's sites waiting, in progress or to come, when there are any. */
export function MyTemporarySites({ openSite }: { openSite: (s: TemporarySite) => void }) {
  const list = usePaged("GET /api/v1/attendance/me/temporary-sites");
  const current = list.rows.filter((s) => s.state === "submitted" || s.state === "in_progress" || s.state === "upcoming");
  if (!current.length) return null;
  return (
    <DataView
      className="mt-3"
      title="Temporary Sites"
      rows={current}
      rowKey={(s) => s.temporary_site_id}
      onRowClick={openSite}
      noun="site"
      columns={[
        { key: "n", label: "Site", render: (s) => `${s.number} · ${s.name}` },
        { key: "p", label: "Purpose", desktop: true, render: (s) => SITE_PURPOSE[s.purpose] },
        { key: "d", label: "Dates", render: siteDates },
        { key: "s", label: "State", render: sitePill },
      ]}
    />
  );
}

/** Metres under a kilometre, kilometres after. */
const far = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** A check-in's line: its address, then Inside, Recorded or Flagged with how far it was. */
export const checkInLine = (c: CheckIn) =>
  [c.address ?? c.home_address, `${checkInShown(c).text}${c.verdict === "outside" && c.distance_m !== null ? `, ${far(c.distance_m)} away` : ""}`].filter(Boolean).join(" · ");

/**
 * A temporary site's day in time order: the clock-in, each check-in with its address and verdict,
 * then the clock-out (§6.12). Nothing on a day with no check-ins: the punches say it all.
 */
export function DayRoute({ punches, checkIns, className }: { punches: AttendanceEvent[]; checkIns: CheckIn[]; className?: string }) {
  if (!checkIns.length) return null;
  const stops = [
    ...punches
      .filter((p) => !p.excluded)
      .map((p) => ({ at: p.occurred_at, title: p.event_type === "clock_in" ? "Clock In" : "Clock Out", text: p.worksite_name ?? undefined, done: true })),
    ...checkIns.map((c) => ({ at: c.occurred_at, title: `Check-In, ${c.location_name}`, text: checkInLine(c), done: !c.flagged })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <Card className={className}>
      <CardHeader title="Route" />
      <Timeline label="Route" items={stops.map((x) => ({ title: x.title, when: formatTime(x.at), text: x.text, tone: x.done ? ("done" as const) : undefined }))} />
    </Card>
  );
}

/** One site: what it is, where, who is on it and its approval; what the reader may do with it. */
export function SiteView({ s, mine, close }: { s: TemporarySite; mine: boolean; close: () => void }) {
  const modal = useModal();
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const active = s.members.filter((m) => !m.removed_at);
  const inForce = s.status === "approved" && (s.state === "upcoming" || s.state === "in_progress");
  const decide = s.can_decide && !!s.workflow_instance_id;
  const after = (done: () => void) => () => (done(), close());
  const takeOff = (employee: PersonRef) =>
    modal.open({ title: `Take Off ${employee.display_name}`, body: (done) => <ReasonForm site={s} action="remove" employee={employee} close={after(done)} /> });
  const cancel = () => modal.open({ title: "Cancel Site", body: (done) => <ReasonForm site={s} action="cancel" close={after(done)} /> });
  const withdraw = () => modal.open({ title: "Withdraw Submission", body: (done) => <ReasonForm site={s} action="withdraw" close={after(done)} /> });
  const reject = () => modal.open({ title: `Reject ${s.number}`, body: (done) => <ReasonForm site={s} action="reject" close={after(done)} /> });
  const approveIt = async () => {
    if (!s.workflow_instance_id) return;
    try {
      await approve.run({ params: { id: s.workflow_instance_id }, body: {} });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(`${s.number} approved`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not approved. Try again.");
    }
  };

  return (
    <>
      <Card>
        <CardHeader record title={s.name} right={sitePill(s)} />
        <KeyValue
          items={[
            ["Number", s.number],
            ["Purpose", SITE_PURPOSE[s.purpose]],
            ["Hours", siteHours(s)],
            ["First Day", formatDate(s.starts_on)],
            ["Last Day", formatDate(s.ends_on)],
            ["Days", String(s.days)],
            ["Added By", s.submitted_by_name],
            ["Added", formatDateTime(s.submitted_at)],
            ...(s.waiting_on ? ([["Waiting On", s.waiting_on]] as Array<[string, string]>) : []),
            ...(s.approved_at ? ([["Approved", `${formatDateTime(s.approved_at)}${s.approved_by_name ? `, ${s.approved_by_name}` : ""}`]] as Array<[string, string]>) : []),
            ...(s.cancelled_at
              ? ([
                  ["Closed", formatDateTime(s.cancelled_at)],
                  ["Reason", s.cancel_reason],
                ] as Array<[string, string | null]>)
              : []),
          ]}
        />
      </Card>
      <Card className="mt-3">
        <CardHeader title="Description" />
        <p className="text-sm" data-copy="content">
          {s.description}
        </p>
      </Card>
      <Card className="mt-3">
        <CardHeader title={s.locations.length === 1 ? "Address" : "Addresses"} />
        {s.locations.map((l) => (
          <SiteAddress key={l.temporary_site_location_id} site={s} l={l} />
        ))}
      </Card>
      <DataView
        className="mt-3"
        title="People"
        rows={s.members}
        rowKey={(m) => m.employee.employee_id}
        onRowClick={s.can_change && active.length > 1 ? (m) => !m.removed_at && takeOff(m.employee) : undefined}
        noun="person"
        nounPlural="people"
        columns={[
          { key: "e", label: "Employee", render: (m) => <Who name={m.employee.display_name} sub={m.employee.department} /> },
          { key: "s", label: "On It", render: (m) => (m.removed_at ? <Pill tone="neutral">Taken Off</Pill> : <Pill tone="ok">On It</Pill>) },
          { key: "r", label: "Reason", desktop: true, render: (m) => m.removed_reason },
        ]}
      />
      {s.workflow_instance_id && <RequestApproval instanceId={s.workflow_instance_id} />}
      <FormFooter>
        {mine && s.can_withdraw && (
          <Button variant="danger" onClick={withdraw}>
            Withdraw Submission
          </Button>
        )}
        {!mine && s.can_change && inForce && (
          <Button variant="danger" onClick={cancel}>
            Cancel Site
          </Button>
        )}
        {decide ? (
          <>
            <Button variant="danger" onClick={reject}>
              Reject
            </Button>
            <Button variant="primary" icon="check" busy={approve.pending} onClick={approveIt}>
              Approve
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/** One address: its label, line and radius, and its fence on a small map when its point is shown. */
function SiteAddress({ site, l }: { site: TemporarySite; l: TemporarySiteLocation }) {
  const lat = l.latitude ?? l.home_latitude;
  const lon = l.longitude ?? l.home_longitude;
  const name = addressName(site, l);
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <KeyValue
        items={[
          ["Label", name],
          ["Address", l.address ?? l.home_address],
          [<HelpTerm key="r" help={RADIUS_HELP}>Radius</HelpTerm>, `${l.radius_m} m`],
          ...(l.timezone !== "Africa/Lagos" ? ([["Time Zone", l.timezone]] as Array<[string, string]>) : []),
        ]}
      />
      {lat !== null && lon !== null && (
        <MapView className="mt-2" height="sm" zoom={zoomFor(l.radius_m)} markers={[{ key: l.temporary_site_location_id, lat, lon, label: name, tone: "brand" }]} radiusMetres={l.radius_m} loadTile={loadTile} />
      )}
    </div>
  );
}

type ReasonAction = "withdraw" | "cancel" | "remove" | "reject";
const REASON_BUTTON: Record<ReasonAction, string> = { withdraw: "Withdraw Submission", cancel: "Cancel Site", remove: "Take Off", reject: "Reject" };
const REASON_HINT: Record<ReasonAction, string> = { withdraw: "Plans changed", cancel: "Client moved it", remove: "Needed in office", reject: "Team is short" };

/** Withdraw, cancel, take someone off or reject, with the reason the people on it read. */
function ReasonForm({ site, action, employee, close }: { site: TemporarySite; action: ReasonAction; employee?: PersonRef; close: () => void }) {
  const f = useContractForm({ reason: "" }, action === "reject" ? workflow.ReasonBody : attendance.TemporarySiteCancel);
  const withdraw = useMutation("POST /api/v1/attendance/me/temporary-sites/:id/withdraw");
  const cancel = useMutation("POST /api/v1/attendance/temporary-sites/:id/cancel");
  const remove = useMutation("POST /api/v1/attendance/temporary-sites/:id/remove");
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const submit = async () => {
    if (!f.check()) return;
    const reason = f.values.reason.trim();
    const params = { id: site.temporary_site_id };
    try {
      if (action === "withdraw") await withdraw.run({ params, body: { reason } });
      else if (action === "cancel") await cancel.run({ params, body: { reason } });
      else if (action === "remove" && employee) await remove.run({ params, body: { employee_id: employee.employee_id, reason } });
      else if (action === "reject" && site.workflow_instance_id) await reject.run({ params: { id: site.workflow_instance_id }, body: { reason } });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(
        action === "withdraw" ? `${site.number} withdrawn` : action === "cancel" ? `${site.number} cancelled` : action === "reject" ? `${site.number} rejected` : `${employee?.display_name ?? "They"} taken off`,
      );
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Not changed. Try again.");
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder={REASON_HINT[action]} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Keep It</Button>
        <Button variant="danger" busy={withdraw.pending || cancel.pending || remove.pending || reject.pending} onClick={submit}>
          {REASON_BUTTON[action]}
        </Button>
      </FormFooter>
    </>
  );
}

type N = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type AddressKey = "name" | "radius";
type Values = {
  hours: TemporarySiteHours;
  starts_at: string;
  ends_at: string;
  purpose: TemporarySitePurpose | "";
  name: string;
  description: string;
  starts_on: string;
  ends_on: string;
  people: PersonRef[];
  count: number;
} & Record<`a${N}_${AddressKey}`, string> &
  Record<`a${N}_address`, PlaceValue | null>;

const SLOTS: N[] = [1, 2, 3, 4, 5, 6, 7, 8];
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
/** How many addresses the sheet sends: one for a Temporary Home, else as many as are open. */
const countOf = (v: Values) => (v.purpose === "temporary_home" ? 1 : v.count);
/** The body the API takes. */
const bodyOf = (v: Values) => ({
  hours: v.hours,
  // A time left empty is sent as none, so the contract asks for it.
  ...(v.hours === "site" && { starts_at: v.starts_at || undefined, ends_at: v.ends_at || undefined }),
  purpose: v.purpose,
  name: v.name.trim(),
  description: v.description.trim(),
  starts_on: v.starts_on,
  ends_on: v.ends_on,
  locations: SLOTS.slice(0, countOf(v)).map((n) => ({
    address: v[`a${n}_address`],
    ...(v[`a${n}_name`].trim() && { name: v[`a${n}_name`].trim() }),
    radius_m: num(v[`a${n}_radius`]),
  })),
  employee_ids: v.people.map((p) => p.employee_id),
});
/** The contract's paths on the form's fields: an address's are per address, the people one field. */
const fieldOf = (path: PropertyKey[]): string => {
  if (path[0] === "employee_ids") return "people";
  if (path[0] === "locations") {
    if (path[1] === undefined) return "a1_address";
    const key = String(path[2] ?? "address");
    return `a${Number(path[1]) + 1}_${key === "radius_m" ? "radius" : key}`;
  }
  return String(path[0]);
};
const remap = (fields: Record<string, string[]>) => Object.fromEntries(Object.entries(fields).map(([k, m]) => [fieldOf(k.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p))), m]));

const blank = (n: N) => ({ [`a${n}_name`]: "", [`a${n}_address`]: null, [`a${n}_radius`]: RADIUS });

/** The point a picked address carries, for its small map. */
const pointOfPlace = (value: PlaceValue | null) => {
  const summary = value?.token ? places.read(value.token) : null;
  return summary && summary.lat !== null && summary.lon !== null ? { lat: summary.lat, lon: summary.lon } : null;
};

/**
 * Add Work Site (Home, ESS) or Add Temporary Site (People): its hours (the Usual Shift, or Site
 * Hours with a start and an end), the purpose, a name, one to eight
 * picked addresses each with its radius, the days, the people and the description People approve
 * from. Add Work Site starts with the reader on it; People's own never puts the reader on it.
 */
export function WorkSiteForm({ close, direct }: { close: () => void; direct: boolean }) {
  const me = useMe();
  const self: PersonRef = { employee_id: me.employee_id, display_name: me.display_name, job_title: me.job_title, department: me.department, photo_url: me.photo_url };
  const f = useContractForm<Values>(
    {
      hours: "usual",
      starts_at: "",
      ends_at: "",
      purpose: "",
      name: "",
      description: "",
      starts_on: "",
      ends_on: "",
      people: direct ? [] : [self],
      count: 1,
      ...SLOTS.reduce((acc, n) => ({ ...acc, ...blank(n) }), {}),
    } as unknown as Values,
    {
      safeParse: (v: unknown) => {
        const r = attendance.TemporarySiteCreate.safeParse(bodyOf(v as Values));
        if (r.success) return r;
        return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [fieldOf(i.path)] })) } };
      },
    },
  );
  const mine = useMutation("POST /api/v1/attendance/me/temporary-sites");
  const theirs = useMutation("POST /api/v1/attendance/temporary-sites");
  const v = f.values;
  const shown = countOf(v);

  /** Takes address n out, moving the ones after it up. */
  const drop = (n: N) => {
    f.setValues((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      for (let k = n; k < prev.count; k += 1) {
        for (const key of ["name", "address", "radius"]) next[`a${k}_${key}`] = (prev as Record<string, unknown>)[`a${k + 1}_${key}`];
      }
      Object.assign(next, blank(prev.count as N), { count: prev.count - 1 });
      return next as Values;
    });
  };

  const submit = async () => {
    if (!f.check()) return;
    try {
      // Checked against the contract above, so every number is one and the purpose is chosen.
      const body = bodyOf(v) as TemporarySiteCreate;
      const s = direct ? await theirs.run({ body }) : await mine.run({ body });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/workflow");
      close();
      toast(direct ? `${s.number} added, ${s.people} told` : `${s.number} sent for approval`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(remap(e.fields));
        // Who is already on another site on those days: the mark on First Day cannot say.
        if (e.code === "SITE_OVERLAPS") toast(e.message);
      } else toast(e instanceof ApiError ? e.message : "Site not saved. Try again.");
    }
  };

  const address = (n: N) => {
    const point = pointOfPlace(v[`a${n}_address`]);
    const r = Number(v[`a${n}_radius`]);
    const fence = Number.isInteger(r) && r >= 150 && r <= 500 ? r : undefined;
    return (
      <Card className="mt-3" key={n}>
        <CardHeader
          title={shown === 1 ? "Address" : `Address ${n}`}
          actions={
            n > 1 ? (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => drop(n)}>
                Remove
              </Button>
            ) : undefined
          }
        />
        <Field label="Address" {...f.status(`a${n}_address`)}>
          <AddressField {...f.field(`a${n}_address`)} places={places} />
        </Field>
        <Grid cols={2}>
          <Field label="Label" optional {...f.status(`a${n}_name`)}>
            <TextField {...f.field(`a${n}_name`)} placeholder="Main Hall" maxLength={60} />
          </Field>
          <Field label={<HelpTerm help={RADIUS_HELP}>Radius, Metres</HelpTerm>} {...f.status(`a${n}_radius`)}>
            <NumberField {...f.field(`a${n}_radius`)} />
          </Field>
        </Grid>
        {point && (
          <MapView
            className="mb-3"
            height="sm"
            zoom={zoomFor(fence ?? 150)}
            markers={[{ key: `a${n}`, lat: point.lat, lon: point.lon, label: v[`a${n}_name`].trim() || lineOf(v[`a${n}_address`]) || `Address ${n}`, tone: "brand" }]}
            radiusMetres={fence}
            loadTile={loadTile}
          />
        )}
      </Card>
    );
  };

  return (
    <>
      <Field label={<HelpTerm help={HOURS_HELP}>Hours</HelpTerm>} {...f.status("hours")}>
        <ChoiceField value={v.hours} onChange={(h) => f.set("hours", h)} options={HOURS} />
      </Field>
      {v.hours === "site" && (
        <Grid cols={2}>
          <Field label="Starts At" {...f.status("starts_at")}>
            <TimeField {...f.field("starts_at")} />
          </Field>
          <Field label="Ends At" {...f.status("ends_at")}>
            <TimeField {...f.field("ends_at")} />
          </Field>
        </Grid>
      )}
      <Field label="Purpose" {...f.status("purpose")}>
        <SelectField searchable {...f.field("purpose")} onChange={(p) => f.set("purpose", p as TemporarySitePurpose)} options={PURPOSES} placeholder="Choose One" />
      </Field>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Partner Training Week" maxLength={120} />
      </Field>
      {SLOTS.slice(0, shown).map(address)}
      {v.purpose !== "temporary_home" && shown < MAX_ADDRESSES && (
        <Button className="mt-3" icon="plus" onClick={() => f.set("count", v.count + 1)}>
          Add Address
        </Button>
      )}
      <Grid cols={2} className="mt-3">
        <Field label="First Day" {...f.status("starts_on")}>
          <DateField {...f.field("starts_on")} min={todayIso()} />
        </Field>
        <Field label="Last Day" {...f.status("ends_on")}>
          <DateField {...f.field("ends_on")} min={v.starts_on || todayIso()} />
        </Field>
      </Grid>
      <Field label="People" {...f.status("people")}>
        {direct ? (
          <EmployeePicker multiple value={v.people} onChange={(p) => f.set("people", p)} placeholder="Search people" />
        ) : (
          <ColleaguePicker multiple withSelf value={v.people} onChange={(p) => f.set("people", p)} placeholder="Search people" />
        )}
      </Field>
      <Field label={<HelpTerm help={DESCRIPTION_HELP}>Description</HelpTerm>} {...f.status("description")}>
        <TextAreaField {...f.field("description")} placeholder="Partner training, Lekki" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon={direct ? "check" : "send"} busy={mine.pending || theirs.pending} onClick={submit}>
          {direct ? "Save Site" : "Submit for Approval"}
        </Button>
      </FormFooter>
    </>
  );
}
