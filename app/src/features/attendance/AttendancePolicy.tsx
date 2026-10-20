import attendance from "@mycity/contract/schemas/attendance.js";
import type { PolicyMode, PolicyOverview, PolicyRule, PolicySettings, PolicyVersion } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { Banner, Button, Card, CardHeader, ChoiceField, Chips, DataView, DateField, ErrorState, Field, Form, formatDate, formatDateTime, FormFooter, Grid, KeyValue, LoadingRows, NumberField, PageHeader, Pill, TextAreaField, toast, todayIso, useConfirm, useContractForm, useModal, Who } from "@mycity/ui";
import { usePhotos } from "@/api/download";
import { RULE_LABEL, ruleValue, VERSION_STATE } from "./policy-text";

/**
 * Settings · Attendance Policy (#73, docs/guides/attendance.md §6.15, §10): the rules a punch is
 * judged by, edited as a draft (Save Draft) and published as the next version from a first day,
 * with a note staff read; a version waiting to start can be withdrawn; every version with who has
 * acknowledged it. The API decides who may change it (`can_edit`, `settings` edit).
 */
export function AttendancePolicyTab() {
  const modal = useModal();
  const { data: o, error, reload } = useApi("GET /api/v1/attendance/policy");
  const versions = usePaged("GET /api/v1/attendance/policy/versions");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!o) return (<><PageHeader title="Attendance Policy" /><Card><LoadingRows count={8} /></Card></>);

  const openVersion = (v: PolicyVersion) =>
    modal.open({ title: `Version ${v.version}`, wide: true, body: (close) => <VersionView v={v} canEdit={o.can_edit} close={close} /> });
  const publish = () => modal.open({ title: "Publish Policy", wide: true, body: (close) => <PublishForm o={o} close={close} /> });
  const changes = o.draft?.changed.length ?? 0;

  return (
    <>
      <PageHeader
        title="Attendance Policy"
        sub={o.in_force ? `Version ${o.in_force.version} in force since ${formatDate(o.in_force.effective_from)}` : "Default rules in force"}
      />
      {o.waiting && (
        <Banner tone="info" className="mb-3" action={<Button size="sm" onClick={() => openVersion(o.waiting!)}>Open Version</Button>}>
          {`Version ${o.waiting.version} starts ${formatDate(o.waiting.effective_from)}.`}
        </Banner>
      )}
      {o.draft && o.can_edit && (
        <Banner tone="warn" className="mb-3" action={<Button size="sm" variant="primary" onClick={publish}>Publish Policy</Button>}>
          {changes ? `Draft with ${changes} change${changes === 1 ? "" : "s"}, not published.` : "Draft saved, not published."}
        </Banner>
      )}
      <RulesForm key={o.draft?.updated_at ?? "in-force"} o={o} />
      <DataView
        className="mt-3"
        title="Versions"
        list={versions}
        rowKey={(v) => v.attendance_policy_id}
        onRowClick={openVersion}
        noun="version"
        empty={{ icon: "doc", title: "No Versions Yet", text: "Publish the policy to start." }}
        columns={[
          { key: "v", label: "Version", render: (v) => `Version ${v.version}` },
          { key: "f", label: "First Day", render: (v) => formatDate(v.effective_from) },
          { key: "s", label: "State", render: (v) => <Pill tone={VERSION_STATE[v.state].tone}>{VERSION_STATE[v.state].text}</Pill> },
          { key: "b", label: "Published By", desktop: true, render: (v) => v.published_by_name },
          { key: "a", label: "Acknowledged", render: (v) => (v.state === "withdrawn" ? null : `${v.acknowledged} of ${v.asked}`) },
        ]}
      />
    </>
  );
}

/* ───────────── The rules, saved as the draft ───────────── */

type Values = Record<PolicyRule, string>;
const NUMBERS: readonly PolicyRule[] = ["grace_minutes", "max_accuracy_m", "home_radius_m"];
const MODES: ReadonlyArray<[PolicyMode, string]> = [["off", "Off"], ["warn", "Warn"], ["block", "Block"]];

const valuesOf = (s: PolicySettings): Values =>
  Object.fromEntries(Object.entries(s).filter(([k]) => k in RULE_LABEL).map(([k, v]) => [k, String(v)])) as Values;

/** The body the API takes: the numbers as numbers. A blank number stays blank for the contract to refuse. */
const bodyOf = (v: Values) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, NUMBERS.includes(k as PolicyRule) ? (x.trim() === "" ? NaN : Number(x)) : x])) as PolicySettings;

