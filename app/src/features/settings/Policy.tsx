import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/attendance";
import "@/api/types/settings";
import type { AttendancePolicy, PolicySetting } from "@/api/types/attendance";
import type { PolicyAck } from "@/api/types/settings";
import { LoadingRows, Table } from "@/components/ui/Table";
import { PagedTable } from "@/features/shared/sections";
import { Button, Banner, Pill, Who, HelpTerm, Card, CardHeader, Grid, PageHeader, useModal, toast, cn, formatDate, formatDateTime, Field, FormFooter, InlineInput, rules, Switch, TextAreaField, useContractForm } from "@mycity/ui";

const fmt = (s: PolicySetting) => (s.kind === "bool" ? (s.value ? "On" : "Off") : s.kind === "mode" ? String(s.value)[0].toUpperCase() + String(s.value).slice(1) : String(s.value));

/**
 * Settings · Attendance Policy (attendance.md §5). Every change edits a draft;
 * nobody is told and no punch is judged by it until it is published. Older
 * records are never recalculated.
 */
export function AttendancePolicyTab() {
  const modal = useModal();
  const cur = useApi("GET /api/v1/attendance/policies/current");
  const versions = usePaged("GET /api/v1/attendance/policies");
  const save = useMutation("PATCH /api/v1/attendance/policies/draft");
  const discard = useMutation("POST /api/v1/attendance/policies/draft/discard");
  const p = cur.data;
  if (!p) return (<><PageHeader title="Attendance Policy" /><Card><LoadingRows count={8} /></Card></>);
  const settings = p.draft?.settings ?? p.settings;
  const changed = new Set(p.draft?.changed_keys ?? []);
  const sections = [...new Set(settings.map((s) => s.section))];
  const set = async (key: string, value: string | number | boolean) => {
    try {
      await save.run({ body: { settings: { [key]: value } } });
      invalidate("/api/v1/attendance/policies");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save the draft");
    }
  };
  const review = (publish: boolean) =>
    modal.open({ title: publish ? "Publish Policy" : "Review Draft Changes", wide: true, body: (close) => <Review p={p} publish={publish} close={close} /> });
  return (
    <>
      <PageHeader
        title="Attendance Policy"
        help="A change edits a draft. Nobody is notified and no punch is judged by it until the draft is published."
        sub={`Version ${p.version} in force since ${formatDate(p.published_at)} · published by ${p.published_by}`}
      />
      {p.draft ? (
        <Banner
          tone="warn"
          actions={
            <>
              <Button size="sm" busy={discard.pending} onClick={async () => { await discard.run({ body: {} }); invalidate("/api/v1/attendance/policies"); toast("Draft discarded"); }}>Discard Changes</Button>
              <Button size="sm" onClick={() => review(false)}>Review Changes</Button>
              <Button size="sm" variant="primary" onClick={() => review(true)}>Publish Policy</Button>
            </>
          }
        >
          <b>Draft changes not yet published</b> · {changed.size} change{changed.size === 1 ? "" : "s"}. Employees have not been told.
        </Banner>
      ) : (
        <Banner tone="ok" icon="ok">No draft. Version {p.version} is in force.</Banner>
      )}
      <Grid cols={2}>
        {sections.map((sec, i) => (
          <Card key={sec}>
            <CardHeader title={`${i + 1} · ${sec}`} />
            {settings.filter((s) => s.section === sec).map((s) => (
              <SettingRow key={s.key} s={s} changed={changed.has(s.key)} busy={save.pending} onChange={(v) => void set(s.key, v)} />
            ))}
          </Card>
        ))}
      </Grid>
      <Grid cols={2}>
        <AckReport version={p.version} />
        <PagedTable<AttendancePolicy>
          title="Policy Versions"
          list={versions}
          rowKey={(v) => String(v.version)}
          noun="version"
          columns={[
            { key: "v", label: "Version", render: (v) => <b>v{v.version}</b> },
            { key: "s", label: "Status", render: (v) => (v.version === p.version ? <Pill tone="ok">In force</Pill> : <Pill>Archived</Pill>) },
            { key: "p", label: "Published", render: (v) => formatDate(v.published_at) },
            { key: "b", label: "By", render: (v) => v.published_by, desktop: true },
            { key: "m", label: "Summary", render: (v) => <span className="line-clamp-1" title={v.summary}>{v.summary}</span> },
          ]}
        />
      </Grid>
    </>
  );
}

