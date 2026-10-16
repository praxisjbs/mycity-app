import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import type { AttendanceToday, ClockResponse } from "@/api/types/attendance";
import { useAuth } from "@/auth/AuthProvider";
import { hrefFor, useRouter } from "@/lib/router";
import { Avatar, Banner, Button, Card, cn, Field, formatDate, formatTime, FormFooter, Icon, KeyValue, Result, rules, TextAreaField, toast, useContractForm, useModal } from "@mycity/ui";

/**
 * Clocking in and out, for the shell: the desktop top bar's ClockButton and the
 * phone's floating button (F18) both use useClock. The button only asks; the
 * API decides (location, device, shift, policy acknowledgment) and answers with
 * an outcome the panel shows.
 */
export function useClock() {
  const { data: today } = useApi("GET /api/v1/attendance/me/today");
  const openPanel = useClockPanel();
  const out = today?.state === "clocked_in";
  const done = today?.state === "complete";
  const unavailable = today?.state === "unavailable";
  const label = out ? "Clock Out" : "Clock In";
  const open = useCallback(() => openPanel(out ? "Clock Out" : "Clock In"), [openPanel, out]);
  return { today, out, done, unavailable, label, open, ready: !!today && !done };
}

/** After sign-in, the clock panel opens by itself for anyone who has not clocked in today. The shell calls it once. */
export function useClockPrompt() {
  const { today, open } = useClock();
  const { justSignedIn, clearJustSignedIn } = useAuth();
  useEffect(() => {
    if (justSignedIn && today) {
      clearJustSignedIn();
      if (today.state === "not_clocked") setTimeout(() => open(), 700);
    }
  }, [justSignedIn, today, clearJustSignedIn, open]);
}

/** The desktop top bar's Clock In / Clock Out button. */
export function ClockButton({ compact }: { compact?: boolean }) {
  const { today, out, done, unavailable, label, open } = useClock();
  const title = unavailable ? (today?.unavailable_message ?? "Attendance unavailable") : done ? "Attendance is complete for today" : label;

  return (
    <button
      type="button"
      onClick={() => open()}
      disabled={!today || done}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-9 max-md:h-11 max-md:min-w-11 max-md:justify-center items-center gap-[7px] rounded-full text-[13px] font-semibold transition-[filter] hover:brightness-110 disabled:opacity-50",
        compact ? "px-[11px]" : "px-[14px]",
        out ? "on-primary bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
      )}
    >
      <Icon name="clock" />
      {!compact && <span>{done ? "Done For Today" : label}</span>}
    </button>
  );
}

function useClockPanel() {
  const modal = useModal();
  return useCallback((title: string) => modal.open({ title, body: (close) => <ClockPanel close={close} /> }), [modal]);
}

type Stage = { kind: "review" } | { kind: "explain"; res: ClockResponse } | { kind: "done"; res: ClockResponse };

