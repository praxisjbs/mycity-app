import attendance from "@mycity/contract/schemas/attendance.js";
import type { AttendanceToday, LocationError, PunchCreate, PunchResult } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import { hrefFor, useRouter } from "@/lib/router";
import { Banner, Button, Card, cn, Field, formatDate, formatTime, FormFooter, HelpTerm, Icon, Illustration, KeyValue, Pill, Result, TextAreaField, toast, Tooltip, useContractForm, useModal, zoneClock } from "@mycity/ui";

/**
 * Clocking in and out, for the shell: the desktop top bar's ClockButton and the phone's floating
 * button (F18) both use useClock (docs/guides/attendance.md §10). The panel asks; the API decides.
 * It reads the location only after the person presses Clock In, and only when there is a place to
 * match it to: a worksite, or for remote staff their approved home (asked too while they have none,
 * so People see where they were); every punch carries one Idempotency-Key, kept for a retry of the
 * same press, so a lost answer never makes a second punch. What the panel shows after a punch is
 * the server's.
 */

const PATTERN: Record<AttendanceToday["work_pattern"], string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };

export function useClock() {
  const { data: today } = useApi("GET /api/v1/attendance/me/today");
  const openPanel = useClockPanel();
  const out = today?.state === "clocked_in";
  const done = today?.state === "clocked_out";
  const unavailable = today?.state === "unavailable";
  const label = out ? "Clock Out" : "Clock In";
  const open = useCallback(() => openPanel(out ? "Clock Out" : "Clock In"), [openPanel, out]);
  return { today, out, done, unavailable, label, open, ready: !!today && !done };
}

/**
 * Called once by the shell: a punch made on another device or decided by People refreshes the
 * state. When the panel opens by itself is Home's to decide (docs/guides/home.md §6 Clock-in
 * prompt): the Overview opens it with useClock().open.
 */
export function useClockSync() {
  useRealtime("attendance.updated", () => invalidate("/api/v1/attendance"));
}

/** The desktop top bar's Clock In / Clock Out button. */
export function ClockButton({ compact }: { compact?: boolean }) {
  const { today, out, done, unavailable, label, open } = useClock();
  const title = unavailable ? (today?.unavailable_reason === "leave" ? "On Leave Today" : "Clock Not Available") : done ? "Done For Today" : label;

  return (
    <Tooltip label={title}>
      <button
        type="button"
        onClick={() => open()}
        disabled={!today || done}
        aria-label={title}
        className={cn(
          "flex h-9 max-md:h-11 max-md:min-w-11 max-md:justify-center items-center gap-1.5 rounded-full text-sm font-semibold transition hover:brightness-110 disabled:opacity-50",
          compact ? "px-2.5" : "px-3.5",
          out ? "on-primary bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
        )}
      >
        <Icon name="clock" />
        {!compact && <span>{done ? "Done For Today" : label}</span>}
      </button>
    </Tooltip>
  );
}

function useClockPanel() {
  const modal = useModal();
  return useCallback((title: string) => modal.open({ title, body: (close) => <ClockPanel close={close} /> }), [modal]);
}

type Fix = { latitude: number; longitude: number; accuracy_m: number };
type Stage =
  | { kind: "ready" }
  | { kind: "ask" }
  | { kind: "locating" }
  | { kind: "weak"; fix: Fix }
  | { kind: "no_location"; error: LocationError }
  | { kind: "sending"; body: PunchCreate; key: string }
  | { kind: "lost"; body: PunchCreate; key: string; message: string }
  | { kind: "refused"; message: string }
  | { kind: "done"; res: PunchResult };

const LOCATION_ERROR: Record<number, LocationError> = { 1: "denied", 2: "unavailable", 3: "timeout" };

/** Has the person already let this site read their location? Then the browser will not ask again. */
async function locationGranted(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state === "granted";
  } catch {
    return false;
  }
}

/** The workplace's wall clock, kept to the server's time rather than this device's. */
function useServerClock(t: AttendanceToday | undefined) {
  const offset = useRef(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (t) offset.current = Date.parse(t.server_time) - Date.now();
    setNow(new Date(Date.now() + offset.current));
  }, [t]);
  useEffect(() => {
    const i = setInterval(() => setNow(new Date(Date.now() + offset.current)), 15000);
    return () => clearInterval(i);
  }, []);
  return t ? zoneClock(now, t.timezone) : null;
}