function SettingRow({ s, changed, busy, onChange }: { s: PolicySetting; changed: boolean; busy: boolean; onChange: (v: string | number | boolean) => void }) {
  const [text, setText] = useState(String(s.value));
  const [bad, setBad] = useState<string | null>(null);
  const commit = () => {
    if (s.kind === "number") {
      const n = Number(text);
      if (!Number.isInteger(n) || (s.min != null && n < s.min) || (s.max != null && n > s.max)) return setBad(`Between ${s.min} and ${s.max}`);
      setBad(null);
      if (n !== s.value) onChange(n);
    } else if (s.kind === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return setBad("HH:MM, 24 hour");
      setBad(null);
      if (text !== s.value) onChange(text);
    }
  };
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0", changed && "-mx-[14px] bg-warning-soft px-[14px]")}>
      <div className="min-w-0">
        <div className="text-[13px] font-[550]">{s.help ? <HelpTerm help={s.help}>{s.label}</HelpTerm> : s.label}{changed && <Pill tone="warn" className="ml-1.5">Draft</Pill>}</div>
        {bad && <div className="text-[11.5px] text-destructive">{bad}</div>}
      </div>
      {s.kind === "bool" && <Switch checked={!!s.value} onChange={onChange} label={s.label} disabled={busy} />}
      {s.kind === "locked" && <Pill>{String(s.value)}</Pill>}
      {s.kind === "mode" && (
        <div className="flex flex-none overflow-hidden rounded-full border border-input" role="group" aria-label={s.label}>
          {(s.options ?? []).map((o) => (
            <button key={o} type="button" aria-pressed={s.value === o} disabled={busy} onClick={() => s.value !== o && onChange(o)} className={cn("h-7 px-2.5 text-[11.5px] font-semibold max-md:h-11", s.value === o ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {o[0].toUpperCase() + o.slice(1)}
            </button>
          ))}
        </div>
      )}
      {(s.kind === "number" || s.kind === "time") && (
        <InlineInput
          className={cn("h-8 w-[76px] max-md:h-11 flex-none rounded-ctl border bg-background px-2 text-right text-[13px] outline-none", bad ? "border-destructive" : "border-input focus:border-ring")}
          inputMode="numeric"
          aria-label={s.label}
          value={text}
          onChange={setText}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
      )}
    </div>
  );
}

function Review({ p, publish, close }: { p: AttendancePolicy; publish: boolean; close: () => void }) {
  const f = useContractForm({ summary: "" }, { summary: rules.min(10, "At least 10 characters") });
  const summary = f.values.summary;
  const pub = useMutation("POST /api/v1/attendance/policies/publish");
  const rows = (p.draft?.changed_keys ?? []).map((k) => ({ key: k, old: p.settings.find((s) => s.key === k)!, next: p.draft!.settings.find((s) => s.key === k)! }));
  return (
    <>
      <p className="mb-2.5 text-[11.5px] text-subtle-foreground">Draft against v{p.version}. Nothing has been sent.</p>
      <Table
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          { key: "s", label: "Setting", render: (r) => r.old.label },
          { key: "o", label: `Old Value, v${p.version}`, render: (r) => fmt(r.old) },
          { key: "n", label: `New Value, v${p.version + 1}`, render: (r) => <b>{fmt(r.next)}</b> },
        ]}
      />
      {publish && (
        <div className="mt-3">
          <Field label="What Changed" {...f.field("summary")}>
            <TextAreaField {...f.field("summary")} placeholder="Lateness rule changed" />
          </Field>
          <Banner tone="info" icon="bell">Everyone affected is asked to acknowledge v{p.version + 1}.</Banner>
        </div>
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {publish && (
          <Button variant="primary" busy={pub.pending} onClick={async () => { if (!f.check()) return; try { const x = await pub.run({ body: { summary: summary.trim() } }); invalidate("/api/v1/attendance"); close(); toast(`Version ${x.version} published for staff to acknowledge`); } catch (e) { toast(e instanceof ApiError ? e.message : "Could not publish"); } }}>
            Publish v{p.version + 1}
          </Button>
        )}
      </FormFooter>
    </>
  );
}

function AckReport({ version }: { version: number }) {
  const list = usePaged("GET /api/v1/attendance/policies/:version/acknowledgements", { params: { version: String(version) } });
  const done = list.rows.filter((r) => r.acknowledged_at).length;
  return (
    <PagedTable<PolicyAck>
      title={`Acknowledgment Report · v${version}`}
      right={<Pill tone={done === list.rows.length ? "ok" : "warn"}>{done} of {list.page?.total ?? 0} acknowledged</Pill>}
      list={list}
      rowKey={(r) => r.employee.employee_id}
      noun="employee"
      columns={[
        { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} /> },
        { key: "r", label: "Read", render: (r) => (r.read_at ? formatDateTime(r.read_at) : <Pill>Not read</Pill>) },
        { key: "a", label: "Acknowledged", render: (r) => (r.acknowledged_at ? <Pill tone="ok">{formatDate(r.acknowledged_at)}</Pill> : <Pill tone="warn">Pending</Pill>) },
      ]}
    />
  );
}
