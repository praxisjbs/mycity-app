import { useState } from "react";
import notifications from "@mycity/contract/schemas/notifications.js";
import type { NotificationReminders, NotificationRule } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import type { PersonRef } from "@/api/types/common";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { ColleaguePicker, RolePicker, type RoleRef } from "@/features/shared/pickers";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DataView,
  DesktopOnly,
  ErrorState,
  Field,
  FilterSelect,
  FormFooter,
  HelpTerm,
  LoadingRows,
  NumberField,
  PageHeader,
  PhoneOnly,
  Pill,
  SearchInput,
  TimeField,
  toast,
  ToggleRow,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";

/**
 * Settings · Notifications (docs/guides/notifications.md §2, §6, §10): the company's reminders and
 * its rule for every notice the code sends. Holders of `settings` view read them; holders of
 * `settings` edit open a notice or the reminders to change them. A person's own channels, quiet
 * hours and digest are their Notification Settings, from the bell.
 */
export function NotificationsTab() {
  const { can } = useAuth();
  const edit = can("settings", "edit");
  return (
    <>
      <PageHeader title="Notifications" sub="Who is told, how and when" />
      <Reminders edit={edit} />
      <Notices edit={edit} />
    </>
  );
}

const fail = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);

/* ───────────── Reminders ───────────── */

const hours = (n: number) => `Every ${n} ${n === 1 ? "hour" : "hours"}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"} ahead`;