/** What each rule decides, behind its label. */
const HELP: Record<PolicyRule, string> = {
  grace_minutes: "Minutes after the start of the working day before a clock-in counts as late.",
  office_geofence_mode: "A clock-in outside the office's radius: Off records it, Warn sends it for review, Block refuses it.",
  home_geofence_mode: "A clock-in away from an approved home: Off records it, Warn sends it for review, Block refuses it.",
  site_geofence_mode: "A clock-in outside a field assignment's or client visit's site: Off records it, Warn sends it for review, Block refuses it.",
  device_mode: "A clock-in from a device the person has not registered: Off records it, Warn sends it for review, Block refuses it.",
  max_accuracy_m: "GPS Accuracy: a reading coarser than this cannot confirm where someone is.",
  home_radius_m: "Home Radius: how far from an approved home a clock-in still counts as at home.",
};

function RulesForm({ o }: { o: PolicyOverview }) {
  const confirm = useConfirm();
  const save = useMutation("PUT /api/v1/attendance/policy/draft");
  const discard = useMutation("POST /api/v1/attendance/policy/draft/discard");
  const f = useContractForm<Values>(valuesOf(o.draft ?? o.current), {
    safeParse: (v: unknown) => attendance.PolicySettings.safeParse(bodyOf(v as Values)),
  });
  const changed = new Set(o.draft?.changed ?? []);
  const label = (rule: PolicyRule) => (
    <>
      {RULE_LABEL[rule]}
      {changed.has(rule) && <Pill tone="warn" className="ml-1.5">Changed</Pill>}
    </>
  );
  // A number's help is on its card's title: a help-labelled input below a phone's fold reads to axe as unlabelled.
  const number = (rule: PolicyRule) => (
    <Field label={label(rule)} {...f.status(rule)}>
      <NumberField {...f.field(rule)} disabled={!o.can_edit} />
    </Field>
  );
  const mode = (rule: PolicyRule) => (
    <Field label={label(rule)} help={HELP[rule]} {...f.status(rule)}>
      <ChoiceField
        label={RULE_LABEL[rule]}
        value={f.values[rule] as PolicyMode}
        onChange={(m) => f.set(rule, m)}
        options={MODES}
        disabled={o.can_edit ? [] : MODES.map(([m]) => m)}
      />
    </Field>
  );
  const submit = async () => {
    try {
      await save.run({ body: bodyOf(f.values) });
      invalidate("/api/v1/attendance/policy");
      toast("Draft saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Draft not saved");
    }
  };
  const drop = async () => {
    if (!(await confirm({ title: "Discard Changes", body: "The draft's changes are lost.", confirmLabel: "Discard Changes", destructive: true }))) return;
    try {
      await discard.run({ body: {} });
      invalidate("/api/v1/attendance/policy");
      toast("Draft discarded");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Draft not discarded");
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Clocking In" help={HELP.grace_minutes} />
          {number("grace_minutes")}
        </Card>
        <Card>
          <CardHeader title="Devices" />
          {mode("device_mode")}
        </Card>
        <Card>
          <CardHeader title="Location Checks" />
          {mode("office_geofence_mode")}
          {mode("home_geofence_mode")}
          {mode("site_geofence_mode")}
        </Card>
        <Card>
          <CardHeader title="Location Reading" help={`${HELP.max_accuracy_m} ${HELP.home_radius_m}`} />
          {number("max_accuracy_m")}
          {number("home_radius_m")}
        </Card>
      </Grid>
      {o.can_edit && (
        <FormFooter>
          {o.draft && <Button onClick={drop}>Discard Changes</Button>}
          <Button variant="primary" type="submit" busy={save.pending}>
            Save Draft
          </Button>
        </FormFooter>
      )}
    </Form>
  );
}

/* ───────────── Publishing the draft ───────────── */

/** The rules the draft would replace: the newest version, else the rules in force. */
const baseOf = (o: PolicyOverview): PolicySettings => o.waiting ?? o.in_force ?? o.current;

function PublishForm({ o, close }: { o: PolicyOverview; close: () => void }) {
  const publish = useMutation("POST /api/v1/attendance/policy/publish");
  const draft = o.draft!;
  const base = baseOf(o);
  const first = o.waiting && o.waiting.effective_from >= todayIso() ? nextDay(o.waiting.effective_from) : todayIso();
  const f = useContractForm({ effective_from: first, note: "" }, attendance.PolicyPublish);
  const submit = async () => {
    if (!f.check()) return;
    try {
      const out = await publish.run({ body: { effective_from: f.values.effective_from, note: f.values.note.trim() } });
      invalidate("/api/v1/attendance/policy");
      close();
      const v = out.waiting ?? out.in_force;
      toast(v ? `Version ${v.version} published` : "Policy published");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Policy not published");
    }
  };
  return (
    <>
      <DataView
        title="Changes"
        rows={draft.changed}
        rowKey={(r) => r}
        empty={{ icon: "doc", title: "No Changes", text: "The rules stay as they are." }}
        columns={[
          { key: "r", label: "Rule", render: (r) => RULE_LABEL[r] },
          { key: "n", label: "Now", render: (r) => ruleValue(r, base) },
          { key: "w", label: "New", render: (r) => <b>{ruleValue(r, draft)}</b> },
        ]}
      />
      <Field label="First Day" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <Field label="Note" {...f.status("note")}>
        <TextAreaField {...f.field("note")} placeholder="Grace now 15" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={publish.pending} onClick={submit}>
          Publish Version
        </Button>
      </FormFooter>
    </>
  );
}

/** The day after an ISO date. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ───────────── A version and who acknowledged it ───────────── */

const ACK_FILTER: ReadonlyArray<["" | "acknowledged" | "pending", string]> = [["", "Everyone"], ["acknowledged", "Acknowledged"], ["pending", "Pending"]];

function VersionView({ v, canEdit, close }: { v: PolicyVersion; canEdit: boolean; close: () => void }) {
  const modal = useModal();
  const [status, setStatus] = useState<"" | "acknowledged" | "pending">("");
  const acks = usePaged("GET /api/v1/attendance/policy/versions/:id/acknowledgements", {
    params: { id: v.attendance_policy_id },
    filters: status ? { status } : {},
  });
  const photo = usePhotos(acks.rows.map((r) => r.employee.photo_url));
  const withdraw = () =>
    modal.open({ title: `Withdraw Version ${v.version}`, body: (done) => <WithdrawForm v={v} close={done} /> });
  return (
    <>
      <KeyValue
        items={[
          ["State", <Pill key="s" tone={VERSION_STATE[v.state].tone}>{VERSION_STATE[v.state].text}</Pill>],
          ["First Day", formatDate(v.effective_from)],
          ["Published", `${formatDateTime(v.published_at)}${v.published_by_name ? `, ${v.published_by_name}` : ""}`],
          ...(v.withdraw_reason ? ([["Withdrawn", v.withdraw_reason]] as Array<[string, string]>) : []),
        ]}
      />
      <p data-copy="content" className="my-3 text-sm leading-normal text-muted-foreground">
        {v.note}
      </p>
      <Card className="mb-3">
        <CardHeader title="Rules" level={3} />
        <KeyValue
          items={(Object.keys(RULE_LABEL) as PolicyRule[]).map((r) => [
            RULE_LABEL[r],
            v.changed.includes(r) ? <b key={r}>{ruleValue(r, v)}</b> : ruleValue(r, v),
          ])}
        />
      </Card>
      {v.state !== "withdrawn" && (
        <>
          <Chips label="Acknowledgement" value={status} onChange={setStatus} options={ACK_FILTER} />
          <DataView
            title="Acknowledgements"
            list={acks}
            search="Name"
            rowKey={(r) => r.employee.employee_id}
            noun="person"
            columns={[
              { key: "display_name", label: "Person", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} src={photo(r.employee.photo_url)} /> },
              {
                key: "acknowledged_at",
                label: "Acknowledged",
                sortable: true,
                render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : <Pill tone="warn">Pending</Pill>),
              },
            ]}
          />
        </>
      )}
      <FormFooter>
        {canEdit && v.state === "waiting" && (
          <Button variant="danger" onClick={withdraw}>
            Withdraw Version
          </Button>
        )}
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

function WithdrawForm({ v, close }: { v: PolicyVersion; close: () => void }) {
  const run = useMutation("POST /api/v1/attendance/policy/versions/:id/withdraw");
  const f = useContractForm({ reason: "" }, attendance.PolicyWithdraw);
  const submit = async () => {
    if (!f.check()) return;
    try {
      await run.run({ params: { id: v.attendance_policy_id }, body: { reason: f.values.reason.trim() } });
      invalidate("/api/v1/attendance/policy");
      close();
      toast(`Version ${v.version} withdrawn`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Version not withdrawn");
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Grace unchanged" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" busy={run.pending} onClick={submit}>
          Withdraw Version
        </Button>
      </FormFooter>
    </>
  );
}