function ClockPanel({ close }: { close: () => void }) {
  const { navigate } = useRouter();
  const { data: t, error, reload } = useApi("GET /api/v1/attendance/me/today");
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const inFlight = useRef(false);
  const clock = useServerClock(t);
  const toDevices = () => (close(), navigate(hrefFor("ess", "my-devices")));

  if (error && !t) {
    return (
      <>
        <Result tone="err" label="Clock" title="Not Loaded" text={error.message} />
        <FormFooter>
          <Button onClick={close}>Not Now</Button>
          <Button variant="primary" onClick={reload}>Try Again</Button>
        </FormFooter>
      </>
    );
  }
  // Only the first read shows this: a refresh after a punch keeps the answer on screen.
  if (!t || !clock) return <Result tone="info" label="Clock" title="Checking Today" icon="clock" />;

  if (t.state === "unavailable") {
    return (
      <>
        {t.leave ? (
          <Result tone="info" label="On Leave" title={`${t.leave.leave_type_name} Leave`} text={`From ${formatDate(t.leave.starts_on)} to ${formatDate(t.leave.ends_on)}.`} />
        ) : (
          <Result tone="err" label="Clock" title="Not Available" text="Only people who work here now can clock in." />
        )}
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      </>
    );
  }

  const eventType: PunchCreate["event_type"] = t.state === "clocked_in" ? "clock_out" : "clock_in";
  const verb = eventType === "clock_out" ? "Clock Out" : "Clock In";

  /** Sends one punch. A retry passes the same body and key, so the server answers with the first punch, never a second. */
  const send = async (body: PunchCreate, key: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStage({ kind: "sending", body, key });
    try {
      const res = await api.call("POST /api/v1/attendance/punches", { body, idempotencyKey: key });
      invalidate("/api/v1/attendance");
      invalidate("/api/v1/devices");
      // The result card is the confirmation; a toast would cover it on a phone.
      setStage({ kind: "done", res });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, null);
      // Nothing came back, the server was not reached, or the first press is still running:
      // the punch may or may not be recorded, so the retry reuses the key.
      if (err.status === 0 || err.status >= 500 || err.code === "IDEMPOTENCY_IN_PROGRESS") setStage({ kind: "lost", body, key, message: err.message });
      else {
        invalidate("/api/v1/attendance");
        setStage({ kind: "refused", message: err.message });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const punch = (where: Partial<Pick<PunchCreate, "latitude" | "longitude" | "accuracy_m" | "location_error">> = {}) =>
    send({ event_type: eventType, device_at: new Date().toISOString(), latitude: null, longitude: null, accuracy_m: null, ...where }, crypto.randomUUID());

  const locate = () => {
    if (!navigator.geolocation) return setStage({ kind: "no_location", error: "unsupported" });
    setStage({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
        if (fix.accuracy_m > t.policy.max_accuracy_m) setStage({ kind: "weak", fix });
        else punch(fix);
      },
      (e) => setStage({ kind: "no_location", error: LOCATION_ERROR[e.code] ?? "unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  /** The press: a place to match means the location is read now, after saying why; otherwise the punch goes as it is. */
  const start = async () => {
    if (t.location.kind === "none") return punch();
    if (await locationGranted()) return locate();
    setStage({ kind: "ask" });
  };

  if (stage.kind === "done") return <PunchDone res={stage.res} close={close} again={() => setStage({ kind: "ready" })} toDevices={toDevices} />;

  if (stage.kind === "refused") {
    return (
      <>
        <Result tone="err" label={verb} title="Not Recorded" text={stage.message} />
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      </>
    );
  }

  if (stage.kind === "lost") {
    return (
      <>
        <Result tone="err" label={verb} title="No Connection" text="Not recorded yet. Try again once you are online." icon="offline" />
        <FormFooter>
          <Button onClick={close}>Not Now</Button>
          <Button variant="primary" icon="refresh" onClick={() => send(stage.body, stage.key)}>Try Again</Button>
        </FormFooter>
      </>
    );
  }

  const fence =
    t.location.kind === "worksite"
      ? `${t.location.name} · ${t.location.radius_m} m`
      : t.location.kind === "home"
        ? `Approved Home · ${t.location.radius_m} m`
        : t.location.kind === "remote"
          ? t.location.home_state === "pending" ? "Home Awaiting Approval" : "No Approved Home"
          : "No Worksite Assigned";
  const punchName = eventType === "clock_out" ? "clock-out" : "clock-in";
  const askText = t.location.kind === "remote" ? `Your ${punchName} goes to People with your location.` : `Your ${punchName} is matched to ${t.location.kind === "home" ? "your approved home" : t.location.name}.`;
  const toHome = () => (close(), navigate(hrefFor("ess", "my-attendance", { home: "set" })));
  const unregistered = t.device.state !== "registered";
  const deviceHelp =
    t.policy.device_mode === "block"
      ? "Punches from a device you have not registered are not counted. Register up to three in My Devices."
      : t.policy.device_mode === "warn"
        ? "Punches from a device you have not registered go to People for review. Register up to three in My Devices."
        : "Register up to three devices you clock in from in My Devices.";

  let step;
  if (stage.kind === "ask") step = <Result tone="info" label="Location Check" title="Share Your Location" text={askText} icon="target" />;
  else if (stage.kind === "locating") step = <Result tone="info" label="Location Check" title="Finding Your Location" text="Allow location when your browser asks." icon="target" />;
  else if (stage.kind === "weak") step = <Result tone="warn" label="Location Check" title="Weak Location Signal" text={`Accurate to about ${stage.fix.accuracy_m} m. Move near a window, then retry.`} icon="target" />;
  else if (stage.kind === "no_location")
    step =
      stage.error === "denied" ? (
        <Result tone="warn" label="Location Check" title="Location Is Off" text="Allow location for this site in your browser settings, then retry." icon="target" />
      ) : stage.error === "unsupported" ? (
        <Result tone="warn" label="Location Check" title="No Location Support" text="This browser cannot share a location." icon="target" />
      ) : (
        <Result tone="warn" label="Location Check" title="Location Not Found" text="Move near a window or outside, then retry." icon="target" />
      );
  else if (stage.kind === "sending") step = <Result tone="info" label={verb} title="Processing" icon="clock" />;

  const statePill =
    t.state === "clocked_in" ? (
      <Pill tone={t.review ? "warn" : "ok"}>{t.review ? "Review Required" : `Clocked In ${formatTime(t.clock_in_at)}`}</Pill>
    ) : t.state === "clocked_out" ? (
      <Pill tone={t.review ? "warn" : "neutral"}>{t.review ? "Review Required" : "Clocked Out"}</Pill>
    ) : (
      <Pill>Not Clocked In</Pill>
    );

  if (t.state === "clocked_out") {
    return (
      <>
        <Result tone={t.review ? "warn" : "ok"} label={t.review ? "Review Required" : "Day Complete"} title={`${formatTime(t.clock_in_at)} to ${formatTime(t.clock_out_at)}`} text={formatDate(t.date)} />
        <FormFooter>
          <Button onClick={() => (close(), navigate(hrefFor("ess", "my-attendance")))}>My Attendance</Button>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      </>
    );
  }

  const primary =
    stage.kind === "ask" ? (
      <Button variant="primary" icon="target" onClick={locate}>Allow Location</Button>
    ) : stage.kind === "weak" || stage.kind === "no_location" ? (
      <Button variant="primary" icon="refresh" onClick={locate}>Retry Location</Button>
    ) : (
      <Button variant="primary" icon="clock" busy={stage.kind === "sending" || stage.kind === "locating"} onClick={() => start()}>
        {verb}
      </Button>
    );

  return (
    <>
      <div className="flex flex-col items-center pb-3 text-center">
        <Illustration name={eventType === "clock_out" ? "ClockOut" : "ClockIn"} size="s" />
        <h2 data-ui="title" className="mt-2 text-2xl">{eventType === "clock_out" ? "Finish Your Day" : "Start Your Day"}</h2>
        <p className="mt-1 text-2xs text-subtle-foreground" data-copy="content">
          <b className="text-base tabular-nums">{clock.time}</b> · {clock.day}
        </p>
        <div className="mt-2">{statePill}</div>
      </div>
      {step && <div className="mb-3">{step}</div>}
      {t.location.kind === "remote" && stage.kind === "ready" && (
        <Banner tone="warn" icon="home" action={t.location.home_state === "none" ? <Button size="sm" onClick={toHome}>Set Home</Button> : undefined}>
          {t.location.home_state === "pending" ? "Your home location is waiting for approval." : "No approved home location yet."}
        </Banner>
      )}
      {unregistered && t.policy.device_mode !== "off" && stage.kind === "ready" && (
        <Banner tone={t.policy.device_mode === "block" ? "err" : "warn"} icon="lock" action={t.device.can_register ? <Button size="sm" onClick={toDevices}>Register Device</Button> : undefined}>
          {t.policy.device_mode === "block" ? "Register this device to clock in." : "This device is not registered."}
        </Banner>
      )}
      <Card>
        <KeyValue
          items={[
            ["Shift", t.shift.working_day && t.shift.starts_at ? `${t.shift.starts_at} to ${t.shift.ends_at}${t.shift.grace_minutes ? `, ${t.shift.grace_minutes} min grace` : ""}` : (t.shift.off_reason ?? "Day Off")],
            ["Work Arrangement", PATTERN[t.work_pattern]],
            [<HelpTerm key="l" help="Your punch is matched to this place. Inside the circle counts as on site.">Clock Location</HelpTerm>, fence],
            [
              <HelpTerm key="d" help={deviceHelp}>This Device</HelpTerm>,
              <Pill key="dv" tone={unregistered ? (t.policy.device_mode === "off" ? "neutral" : "warn") : "ok"}>{unregistered ? "Not Registered" : "Registered"}</Pill>,
            ],
          ]}
        />
      </Card>
      <FormFooter>
        {stage.kind === "weak" ? (
          <Button onClick={() => punch(stage.fix)}>{`${verb} Anyway`}</Button>
        ) : stage.kind === "no_location" ? (
          <Button onClick={() => punch({ location_error: stage.error })}>{`${verb} Anyway`}</Button>
        ) : (
          <Button onClick={close}>Not Now</Button>
        )}
        {primary}
      </FormFooter>
    </>
  );
}

/** After a punch: what the server decided, and a note for People when it is under review. */
function PunchDone({ res, close, again, toDevices }: { res: PunchResult; close: () => void; again: () => void; toDevices: () => void }) {
  const label = res.event_type === "clock_out" ? "Clocked Out" : "Clocked In";
  const open = useApi("GET /api/v1/attendance/me/exceptions", { query: { status: "open" }, enabled: res.validation_state === "review" });
  const mine = (open.data?.data ?? []).filter((x) => x.attendance_event_id === res.attendance_event_id);
  const f = useContractForm({ employee_note: "" }, attendance.ExceptionExplanation);
  const explain = useMutation("POST /api/v1/attendance/me/exceptions/:id/explanation");
  const [sent, setSent] = useState(false);

  const sendNote = async () => {
    if (!f.check()) return;
    try {
      for (const x of mine) await explain.run({ params: { id: x.attendance_exception_id }, body: { employee_note: f.values.employee_note.trim() } });
      invalidate("/api/v1/attendance");
      setSent(true);
      close();
      toast("Note sent to People");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Note not sent");
    }
  };

  const where = res.worksite_name ? (res.distance_m !== null ? `${res.worksite_name}, ${res.distance_m} m away` : res.worksite_name) : undefined;
  return (
    <>
      {res.validation_state === "accepted" && <Result tone="ok" label={label} title={formatTime(res.occurred_at)} text={where} />}
      {res.validation_state === "review" && <Result tone="warn" label="Review Required" title={`${label} ${formatTime(res.occurred_at)}`} text={res.message} />}
      {res.validation_state === "rejected" && <Result tone="err" label={res.event_type === "clock_out" ? "Clock Out" : "Clock In"} title="Not Counted" text={res.message} />}
      {res.validation_state === "review" && mine.length > 0 && !sent && (
        <Card className="mt-3">
          <Field label="Note for People" {...f.status("employee_note")}>
            <TextAreaField {...f.field("employee_note")} placeholder="Client visit" rows={3} />
          </Field>
        </Card>
      )}
      <FormFooter>
        {res.validation_state === "review" && mine.length > 0 && !sent ? (
          <>
            <Button onClick={close}>Skip</Button>
            <Button variant="primary" icon="send" busy={explain.pending} onClick={() => sendNote()}>Send Note</Button>
          </>
        ) : res.validation_state === "rejected" ? (
          <>
            {res.reasons.includes("unknown_device") ? <Button onClick={toDevices}>Register Device</Button> : <Button onClick={close}>Close</Button>}
            <Button variant="primary" icon="refresh" onClick={again}>Try Again</Button>
          </>
        ) : (
          <Button variant="primary" onClick={close}>Done</Button>
        )}
      </FormFooter>
    </>
  );
}