function Reminders({ edit }: { edit: boolean }) {
  const modal = useModal();
  const r = useApi("GET /api/v1/notifications/reminders");
  const open = (current: NotificationReminders) =>
    modal.open({ title: "Edit Reminders", body: (close) => <RemindersForm current={current} close={close} onSaved={r.set} /> });
  const rows = r.data
    ? ([
        ["Approvals Waiting", r.data.approvals.enabled, hours(r.data.approvals.every_hours)],
        ["Probation Ending", r.data.probation.enabled, days(r.data.probation.days_ahead)],
        ["Daily Digest", r.data.digest.enabled, `Daily at ${r.data.digest.at_time}`],
      ] as const)
    : [];
  return (
    <Card>
      <CardHeader title="Reminders" actions={edit && r.data ? <Button onClick={() => open(r.data!)}>Edit Reminders</Button> : null} />
      {r.error && <ErrorState error={r.error} onRetry={r.reload} />}
      {!r.data && !r.error && <LoadingRows count={3} />}
      <ul className="divide-y divide-border">
        {rows.map(([name, on, what]) => (
          <li key={name} className="flex items-center gap-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{name}</span>
              <span className="text-xs text-subtle-foreground" data-copy="content">
                {what}
              </span>
            </span>
            <Pill tone={on ? "ok" : "neutral"}>{on ? "On" : "Off"}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type ReminderValues = {
  approvals_on: boolean;
  every_hours: string;
  probation_on: boolean;
  days_ahead: string;
  digest_on: boolean;
  at_time: string;
};

const remindersBody = (v: ReminderValues): NotificationReminders => ({
  approvals: { enabled: v.approvals_on, every_hours: Number(v.every_hours) },
  probation: { enabled: v.probation_on, days_ahead: Number(v.days_ahead) },
  digest: { enabled: v.digest_on, at_time: v.at_time },
});

/** Each issue of the body, on the field it came from. */
const REMINDER_FIELD: Record<string, keyof ReminderValues> = { every_hours: "every_hours", days_ahead: "days_ahead", at_time: "at_time" };

function RemindersForm({ current, close, onSaved }: { current: NotificationReminders; close: () => void; onSaved: (r: NotificationReminders) => void }) {
  const f = useContractForm<ReminderValues>(
    {
      approvals_on: current.approvals.enabled,
      every_hours: String(current.approvals.every_hours),
      probation_on: current.probation.enabled,
      days_ahead: String(current.probation.days_ahead),
      digest_on: current.digest.enabled,
      at_time: current.digest.at_time,
    },
    {
      safeParse: (v: unknown) => {
        const r = notifications.NotificationRemindersUpdate.safeParse(remindersBody(v as ReminderValues));
        if (r.success) return r;
        return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [REMINDER_FIELD[String(i.path[1])] ?? String(i.path[1])] })) } };
      },
    },
  );
  const save = useMutation("PUT /api/v1/notifications/reminders");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      onSaved(await save.run({ body: remindersBody(v) }));
      close();
      toast("Reminders saved");
    } catch (e) {
      fail(e, "Reminders not saved");
    }
  };
  return (
    <>
      <ToggleRow title="Approvals Waiting" checked={v.approvals_on} onChange={(on) => f.set("approvals_on", on)} />
      {v.approvals_on && (
        <Field label="Every How Many Hours" {...f.status("every_hours")}>
          <NumberField {...f.field("every_hours")} />
        </Field>
      )}
      <ToggleRow title="Probation Ending" checked={v.probation_on} onChange={(on) => f.set("probation_on", on)} />
      {v.probation_on && (
        <Field label="Days Ahead" {...f.status("days_ahead")}>
          <NumberField {...f.field("days_ahead")} />
        </Field>
      )}
      <ToggleRow title="Daily Digest" checked={v.digest_on} onChange={(on) => f.set("digest_on", on)} />
      {v.digest_on && (
        <Field label="Time" {...f.status("at_time")}>
          <TimeField {...f.field("at_time")} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>
          Save Reminders
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Notices ───────────── */

const CHANNELS = [
  ["in_app", "In App"],
  ["email", "Email"],
  ["push", "Push"],
] as const;

const LEVEL: Record<"normal" | "important" | "urgent", { tone: "neutral" | "warn" | "err"; text: string }> = {
  normal: { tone: "neutral", text: "Normal" },
  important: { tone: "warn", text: "Important" },
  urgent: { tone: "err", text: "Urgent" },
};

const channelsText = (n: NotificationRule) => CHANNELS.filter(([k]) => n.channels[k]).map(([, l]) => l).join(", ") || "Off";
const whoText = (n: NotificationRule) => [...n.who, ...n.roles.map((r) => r.name), ...n.people.map((p) => p.display_name)].join(", ");

const CATEGORY_OPTIONS: Array<[string, string]> = [
  ["", "Every Category"],
  ["security", "Security"],
  ["approvals", "Approvals"],
  ["tasks", "Tasks"],
  ["alerts", "Alerts"],
  ["comms", "Messages and Mail"],
  ["people", "Attendance and Leave"],
  ["performance", "Performance"],
  ["queries", "Queries and Sanctions"],
  ["recruitment", "Recruitment"],
  ["payroll", "Payroll"],
  ["partnerships", "Partnerships"],
  ["expenses", "Expenses"],
  ["knowledge", "Knowledge Hub"],
  ["system", "System"],
];

function Notices({ edit }: { edit: boolean }) {
  const modal = useModal();
  const [category, setCategory] = useState("");
  const list = usePaged("GET /api/v1/notifications/rules", { filters: category ? { category } : {} });
  const open = (n: NotificationRule) =>
    modal.open({ title: "Edit Notice", body: (close) => <NoticeForm notice={n} close={close} /> });
  const filter = <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />;
  return (
    <>
      <DesktopOnly>
        <Toolbar label="Notices" className="mt-3">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Notice" />
          {filter}
        </Toolbar>
      </DesktopOnly>
      <PhoneOnly>
        <div className="mt-3 flex flex-col gap-2">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Notice" />
          {filter}
        </div>
      </PhoneOnly>
      <DataView
        className="mt-3"
        title="Notices"
        list={list}
        rowKey={(n) => n.event_key}
        noun="notice"
        onRowClick={edit ? open : undefined}
        empty={{ title: "No Notices Match", text: "Try another category or word.", icon: "srch" }}
        columns={[
          { key: "name", label: "Notice", render: (n) => <b data-copy="content">{n.name}</b> },
          { key: "who", label: "Who", render: (n) => <span data-copy="content">{whoText(n)}</span> },
          { key: "channels", label: "Channels", render: (n) => channelsText(n) },
          { key: "status", label: "Level", render: (n) => <Status n={n} /> },
        ]}
      />
    </>
  );
}

/** Its level, and whether it is on: Always On for Security, Off when the company switched it off. */
function Status({ n }: { n: NotificationRule }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {n.urgency ? <Pill tone={LEVEL[n.urgency].tone}>{LEVEL[n.urgency].text}</Pill> : <span>Set by Poster</span>}
      {n.locked ? <Pill tone="ok">Always On</Pill> : !n.enabled && <Pill tone="neutral">Off</Pill>}
    </span>
  );
}

type NoticeValues = {
  enabled: boolean;
  urgency: "normal" | "important" | "urgent" | null;
  in_app: boolean;
  email: boolean;
  push: boolean;
  roles: RoleRef[];
  people: PersonRef[];
};

const noticeBody = (v: NoticeValues) => ({
  enabled: v.enabled,
  urgency: v.urgency,
  in_app: v.in_app,
  email: v.email,
  push: v.push,
  role_codes: v.roles.map((r) => r.code),
  employee_ids: v.people.map((p) => p.employee_id),
});

const NOTICE_FIELD: Record<string, keyof NoticeValues> = { role_codes: "roles", employee_ids: "people" };

function NoticeForm({ notice, close }: { notice: NotificationRule; close: () => void }) {
  const f = useContractForm<NoticeValues>(
    {
      enabled: notice.enabled,
      urgency: notice.urgency,
      in_app: notice.channels.in_app,
      email: notice.channels.email,
      push: notice.channels.push,
      roles: notice.roles,
      people: notice.people,
    },
    {
      safeParse: (v: unknown) => {
        const r = notifications.NotificationRuleUpdate.safeParse(noticeBody(v as NoticeValues));
        if (r.success) return r;
        return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [NOTICE_FIELD[String(i.path[0])] ?? String(i.path[0])] })) } };
      },
    },
  );
  const save = useMutation("PUT /api/v1/notifications/rules/:key");
  const reset = useMutation("POST /api/v1/notifications/rules/:key/reset");
  const params = { key: notice.event_key };
  const v = f.values;
  const done = (message: string) => {
    invalidate("/api/v1/notifications/rules");
    close();
    toast(message);
  };
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params, body: noticeBody(v) });
      done("Notice saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length)
        f.setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [NOTICE_FIELD[k] ?? k, m])));
      else fail(e, "Notice not saved");
    }
  };
  const resetToDefault = async () => {
    try {
      await reset.run({ params, body: {} });
      done("Notice back to its defaults");
    } catch (e) {
      fail(e, "Notice not reset");
    }
  };
  const lockedOn = (k: "in_app" | "email" | "push") => notice.locked && notice.defaults[k];
  return (
    <>
      <div className="mb-3">
        <div className="text-sm font-semibold" data-copy="content">
          {notice.name}
        </div>
        <div className="text-xs text-subtle-foreground" data-copy="content">
          {notice.category_label} · {notice.who.join(", ")}
        </div>
      </div>
      <ToggleRow title={notice.locked ? "Always On" : "On"} checked={v.enabled} disabled={notice.locked} onChange={(on) => f.set("enabled", on)} />
      {notice.urgency_default !== null && !notice.locked && (
        <Field label={<HelpTerm help="Urgent stays in a red bar and repeats every 30 minutes until opened.">Level</HelpTerm>} {...f.status("urgency")}>
          <ChoiceField
            label="Level"
            value={v.urgency ?? notice.urgency_default}
            onChange={(u) => f.set("urgency", u)}
            options={[
              ["normal", "Normal"],
              ["important", "Important"],
              ["urgent", "Urgent"],
            ]}
          />
        </Field>
      )}
      {CHANNELS.map(([k, label]) => (
        <ToggleRow key={k} title={label} checked={v[k]} disabled={lockedOn(k)} onChange={(on) => f.set(k, on)} />
      ))}
      {notice.copies && (
        <>
          <Field label={<HelpTerm help="They receive a copy of this notice. Notices meant for one person take no copies.">Add Roles</HelpTerm>} optional {...f.status("roles")}>
            <RolePicker value={v.roles} onChange={(roles) => f.set("roles", roles)} />
          </Field>
          <Field label="Add People" optional {...f.status("people")}>
            <ColleaguePicker multiple value={v.people} onChange={(people) => f.set("people", people)} />
          </Field>
        </>
      )}
      <FormFooter>
        {notice.changed && <Button onClick={resetToDefault}>Reset to Default</Button>}
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>
          Save Notice
        </Button>
      </FormFooter>
    </>
  );
}
