import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  ChannelGrid,
  EmptyState,
  Field,
  formatWhen,
  HelpTerm,
  IconButton,
  Modal,
  Pager,
  PhonePage,
  Pill,
  TimeField,
  toast,
  ToggleRow,
  useIsPhone,
} from "@mycity/ui";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useInstallApp } from "@/shell/Notices";
import { disablePush, enablePush, sendTestPush, thisDeviceId, usePushState, type PushState } from "./push";
import { isAndroid, useSoundInApp } from "./sound";

/**
 * Notification Settings (docs/guides/notifications.md §2, §10): this device's push and its
 * sound, the person's other devices, and where each category reaches them. A full page over
 * the pane on a phone; a modal on desktop. Every switch saves on its own.
 */
export function NotificationSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phone = useIsPhone();
  const body = open ? <SettingsBody /> : null;
  if (phone) {
    return (
      <PhonePage open={open} onClose={onClose} title="Notification Settings">
        <div className="flex flex-col gap-3 p-3">{body}</div>
      </PhonePage>
    );
  }
  return (
    <Modal open={open} onClose={onClose} title="Notification Settings" wide>
      <div className="flex flex-col gap-4">{body}</div>
    </Modal>
  );
}

const STATUS: Record<PushState, [string, "ok" | "warn" | "err" | "info" | "neutral"]> = {
  checking: ["Checking", "neutral"],
  on: ["On", "ok"],
  off: ["Off", "neutral"],
  ask: ["Off", "neutral"],
  blocked: ["Blocked", "err"],
  "needs-install": ["Install First", "warn"],
  unsupported: ["Not Supported", "neutral"],
  unavailable: ["Not Available", "neutral"],
};

const CHANNELS = [
  { key: "in_app", label: "In App" },
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
];

function SettingsBody() {
  return (
    <>
      <ThisDevice />
      <OtherDevices />
      <Categories />
      <QuietAndDigest />
    </>
  );
}

function ThisDevice() {
  const push = usePushState();
  const [sound, setSound] = useSoundInApp();
  const installApp = useInstallApp();
  const [label, tone] = STATUS[push];
  const turnOn = () =>
    enablePush().then((s) => {
      if (s === "on") toast("Notifications are on");
      else if (s === "blocked") toast.error("Notifications are blocked here");
    });
  const turnOff = () => disablePush().then(() => toast("Notifications are off here"));
  const test = () =>
    sendTestPush()
      .then(() => toast("Test sent"))
      .catch(() => toast.error("Could not send the test"));
  return (
    <Card>
      <CardHeader title="This Device" actions={<Pill tone={tone}>{label}</Pill>} />
      <div className="flex flex-wrap items-center gap-2">
        {push === "on" && (
          <>
            <Button onClick={test}>Send Test</Button>
            <Button variant="ghost" onClick={turnOff}>
              Turn Off
            </Button>
          </>
        )}
        {(push === "ask" || push === "off") && (
          <Button variant="primary" onClick={turnOn}>
            Turn On
          </Button>
        )}
        {push === "needs-install" && (
          <Button variant="primary" onClick={installApp}>
            Install App
          </Button>
        )}
        {push === "blocked" && (
          <span className="text-sm text-subtle-foreground">
            <HelpTerm help="Open this site's settings in your browser, allow notifications, then come back here.">Allow in Browser</HelpTerm>
          </span>
        )}
      </div>
      <div className="mt-3">
        <ToggleRow
          title={
            isAndroid() ? (
              <HelpTerm help="Android does not tell the app when the phone is on vibrate, so the app only vibrates unless this is on.">Sound in App</HelpTerm>
            ) : (
              "Sound in App"
            )
          }
          checked={sound}
          onChange={setSound}
        />
      </div>
    </Card>
  );
}

