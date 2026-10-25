import { useEffect, useState } from "react";
import { api, ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { UserRow } from "@mycity/contract/contract.gen.ts";
import { useAuth } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AuditLog } from "./AuditLog";
import { NotificationsTab } from "./Notifications";
import { NumberingTab } from "./Numbering";
import { OrganisationTab } from "./Organisation";
import { Roles } from "./Roles";
import { SecurityTab } from "./SecurityRules";
import { FaultsTab, StatusTab } from "./SystemHealth";
import { PerformanceTab } from "./Performance";
import { IntegrationsTab } from "./integrations";
import { AppearanceTab } from "./Appearance";
import { Banner, Button, Card, Chips, Field, formatWhen, FormFooter, Grid, LoadingRows, PageHeader, Pill, TextAreaField, toast, useConfirm, useModal, Who } from "@mycity/ui";
import { InviteToSignIn } from "@/features/shared/InviteToSignIn";
import { RolePicker, type RoleRef } from "@/features/shared/pickers";
import { Imports } from "./Imports";
import { Approvals } from "./Approvals";
import { useScreenAction } from "@/shell/screen-action";
import { useSearchParams } from "@/lib/router";

export default function Settings({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "status": return <StatusTab />;
    case "performance": return <PerformanceTab />;
    case "faults": return <FaultsTab />;
    case "users": return <Users />;
    case "roles-and-permissions": return <Roles />;
    case "approvals": return <Approvals />;
    case "notifications": return <NotificationsTab />;
    case "appearance": return <AppearanceTab />;
    case "documents-and-numbering": return <NumberingTab />;
    case "integrations": return <IntegrationsTab id={id} />;
    case "security": return <SecurityTab />;
    case "audit-log": return <AuditLog />;
    case "imports":
      return <Imports />;
    default: return <OrganisationTab />;
  }
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Users ───────────── */


const USER_STATUS: Record<UserRow["status"], { tone: "ok" | "warn" | "err" | "neutral" | "info"; text: string }> = {
  active: { tone: "ok", text: "Active" },
  invited: { tone: "info", text: "Invited" },
  suspended: { tone: "err", text: "Suspended" },
  left: { tone: "neutral", text: "Left" },
};

/**
 * Settings · Users: the logins. A person gets one from their employee record
 * (Invite User): they receive a link and choose their own password. Roles,
 * suspension, links and sessions are managed from a login's sheet; nobody acts
 * on their own login here (My Security is for that).
 */
function Users() {
  const modal = useModal();
  const { can } = useAuth();
  const invite = () => modal.open({ title: "Invite User", body: (close) => <InviteToSignIn close={close} /> });
  const pending = useMutation("POST /api/v1/users/invite-pending");
  /* Every Invited login nobody has emailed yet (the staff roster makes them silently), sent at once. */
  const invitePending = async () => {
    try {
      const { sent } = await pending.run({ body: {} });
      invalidate("/api/v1/users", "/api/v1/employees");
      toast(sent ? `${sent} ${sent === 1 ? "invitation" : "invitations"} sent` : "Every invitation already sent");
    } catch (e) {
      fail(e);
    }
  };
  useScreenAction(can("settings", "create") ? { label: "Invite User", onSelect: invite } : null);
  // A login linked by id (a role's People on Roles & Permissions, a search result) opens its sheet.
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  useEffect(() => {
    if (!linked) return;
    let gone = false;
    api
      .call("GET /api/v1/users/:id", { params: { id: linked } })
      .then((u) => {
        if (!gone) modal.open({ title: u.display_name, body: (close) => <UserDetail u={u} close={close} />, onClose: () => setParams({ id: null }, { replace: true }) });
      })
      .catch(fail);
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked login
  }, [linked]);
  const [status, setStatus] = useState<"" | UserRow["status"]>("");
  const s = useApi("GET /api/v1/users/summary");
  const list = usePaged("GET /api/v1/users", { filters: status ? { status } : {} });
  const photo = usePhotos(list.rows.map((u) => u.photo_url));
  return (
    <>
      <PageHeader
        title="Users"
        sub={s.data ? `${s.data.users} users · ${s.data.invited} invited` : " "}
        actions={
          <>
            {can("settings", "edit") && <Button icon="send" onClick={invitePending}>Invite All Pending</Button>}
            {can("settings", "create") && <Button variant="primary" icon="plus" onClick={invite}>Invite User</Button>}
          </>
        }
      />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Users", value: String(s.data.users) },
            { label: "Signed In Now", value: String(s.data.signed_in_now), tone: "ok" },
            { label: "Invited", value: String(s.data.invited), tone: s.data.invited ? "warn" : undefined },
            { label: "Suspended", value: String(s.data.suspended), tone: s.data.suspended ? "err" : undefined },
          ]}
        />
      )}
      <Chips
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "Everyone" },
          { value: "active", label: "Active", count: s.data?.active },
          { value: "invited", label: "Invited", count: s.data?.invited },
          { value: "suspended", label: "Suspended", count: s.data?.suspended },
        ]}
      />
      <PagedTable<UserRow>
        title="Users"
        list={list}
        search="Name or email"
        rowKey={(u) => u.user_id}
        noun="user"
        onRowClick={(u) => modal.open({ title: u.display_name, body: (close) => <UserDetail u={u} close={close} /> })}
        columns={[
          { key: "u", label: "User", render: (u) => <Who name={u.display_name} sub={u.email} src={photo(u.photo_url)} /> },
          { key: "r", label: "Roles", render: (u) => (u.is_ceo ? ["CEO", ...u.roles.map((r) => r.name)] : u.roles.map((r) => r.name)).join(", ") },
          { key: "l", label: "Last Seen", render: (u) => (u.last_seen_at ? formatWhen(u.last_seen_at) : "Never"), desktop: true },
          { key: "t", label: "Two-Step", render: (u) => (u.two_step ? "On" : "Off"), desktop: true },
          {
            key: "s",
            label: "Status",
            render: (u) =>
              u.status === "invited" && !u.invited_at ? <Pill tone="warn">Not Sent</Pill> : <Pill tone={USER_STATUS[u.status].tone}>{USER_STATUS[u.status].text}</Pill>,
          },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? (
          <BarsCard
            title="Users by Role"
            rows={s.data.by_role.map((r) => ({ label: r.name, value: String(r.users), pct: Math.round((r.users * 100) / Math.max(1, ...s.data!.by_role.map((x) => x.users))) }))}
          />
        ) : (
          <Card><LoadingRows /></Card>
        )}
      </Grid>
    </>
  );
}

