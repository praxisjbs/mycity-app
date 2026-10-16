import { useApi } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { BackButton, Bars, Button, Card, CardHeader, DataView, ErrorState, formatDate, Grid, KeyValue, LoadingRows, Money, Pill, ProfileHeader, StatStrip, Timeline } from "@mycity/ui";
import { hrefFor, useRouter } from "@/lib/router";
import { AttendanceSetupCard } from "./EmployeeDetails";
import { toBars, toTrail } from "@/features/shared/wire";

/** The employee 360: everything about one person on one page, each part read from its owning module. */
export function Employee360({ id }: { id: string }) {
  const me = useMe();
  const { navigate } = useRouter();
  const { data: e, error, reload } = useApi("GET /api/v1/employees/:id", { params: { id } });
  const back = () => navigate(hrefFor("people", "employees"));
  if (error) return (<><BackButton label="Back to Employees" onBack={back} /><ErrorState error={error} onRetry={reload} /></>);
  if (!e) return <LoadingRows count={8} />;
  const hr = me.grants.people?.includes("edit");
  return (
    <>
      <BackButton label="Back to Employees" onBack={back} />
      <ProfileHeader
        name={e.display_name}
        role={`${e.job_title} · ${e.department}`}
        chips={
          <>
            <Pill tone={e.status.tone}>{e.status.text}</Pill>
            <Pill>{e.arrangement}</Pill>
            {e.line_manager && <Pill>{`Reports to ${e.line_manager.display_name}`}</Pill>}
            <Pill>{`Since ${formatDate(e.start_date)}`}</Pill>
          </>
        }
        actions={
          <>
            {me.grants.queries?.includes("create") && <Button onClick={() => navigate(hrefFor("queries", "queries", { new: "1", employee: e.employee_id }))}>Raise a Query</Button>}
            <Button onClick={() => navigate(hrefFor("community", "direct-messages", { to: e.employee_id }))}>Message</Button>
            {hr && <Button variant="primary">Edit</Button>}
          </>
        }
      />
      <StatStrip items={e.stats} />
      <Grid cols={2}>
        <Card>
          <CardHeader title="Employment" />
          <KeyValue items={[["Staff number", e.staff_number], ["Job title", e.job_title], ["Department", e.department], ["Grade", e.grade], ["Line manager", e.line_manager?.display_name ?? "None"], ["Start date", formatDate(e.start_date)], ["Employment type", e.employment_type], ["Work arrangement", e.arrangement], ["Status", <Pill tone={e.status.tone}>{e.status.text}</Pill>]]} />
        </Card>
        <Card>
          <CardHeader title="Contact and Pay" />
          <KeyValue
            items={[
              ["Work email", e.work_email],
              ["Phone", e.phone],
              ["Gross monthly", e.gross_monthly ? <Money value={e.gross_monthly} /> : <span className="text-subtle-foreground">Restricted</span>],
              ["Bank", e.bank_name ?? <span className="text-subtle-foreground">Restricted</span>],
              ["Account", e.account_last4 ? `•••• ${e.account_last4}` : <span className="text-subtle-foreground">Restricted</span>],
              ["Next of kin", e.next_of_kin ?? "None"],
            ]}
          />
        </Card>
      </Grid>
      {hr && <AttendanceSetupCard id={e.employee_id} name={e.display_name} />}
      <Grid cols={2}>
        <Card>
          <CardHeader title="KPIs This Month" />
          <Bars rows={toBars(e.kpis)} note="Weighted to 100%. Progress counts from tasks linked to each KPI." />
        </Card>
        <Card>
          <CardHeader title="Record Activity" />
          <Timeline items={toTrail(e.activity)} />
        </Card>
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Last Punches"
          rows={e.punches}
          rowKey={(r) => r.date}
          columns={[
            { key: "d", label: "Date", render: (r) => formatDate(r.date) },
            { key: "i", label: "In", render: (r) => r.in ?? "None" },
            { key: "o", label: "Out", render: (r) => r.out ?? "None" },
            { key: "l", label: "Location", desktop: true, render: (r) => r.location },
            { key: "s", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
          ]}
        />
        <DataView
          title="Documents"
          rows={e.documents}
          rowKey={(r) => r.name}
          columns={[
            { key: "n", label: "Document", render: (r) => r.name },
            { key: "s", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
            { key: "e", label: "Expires", render: (r) => (r.expires ? formatDate(r.expires) : "None") },
          ]}
        />
      </Grid>
      <DataView
        title="Queries and Sanctions"
        right={e.open_queries ? <Pill tone="warn">{`${e.open_queries} open`}</Pill> : <Pill tone="ok">Nothing open</Pill>}
        rows={e.queries}
        rowKey={(r) => r.subject}
        empty={{ title: "No Queries Raised", text: "A clean record." }}
        columns={[
          { key: "s", label: "Subject", render: (r) => r.subject },
          { key: "r", label: "Raised By", render: (r) => r.raised_by },
          { key: "d", label: "Date", render: (r) => (r.date ? formatDate(r.date) : "None") },
          { key: "o", label: "Outcome", render: (r) => <Pill tone={r.outcome.tone}>{r.outcome.text}</Pill> },
        ]}
      />
    </>
  );
}