function OtherDevices() {
  const list = usePaged("GET /api/v1/notifications/push/devices");
  const remove = useMutation("POST /api/v1/notifications/push/devices/:id/remove");
  const [mine, setMine] = useState<string | null>(null);
  useEffect(() => {
    void thisDeviceId().then(setMine);
  }, []);
  const others = list.rows.filter((d) => d.push_subscription_id !== mine);
  if (!list.loading && others.length === 0 && list.pageNumber <= 1) return null;
  return (
    <Card pad={false}>
      <div className="px-4 pt-3">
        <CardHeader title="Other Devices" />
      </div>
      {others.length === 0 && !list.loading ? (
        <EmptyState bare icon="phone" title="No Other Devices" />
      ) : (
        <ul className="divide-y divide-border">
          {others.map((d) => (
            <li key={d.push_subscription_id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold" data-copy="content">
                  {d.label}
                </span>
                <span className="text-xs text-subtle-foreground" data-copy="content">
                  {d.last_seen_at ? formatWhen(d.last_seen_at) : ""}
                </span>
              </span>
              <IconButton
                icon="trash"
                label="Remove Device"
                onClick={() =>
                  remove.run({ params: { id: d.push_subscription_id }, body: {} }).then(() => {
                    invalidate("/api/v1/notifications/push/devices");
                    toast("Device removed");
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Pager page={list.page} onPage={list.setPage} noun="device" className="px-4" />
    </Card>
  );
}

function Categories() {
  const prefs = useApi("GET /api/v1/notifications/preferences");
  const save = useMutation("PUT /api/v1/notifications/preferences");
  const rows = (prefs.data?.categories ?? []).map((c) => ({
    key: c.category,
    label: c.label,
    values: c.channels as Record<string, boolean>,
    locked: c.locked ? (Object.fromEntries(CHANNELS.map((ch) => [ch.key, c.defaults[ch.key as keyof typeof c.defaults]])) as Record<string, boolean>) : undefined,
  }));
  return (
    <Card pad={false}>
      <div className="px-4 pt-3">
        <CardHeader title="Notice Categories" />
      </div>
      <div className="px-4 pb-2 phone:px-0">
        <ChannelGrid
          label="Notice Categories"
          columns={CHANNELS}
          rows={rows}
          lockedLabel="Always on"
          onChange={(category, channel, enabled) =>
            save
              .run({ body: { category, channel: channel as "in_app" | "email" | "push", enabled } })
              .then((next) => prefs.set(next))
              .catch(() => toast.error("Could not save that"))
          }
        />
      </div>
    </Card>
  );
}

/**
 * Quiet hours (off until the person turns them on, TB 19/10/2026) and the daily digest, while the
 * company sends one. Each change saves on its own, as the switches above do.
 */
function QuietAndDigest() {
  const prefs = useApi("GET /api/v1/notifications/preferences");
  const quiet = useMutation("PUT /api/v1/notifications/preferences/quiet-hours");
  const digest = useMutation("PUT /api/v1/notifications/preferences/digest");
  const s = prefs.data?.settings;
  if (!s) return null;
  const saveQuiet = (patch: Partial<Pick<typeof s, "quiet_enabled" | "quiet_from" | "quiet_to">>) =>
    quiet
      .run({ body: { quiet_enabled: s.quiet_enabled, quiet_from: s.quiet_from, quiet_to: s.quiet_to, ...patch } })
      .then((next) => prefs.set(next))
      // The same time twice is refused on `quiet_to`: say that, not the form's general line.
      .catch((e) => toast.error(e instanceof ApiError ? (Object.values(e.fields)[0]?.[0] ?? e.message) : "Could not save that"));
  return (
    <Card>
      <CardHeader title="Quiet Hours and Digest" />
      <ToggleRow
        title={<HelpTerm help="Pushes wait until these hours end. Urgent notices and security alerts still come through.">Quiet Hours</HelpTerm>}
        checked={s.quiet_enabled}
        onChange={(on) => saveQuiet({ quiet_enabled: on })}
      />
      {s.quiet_enabled && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="From">
            <TimeField value={s.quiet_from} onChange={(t) => (t && t !== s.quiet_from ? saveQuiet({ quiet_from: t }) : undefined)} />
          </Field>
          <Field label="To">
            <TimeField value={s.quiet_to} onChange={(t) => (t && t !== s.quiet_to ? saveQuiet({ quiet_to: t }) : undefined)} />
          </Field>
        </div>
      )}
      {s.digest_offered && (
        <div className="mt-2">
          <ToggleRow
            title="Daily Digest"
            text={`Each day at ${s.digest_at}`}
            checked={s.digest}
            onChange={(on) =>
              digest
                .run({ body: { digest: on } })
                .then((next) => prefs.set(next))
                .catch(() => toast.error("Could not save that"))
            }
          />
        </div>
      )}
    </Card>
  );
}