function UserDetail({ u, close }: { u: UserRow; close: () => void }) {
  const { me, can } = useAuth();
  // Someone who may only view Settings sees the login, never buttons the API would refuse.
  const canEdit = can("settings", "edit");
  const moveEmail = useMutation("POST /api/v1/users/:id/use-work-email");
  const confirm = useConfirm();
  const [roles, setRoles] = useState<RoleRef[]>(u.roles);
  const [reason, setReason] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const setR = useMutation("POST /api/v1/users/:id/roles");
  const suspend = useMutation("POST /api/v1/users/:id/suspend");
  const reactivate = useMutation("POST /api/v1/users/:id/reactivate");
  const resend = useMutation("POST /api/v1/users/:id/invite");
  const reset = useMutation("POST /api/v1/users/:id/reset-link");
  const end = useMutation("POST /api/v1/users/:id/end-sessions");
  const resetTwoStep = useMutation("POST /api/v1/users/:id/reset-two-step");
  const fresh = useFreshSignIn();
  const self = me?.user_id === u.user_id || !canEdit;
  const emailMoved = u.email.toLowerCase() !== u.work_email.toLowerCase() && u.status !== "left";
  const reasonBad = reason != null && reason.trim().length < 6;
  const params = { id: u.user_id };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate("/api/v1/users");
      close();
      toast(msg);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Field label="Roles" state={tried && !roles.length ? "bad" : undefined} message="Pick a role">
        {self ? <span className="text-sm">{u.roles.map((r) => r.name).join(", ")}</span> : <RolePicker value={roles} onChange={setRoles} />}
      </Field>
      {reason != null && (
        <Field label="Reason" state={tried && reasonBad ? "bad" : undefined} message="At least 6 characters">
          <TextAreaField value={reason} onChange={setReason} placeholder="Left the company" state={tried && reasonBad ? "bad" : undefined} />
        </Field>
      )}
      {emailMoved && (
        <Banner tone="warn" className="mb-3">
          {`Signs in with ${u.email}, but the record says ${u.work_email}.`}
        </Banner>
      )}
      <FormFooter>
        {!self && emailMoved && (
          <Button
            busy={moveEmail.pending}
            onClick={async () => {
              if (!(await confirm({ title: "Use Work Email", body: `${u.display_name} signs in with ${u.work_email} from now on, and is signed out now.`, confirmLabel: "Use Work Email" }))) return;
              try {
                if (!(await fresh.guard(() => moveEmail.run({ params, body: {} })))) return;
                invalidate("/api/v1/users", "/api/v1/employees");
                close();
                toast(`Signs in with ${u.work_email} now`);
              } catch (e) {
                fail(e);
              }
            }}
          >
            Use Work Email
          </Button>
        )}
        {!self && u.status === "invited" && (
          <Button busy={resend.pending} onClick={() => run(() => resend.run({ params, body: {} }), u.invited_at ? "Invitation sent again" : "Invitation sent")}>
            {u.invited_at ? "Resend Invitation" : "Send Invitation"}
          </Button>
        )}
        {!self && u.status === "active" && <Button busy={reset.pending} onClick={() => run(() => reset.run({ params, body: {} }), "Reset link sent")}>Send Reset Link</Button>}
        {!self && u.status === "active" && (
          <Button
            busy={end.pending}
            onClick={async () => {
              if (await confirm({ title: "Sign Out Everywhere", confirmLabel: "Sign Out" })) await run(() => end.run({ params, body: {} }), "Signed out everywhere");
            }}
          >
            Sign Out Everywhere
          </Button>
        )}
        {!self && u.two_step && (
          <Button
            busy={resetTwoStep.pending}
            onClick={async () => {
              if (!(await confirm({ title: "Reset Two-Step", body: `${u.display_name} sets up their authenticator app again, and is signed out now.`, confirmLabel: "Reset Two-Step", destructive: true }))) return;
              try {
                if (!(await fresh.guard(() => resetTwoStep.run({ params, body: {} })))) return;
                invalidate("/api/v1/users");
                close();
                toast("Two-step reset, signed out everywhere");
              } catch (e) {
                fail(e);
              }
            }}
          >
            Reset Two-Step
          </Button>
        )}
        {!self && u.status !== "suspended" && u.status !== "left" && !u.is_ceo && (reason == null ? <Button onClick={() => setReason("")}>Suspend</Button> : <Button variant="danger" busy={suspend.pending} onClick={() => (reasonBad ? setTried(true) : run(() => suspend.run({ params, body: { reason: reason.trim() } }), "Login suspended"))}>Confirm Suspend</Button>)}
        {/* A Left login reopens here once its employee record is restored; the server says so if it is not yet. */}
        {!self && (u.status === "suspended" || u.status === "left") && <Button busy={reactivate.pending} onClick={() => run(() => reactivate.run({ params, body: {} }), "Login reactivated")}>Reactivate</Button>}
        <Button onClick={close}>Close</Button>
        {!self && (
          <Button
            variant="primary"
            busy={setR.pending}
            onClick={() => (!roles.length ? setTried(true) : run(() => setR.run({ params, body: { role_codes: roles.map((r) => r.code) } }), "Roles saved"))}
          >
            Save Roles
          </Button>
        )}
      </FormFooter>
    </>
  );
}
