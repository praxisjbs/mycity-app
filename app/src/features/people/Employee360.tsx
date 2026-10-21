import { useState } from "react";
import { ApiError } from "@/api/client";
import { usePhoto } from "@/api/download";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { Employee360 as Record360, ManagerRef } from "@/api/types/organisation";
import { useMe } from "@/auth/AuthProvider";
import { EmployeeWorkSchedule } from "@/features/attendance/WorkSetup";
import { InviteToSignIn } from "@/features/shared/InviteToSignIn";
import { ReportingForm } from "@/features/shared/ReportingForm";
import { hrefFor, useRouter } from "@/lib/router";
import {
  ActionGroup,
  BackButton,
  Button,
  Card,
  CardHeader,
  DataView,
  ErrorState,
  Field,
  FormFooter,
  formatDate,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  Money,
  Pill,
  ProfileHeader,
  Tabs,
  TextField,
  toast,
  useConfirm,
  useModal,
} from "@mycity/ui";
import { EditEmployee } from "./EmployeeForm";
import { employmentStatus, employmentType, loginStatus, RESTRICTED_HELP, workPattern } from "./status";

/**
 * The employee 360 (docs/guides/foundation.md §2, §10): one person, with their profile,
 * job, work schedule (their week, attendance.md §6.13), reporting line, login and history as tabs.
 * Documents arrive with the documents module's own tab.
 *
 * A field the viewer may not see comes back null and shows Restricted, with a help term
 * naming who may see it (§10.1). A person's own record is never masked from them.
 */
const TABS = [
  { value: "profile", label: "Profile" },
  { value: "job", label: "Job" },
  { value: "schedule", label: "Work Schedule" },
  { value: "line", label: "Reporting Line" },
  { value: "login", label: "Login" },
  { value: "history", label: "History" },
];

/** A restricted value: the value itself, or Restricted with the help term. */
function Restricted({ value }: { value: React.ReactNode }) {
  if (value !== null && value !== undefined && value !== "") return <>{value}</>;
  return (
    <span className="text-subtle-foreground">
      <HelpTerm help={RESTRICTED_HELP}>Restricted</HelpTerm>
    </span>
  );
}

const managerName = (m: ManagerRef | null) => (m ? m.display_name : "None");

export function Employee360({ id }: { id: string }) {
  const me = useMe();
  const modal = useModal();
  const confirm = useConfirm();
  const { navigate } = useRouter();
  const [tab, setTab] = useState("profile");
  const { data: e, error, reload } = useApi("GET /api/v1/employees/:id", { params: { id } });
  const restore = useMutation("POST /api/v1/employees/:id/restore");
  const exportData = useMutation("POST /api/v1/employees/:id/data-export");
  const photo = usePhoto(e?.photo_url);
  const back = () => navigate(hrefFor("people", "employees"));

  if (error)
    return (
      <>
        <BackButton label="Back to Employees" onBack={back} />
        <ErrorState error={error} onRetry={reload} />
      </>
    );
  if (!e) return <LoadingRows count={8} />;

  const canEdit = me.grants.people?.includes("edit");
  const canArchive = me.grants.people?.includes("delete");
  const canInvite = me.grants.settings?.includes("create") && e.login.state === "none";
  const status = employmentStatus(e);

  const putAway = () =>
    modal.open({
      title: "Archive Record",
      body: (close) => <ArchiveForm id={id} name={e.display_name} close={close} onDone={reload} />,
    });

  /* Download Their Data: the CEO only, downloaded here; the person's one a day (docs/guides/ess.md §6). */
  const downloadData = async () => {
    try {
      if (await saveExport(exportData.run({ params: { id }, body: {} }))) toast("Their data downloaded");
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast.error(err.message);
    }
  };

  const bringBack = async () => {
    if (!(await confirm({ title: "Restore Record", body: `${e.display_name} goes back on the register.` }))) return;
    await restore.run({ params: { id }, body: {} });
    invalidate("/api/v1/employees", "/api/v1/org-chart");
    reload();
    toast(`${e.display_name} restored`);
  };

  return (
    <>
      <BackButton label="Back to Employees" onBack={back} />
      <ProfileHeader
        name={e.display_name}
        photo={photo}
        role={`${e.job_title} · ${e.department}`}
        chips={
          <>
            <Pill tone={status.tone}>{status.text}</Pill>
            <Pill>{workPattern(e.work_pattern)}</Pill>
            {e.line_manager && <Pill>{`Reports to ${e.line_manager.display_name}`}</Pill>}
            {e.start_date && <Pill>{`Since ${formatDate(e.start_date)}`}</Pill>}
          </>
        }
        actions={
          <ActionGroup>
            {me.is_ceo && (
              <Button icon="download" onClick={downloadData}>
                Download Their Data
              </Button>
            )}
            {canInvite && (
              <Button
                icon="lock"
                onClick={() =>
                  modal.open({
                    title: "Invite to Sign In",
                    body: (close) => (
                      <InviteToSignIn
                        close={close}
                        person={{ employee_id: e.employee_id, display_name: e.display_name, job_title: e.job_title, department: e.department }}
                      />
                    ),
                  })
                }
              >
                Send Invite
              </Button>
            )}
            {canArchive && e.status === "archived" && (
              <Button busy={restore.pending} onClick={() => bringBack()}>
                Restore Record
              </Button>
            )}
            {canArchive && e.status !== "archived" && <Button onClick={putAway}>Archive Record</Button>}
            {canEdit && (
              <Button
                variant="primary"
                icon="edit"
                onClick={() => modal.open({ title: "Edit Employee", wide: true, body: (close) => <EditEmployee employee={e} close={close} /> })}
              >
                Edit Record
              </Button>
            )}
          </ActionGroup>
        }
      />
      <Tabs items={TABS} value={tab} onValueChange={setTab} label="Employee Record" className="mb-3" />
      {tab === "profile" && <Profile employee={e} />}
      {tab === "job" && <Job employee={e} />}
      {tab === "schedule" && <EmployeeWorkSchedule id={id} />}
      {tab === "line" && <ReportingLine employee={e} onChanged={reload} />}
      {tab === "login" && <Login employee={e} onChanged={reload} />}
      {tab === "history" && <History id={id} />}
    </>
  );
}