function ClockPanel({ close }: { close: () => void }) {
  const { me } = useAuth();
  const { navigate } = useRouter();
  const { data: t, loading } = useApi("GET /api/v1/attendance/me/today");
  const [stage, setStage] = useState<Stage>({ kind: "review" });
  const [busy, setBusy] = useState(false);
  const f = useContractForm({ why: "" }, { why: rules.min(10, "At least 10 characters") });
  const [fix, setFix] = useState<{ lat: number | null; lng: number | null; acc: number | null; note: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return setFix({ lat: null, lng: null, acc: null, note: "This device cannot share its location." });
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), note: "" }),
      () => setFix({ lat: null, lng: null, acc: null, note: "Location was not shared." }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }, []);

  if (loading || !t || !me) return <p className="text-[12.5px] text-subtle-foreground">Checking today’s attendance…</p>;

  if (t.state === "unavailable") {
    return (
      <>
        <Banner tone={t.unavailable_reason === "leave" ? "info" : "err"} icon={t.unavailable_reason === "leave" ? "info" : "alert"}>
          <b>{me.display_name}</b>
          <br />
          {t.unavailable_message}
        </Banner>
        <FormFooter>
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </FormFooter>
      </>
    );
  }

  const kind = t.state === "clocked_in" ? "out" : "in";
  const blocked = kind === "in" && t.policy_ack_pending?.blocks_clock_in;

  const submit = async (explanation?: string) => {
    setBusy(true);
    try {
      const res = await api.call("POST /api/v1/attendance/punches", {
        body: { kind, latitude: fix?.lat ?? null, longitude: fix?.lng ?? null, accuracy_m: fix?.acc ?? null, device_label: navigator.platform || "This device", ...(explanation ? { explanation } : {}) },
      });
      invalidate("/api/v1/attendance");
      if (res.result === "review" && !explanation) setStage({ kind: "explain", res });
      else {
        setStage({ kind: "done", res });
        if (res.result === "accepted") toast(kind === "in" ? "Clocked in" : "Clocked out");
      }
    } catch (e) {
      setStage({ kind: "done", res: { result: "rejected", title: "Not Recorded", message: (e as ApiError).message, event_id: null, case_number: null } });
    } finally {
      setBusy(false);
    }
  };

  if (stage.kind === "done") {
    const r = stage.res;
    return (
      <>
        <Result tone={r.result === "accepted" ? "ok" : r.result === "review" ? "warn" : "err"} label="Attendance status" title={r.title} text={r.message} />
        <FormFooter>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </FormFooter>
      </>
    );
  }

  if (stage.kind === "explain") {
    return (
      <>
        <Result tone="warn" label="Location check" title={stage.res.title} text={stage.res.message} />
        <Card className="mt-3">
          <h3 data-ui="title" className="mb-1 text-[13.5px]">Add Exception Details</h3>
          <Field label="Explanation" {...f.field("why")}>
            <TextAreaField {...f.field("why")} placeholder="Phone battery died" />
          </Field>
        </Card>
        <FormFooter>
          <Button onClick={() => setStage({ kind: "done", res: stage.res })}>Skip</Button>
          <Button variant="primary" icon="send" busy={busy} onClick={() => f.check() && void submit(f.values.why.trim())}>
            Send
          </Button>
        </FormFooter>
      </>
    );
  }

  return (
    <>
      <div className="pt-0.5 pb-[15px] text-center">
        <span className="mx-auto mb-2.5 flex w-fit">
          <Avatar name={me.display_name} size={42} tone="brand" />
        </span>
        <h2 data-ui="title" className="mb-1 text-[20px]">{kind === "out" ? "Finish Your Day" : "Start Your Day"}</h2>
        <p className="text-[11.5px] text-subtle-foreground">
          {me.display_name} · {formatDate(t.date)}
        </p>
      </div>
      {blocked ? (
        <Result tone="err" label="Action required" title="Attendance Policy Acknowledgment Needed" text={`Read policy v${t.policy_ack_pending!.version} before clocking in.`} />
      ) : !fix ? (
        <Result tone="info" label="Location check" title="Finding Your Location" text="Allow location when your browser asks." icon="target" />
      ) : fix.lat == null ? (
        <Result tone="warn" label="Location check" title="Attendance Will Be Reviewed" text={`${fix.note} People will review this attendance.`} />
      ) : (
        <Result tone="ok" label="Location check" title="Location Found" text={`Accurate to about ${fix.acc} m. The server checks it against ${t.location_label}.`} />
      )}
      <Card className="mt-3">
        <KeyValue
          items={[
            ["Work arrangement", t.work_pattern],
            ["Shift", `${t.shift_start} to ${t.shift_end}${t.grace_minutes ? ` · ${t.grace_minutes} min grace` : ""}`],
            ["Clock location", `${t.location_label}${t.location_radius_m ? ` · ${t.location_radius_m} m` : ""}`],
            ...(kind === "out" && t.clock_in_at ? ([["Clocked in", formatTime(t.clock_in_at)]] as Array<[string, string]>) : []),
            [
              "Current time",
              <>
                <b>{formatTime(now.toISOString())}</b> <span className="text-[11.5px] text-subtle-foreground">Africa/Lagos</span>
              </>,
            ],
          ]}
        />
      </Card>
      {t.policy_ack_pending && !blocked && (
        <p className="mx-0.5 mt-2 text-[11.5px] text-subtle-foreground">Policy v{t.policy_ack_pending.version} still needs acknowledgment. Read it from Policy Updates afterwards.</p>
      )}
      <FormFooter>
        <Button onClick={close}>Not Now</Button>
        {blocked ? (
          <Button variant="primary" onClick={() => (close(), navigate(hrefFor("ess", "policy-updates")))}>
            View Policy
          </Button>
        ) : (
          <Button variant="primary" icon="clock" busy={busy || !fix} onClick={() => void submit()}>
            {kind === "out" ? "Clock Out" : "Clock In"}
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/** Actions at the foot of the panel, matching the modal footer. */

export type { AttendanceToday };
