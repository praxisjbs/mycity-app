import { useState } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { Arrangement } from "@/api/types/attendance";
import "@/api/types/attendance";
import { Timeline } from "@/components/ui/data";
import { LoadingRows } from "@/components/ui/Table";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, Banner, KeyValue, Pill, Card, CardHeader, Grid, useModal, ErrorState, toast, formatDate, ChoiceField, Field, FormFooter, SelectField, TextField } from "@mycity/ui";

/** The details modal from the Employees list: employment, and attendance and location (HR only). */
export function EmployeeDetails({ id, close }: { id: string; close: () => void }) {
  const e = useApi("GET /api/v1/employees/:id", { params: { id } });
  const s = useApi("GET /api/v1/attendance/setup/:employee_id", { params: { employee_id: id } });
  const { navigate } = useRouter();
  const modal = useModal();
  if (e.error) return <ErrorState error={e.error} />;
  if (!e.data || !s.data) return <LoadingRows />;
  const x = e.data;
  const a = s.data;
  return (
    <>
      <Banner tone="info" icon="lock">Home-address details are visible to authorised People users and are recorded in the audit trail when opened.</Banner>
      <Grid cols={2} className="mb-0">
        <Card>
          <CardHeader title="Employment" right={<Pill tone={x.status.tone}>{x.status.text}</Pill>} />
          <KeyValue items={[["Employee", `${x.display_name} · ${x.job_title}`], ["Department", x.department], ["Line manager", x.line_manager?.display_name ?? "None"], ["Work arrangement", a.arrangement], ["Primary location", a.primary_location], ["Assigned office", a.office]]} />
        </Card>
        <Card>
          <CardHeader title="Attendance and Location" />
          <KeyValue items={[["Registered home", a.home_address ?? "Not on file"], ["Home geofence", a.home_radius_m ? `${a.home_radius_m} m · mandatory` : "Not available"], ["Temporary location", <Pill tone={a.temporary_location.tone}>{a.temporary_location.text}</Pill>], ["Field assignment today", a.field_assignment_today ?? "None"], ["Attendance profile", a.profile]]} />
        </Card>
      </Grid>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        <Button onClick={() => modal.open({ title: "Change Work Arrangement", body: (c) => <ArrangementForm id={id} name={x.display_name} current={a.arrangement} schedule={a.schedule} office={a.office} close={c} /> })}>Change Arrangement</Button>
        <Button variant="primary" onClick={() => (close(), navigate(hrefFor("people", "employees", { id })))}>Open Full Record</Button>
      </FormFooter>
    </>
  );
}

const ARRS: Arrangement[] = ["Remote", "Hybrid", "Field", "Office-only"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ArrangementForm({ id, name, current, schedule, office, close }: { id: string; name: string; current: Arrangement; schedule: Record<string, "Office" | "Remote"> | null; office: string; close: () => void }) {
  const [arr, setArr] = useState<Arrangement>(current);
  const [sched, setSched] = useState<Record<string, "Office" | "Remote">>(schedule ?? { Mon: "Office", Tue: "Office", Wed: "Remote", Thu: "Office", Fri: "Office", Sat: "Remote" });
  const [site, setSite] = useState(office);
  const [why, setWhy] = useState("");
  const save = useMutation("PATCH /api/v1/attendance/setup/:employee_id");
  const sites = useApi("GET /api/v1/attendance/worksites", { query: { type: "Office" } });
  const [tried, setTried] = useState(false);
  const bad = why.trim().length < 5;
  const submit = async () => {
    setTried(true);
    if (bad) return;
    await save.run({ params: { employee_id: id }, body: { arrangement: arr, ...(arr === "Hybrid" && { schedule: sched }), office: site, reason: why.trim() } });
    invalidate("/api/v1/attendance", "/api/v1/employees");
    close();
    toast(`${name} is now ${arr} from the next punch.`);
  };
  return (
    <>
      <p className="mb-3 text-[11.5px] text-subtle-foreground">
        {name} is <b>{current}</b> today. The change applies from the next punch and is written to the audit log.
      </p>
      <Field label="Arrangement">
        <ChoiceField value={arr} onChange={setArr} options={ARRS.map((a) => [a, a])} />
      </Field>
      {arr === "Hybrid" && (
        <Field label="Hybrid Schedule">
          <div className="overflow-hidden rounded-box border border-border">
            {DAYS.map((d) => (
              <div key={d} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                <span className="w-[60px] text-[12.5px] font-semibold">{d}</span>
                <ChoiceField value={sched[d]} onChange={(v) => setSched((s) => ({ ...s, [d]: v }))} options={[["Office", "Office"], ["Remote", "Remote"]]} />
              </div>
            ))}
          </div>
        </Field>
      )}
      <Field label="Assigned Office">
        <SelectField value={site} onChange={setSite} options={(sites.data?.data ?? []).map((s) => [s.name, s.name])} />
      </Field>
      <Field label="Reason" state={why || tried ? (bad ? "bad" : "good") : undefined} message="At least 5 characters">
        <TextField value={why} onChange={setWhy} placeholder="Moved to field" state={why || tried ? (bad ? "bad" : "good") : undefined} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => void submit()}>Save Change</Button>
      </FormFooter>
    </>
  );
}

/** The Attendance Setup card on the full record. */
export function AttendanceSetupCard({ id, name }: { id: string; name: string }) {
  const s = useApi("GET /api/v1/attendance/setup/:employee_id", { params: { employee_id: id } });
  const modal = useModal();
  const [reveal, setReveal] = useState(false);
  if (!s.data) return null;
  const a = s.data;
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Attendance Setup" right={<Pill>{a.arrangement}</Pill>} />
        <KeyValue
          items={[
            ["Work arrangement", a.arrangement],
            ["Primary work location", a.primary_location],
            [
              "Approved home",
              a.home_area ? (
                <>
                  {reveal ? a.home_address : `Approved home · ${a.home_area}`}{" "}
                  {!reveal && (
                    <Button size="sm" className="ml-1" onClick={() => setReveal(true)}>
                      Show Full Address
                    </Button>
                  )}
                </>
              ) : (
                "Not required for this arrangement"
              ),
            ],
            ["Home geofence radius", a.home_radius_m ? `${a.home_radius_m} m` : "None"],
            ["Assigned office", `${a.office} · ${a.office_radius_m} m`],
            ["Field assignment today", a.field_assignment_today ?? "None"],
            ["Temporary location", <Pill tone={a.temporary_location.tone}>{a.temporary_location.text}</Pill>],
            ...(a.schedule ? ([["Weekly schedule", DAYS.map((d) => `${d} ${a.schedule![d]}`).join(" · ")]] as Array<[string, string]>) : []),
            ["Attendance profile", a.profile],
          ]}
        />
        <div className="mt-[14px] flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => modal.open({ title: "Change Work Arrangement", body: (c) => <ArrangementForm id={id} name={name} current={a.arrangement} schedule={a.schedule} office={a.office} close={c} /> })}>
            Change Arrangement
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Attendance Setup History" />
        <Timeline items={a.history.map((h, i) => ({ title: h.title, when: h.when, text: h.text, tone: i === 0 ? "hi" : "ok" }))} />
      </Card>
    </Grid>
  );
}

export const fmt = formatDate;