/** Archive asks why: the reason is kept on the audit row, and the record keeps its history. */
function ArchiveForm({ id, name, close, onDone }: { id: string; name: string; close: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const archive = useMutation("POST /api/v1/employees/:id/archive");
  const bad = reason.trim().length < 5;
  const submit = async () => {
    setTried(true);
    if (bad) return;
    try {
      await archive.run({ params: { id }, body: { archive_reason: reason.trim() } });
      invalidate("/api/v1/employees", "/api/v1/org-chart");
      close();
      onDone();
      toast(`${name} archived`);
    } catch {
      toast(archive.error?.message ?? "Not archived");
    }
  };
  return (
    <>
      <Field label="Reason" state={tried ? (bad ? "bad" : "good") : undefined} message="At least 5 characters">
        <TextField value={reason} onChange={setReason} placeholder="Left the company" state={tried ? (bad ? "bad" : "good") : undefined} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={archive.pending} onClick={() => submit()}>
          Archive Record
        </Button>
      </FormFooter>
    </>
  );
}

function Profile({ employee: e }: { employee: Record360 }) {
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Person" />
        <KeyValue
          items={[
            ["Full name", [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ")],
            ["Known as", e.preferred_name ?? e.first_name],
            ["Work email", e.work_email],
            ["Phone", e.phone ?? "Not recorded"],
            ["Gender", e.gender ? e.gender[0].toUpperCase() + e.gender.slice(1) : "Not recorded"],
            ["Date of birth", <Restricted key="dob" value={e.date_of_birth ? formatDate(e.date_of_birth) : null} />],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Personal Details" />
        <KeyValue
          items={[
            ["Personal email", <Restricted key="pe" value={e.personal_email} />],
            ["Home address", <Restricted key="ha" value={e.home_address} />],
            ["Next of kin", <Restricted key="nok" value={e.next_of_kin_name} />],
            ["Next of kin phone", <Restricted key="nokp" value={e.next_of_kin_phone} />],
            ["Relationship", <Restricted key="nokr" value={e.next_of_kin_relationship} />],
          ]}
        />
      </Card>
    </Grid>
  );
}

function Job({ employee: e }: { employee: Record360 }) {
  const status = employmentStatus(e);
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Job and Terms" />
        <KeyValue
          items={[
            ["Staff number", e.staff_number],
            ["Job title", e.job_title],
            ["Department", e.department],
            ["Employment type", employmentType(e.employment_type)],
            ["Work pattern", workPattern(e.work_pattern)],
            ["Start date", e.start_date ? formatDate(e.start_date) : "Not recorded"],
            ["Probation ends", e.confirmation_due_on ? formatDate(e.confirmation_due_on) : "None"],
            ["Confirmed", e.confirmed_on ? formatDate(e.confirmed_on) : "Not yet"],
            ["Contract ends", e.contract_ends_on ? formatDate(e.contract_ends_on) : "None"],
            ["Status", <Pill key="s" tone={status.tone}>{status.text}</Pill>],
            ...(e.archived_at ? ([["Archived", `${formatDate(e.archived_at.slice(0, 10))} · ${e.archive_reason ?? ""}`]] as Array<[string, string]>) : []),
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Pay and Bank" />
        <KeyValue
          items={[
            ["Gross monthly", <Restricted key="gm" value={e.gross_monthly ? <Money value={e.gross_monthly} /> : null} />],
            ["Bank", <Restricted key="bn" value={e.bank_name} />],
            ["Account", <Restricted key="an" value={e.account_number ? `•••• ${e.account_number.slice(-4)}` : null} />],
          ]}
        />
      </Card>
    </Grid>
  );
}

/** The reporting line: who is above, who is beside, and who reports in. */
function ReportingLine({ employee: e, onChanged }: { employee: Record360; onChanged: () => void }) {
  const me = useMe();
  const modal = useModal();
  const reports = usePaged("GET /api/v1/employees", { filters: { line_manager_id: e.employee_id } });
  const canEdit = me.grants.people?.includes("edit");
  const { navigate } = useRouter();
  return (
    <>
      <Grid cols={2}>
        <Card>
          <CardHeader
            title="Reports To"
            right={
              canEdit && (
                <Button onClick={() => modal.open({ title: "Change Reporting Line", body: (close) => <ReportingForm employee={e} close={close} onSaved={onChanged} /> })}>
                  Change Manager
                </Button>
              )
            }
          />
          <KeyValue
            items={[
              ["Line manager", e.line_manager ? `${managerName(e.line_manager)}${e.line_manager.vacant ? " (open role)" : ""}` : "None"],
              [
                <HelpTerm key="dl" help="A second manager for matrix work. It does not change who approves leave, expenses or tasks.">
                  Dotted line
                </HelpTerm>,
                managerName(e.dotted_manager),
              ],
              ["Direct reports", String(e.direct_reports)],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="On the Chart" />
          <p className="mb-2 text-xs text-muted-foreground">{`${e.department} · ${e.job_title}`}</p>
          <Button icon="chart" onClick={() => navigate(hrefFor("people", "organogram", { id: e.employee_id }))}>
            Open Organogram
          </Button>
        </Card>
      </Grid>
      <DataView
        title="Direct Reports"
        list={reports}
        rowKey={(r) => r.employee_id}
        onRowClick={(r) => navigate(hrefFor("people", "employees", { id: r.employee_id }))}
        noun="report"
        empty={{ title: "Nobody Reports Here", text: "This person has no reports." }}
        columns={[
          { key: "n", label: "Employee", render: (r) => r.display_name },
          { key: "j", label: "Job Title", render: (r) => r.job_title },
          { key: "d", label: "Department", desktop: true, render: (r) => r.department },
        ]}
      />
    </>
  );
}

function Login({ employee: e, onChanged }: { employee: Record360; onChanged: () => void }) {
  const me = useMe();
  const modal = useModal();
  const login = loginStatus(e.login.state);
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Sign In" right={<Pill tone={login.tone}>{login.text}</Pill>} />
        <KeyValue
          items={[
            ["Signs in as", e.login.email ?? "No login yet"],
            ["Roles", e.login.roles.length ? e.login.roles.map((r) => r.name).join(", ") : "None"],
            ["Last signed in", e.login.last_sign_in_at ? formatDate(e.login.last_sign_in_at.slice(0, 10)) : "Never"],
          ]}
        />
        {me.grants.settings?.includes("create") && e.login.state === "none" && (
          <div className="mt-3">
            <Button
              variant="primary"
              icon="lock"
              onClick={() =>
                modal.open({
                  title: "Invite to Sign In",
                  body: (close) => (
                    <InviteToSignIn
                      close={() => (close(), onChanged())}
                      person={{ employee_id: e.employee_id, display_name: e.display_name, job_title: e.job_title, department: e.department }}
                    />
                  ),
                })
              }
            >
              Send Invite
            </Button>
          </div>
        )}
      </Card>
    </Grid>
  );
}

function History({ id }: { id: string }) {
  const list = usePaged("GET /api/v1/employees/:id/history", { params: { id } });
  return (
    <DataView
      title="Record History"
      list={list}
      rowKey={(r) => r.event_id}
      noun="change"
      empty={{ title: "Nothing Yet", text: "No changes recorded." }}
      columns={[
        { key: "w", label: "What", render: (r) => r.summary },
        { key: "a", label: "Who", render: (r) => r.actor_name ?? "System" },
        { key: "d", label: "When", render: (r) => formatDate(r.occurred_at.slice(0, 10)) },
      ]}
    />
  );
}
