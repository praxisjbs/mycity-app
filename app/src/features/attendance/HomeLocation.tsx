import attendance from "@mycity/contract/schemas/attendance.js";
import type { LocationError, MyHome } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { searchPlaces } from "@/features/shared/places";
import { AddressField, Button, Card, CardHeader, Field, FormFooter, KeyValue, Pill, Result, toast, useContractForm, useModal } from "@mycity/ui";
import { HOME_STATUS } from "./labels";

/**
 * ESS · My Attendance's Home Location (docs/guides/attendance.md §6.10, §10): the approved home of a
 * remote employee, or of a hybrid employee whose schedule has home days (`needed`), the one waiting
 * on People, or the reason the last one was rejected, and the sheet
 * that sends a new one. The reading is taken on this device when the person presses Use This
 * Location, at home; the address is their own words. People approve it; the API decides who may.
 */

export type Fix = { latitude: number; longitude: number; accuracy_m: number };
export type Reading = { kind: "none" } | { kind: "locating" } | { kind: "fix"; fix: Fix } | { kind: "weak"; fix: Fix } | { kind: "failed"; error: LocationError };

const LOCATION_ERROR: Record<number, LocationError> = { 1: "denied", 2: "unavailable", 3: "timeout" };

/**
 * One location reading taken on this device when the person asks for it, refused when coarser
 * than `max` metres. A home and a work location request's temporary home are both read this way.
 */
export function useReading(max: number, onFix: (fix: Fix) => void) {
  const [reading, setReading] = useState<Reading>({ kind: "none" });
  const locate = () => {
    if (!navigator.geolocation) return setReading({ kind: "failed", error: "unsupported" });
    setReading({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
        if (fix.accuracy_m > max) return setReading({ kind: "weak", fix });
        onFix(fix);
        setReading({ kind: "fix", fix });
      },
      (e) => setReading({ kind: "failed", error: LOCATION_ERROR[e.code] ?? "unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };
  return { reading, setReading, locate };
}

/** Where the reading stands, as the step above a form shows it; `idle` is the line before the first press. */
export function ReadingStep({ reading, idle }: { reading: Reading; idle: { title: string; text: string } }) {
  if (reading.kind === "fix") return <Result tone="ok" label="Location Check" title="Location Found" text={`Accurate to ${reading.fix.accuracy_m} m.`} icon="target" />;
  if (reading.kind === "locating") return <Result tone="info" label="Location Check" title="Finding Your Location" text="Allow location when your browser asks." icon="target" />;
  if (reading.kind === "weak")
    return <Result tone="warn" label="Location Check" title="Weak Location Signal" text={`Accurate to about ${reading.fix.accuracy_m} m. Move near a window, then retry.`} icon="target" />;
  if (reading.kind === "failed")
    return (
      <Result
        tone="warn"
        label="Location Check"
        title={reading.error === "denied" ? "Location Is Off" : reading.error === "unsupported" ? "No Location Support" : "Location Not Found"}
        text={reading.error === "denied" ? "Allow location for this site in your browser settings, then retry." : reading.error === "unsupported" ? "This browser cannot share a location." : "Move near a window or outside, then retry."}
        icon="target"
      />
    );
  return <Result tone="info" label="Location Check" title={idle.title} text={idle.text} icon="home" />;
}

/** The card, for whoever needs a home (`needed`). `?home=set` (the clock panel's Set Home) opens the sheet once. */
export function HomeLocationCard({ openOnLoad }: { openOnLoad: boolean }) {
  const modal = useModal();
  const { data: h } = useApi("GET /api/v1/attendance/me/home");
  const openSheet = useCallback(
    (home: MyHome) => modal.open({ title: "Set Home Location", body: (close) => <SetHomeForm max={home.max_accuracy_m} close={close} /> }),
    [modal],
  );
  const opened = useRef(false);
  useEffect(() => {
    if (openOnLoad && h?.needed && !opened.current) {
      opened.current = true;
      openSheet(h);
    }
  }, [openOnLoad, h, openSheet]);
  if (!h || !h.needed) return null;

  const shown = h.pending ? HOME_STATUS.pending : h.approved ? HOME_STATUS.approved : h.rejected ? HOME_STATUS.rejected : { tone: "neutral" as const, text: "Not Set" };
  return (
    <Card className="mb-3">
      <CardHeader title="Home Location" right={<Pill tone={shown.tone}>{shown.text}</Pill>} />
      <KeyValue
        items={[
          ["Approved Home", h.approved?.home_address ?? null],
          ...(h.pending ? ([["Sent for Approval", h.pending.home_address]] as Array<[string, string]>) : []),
          ...(h.rejected && !h.pending ? ([["Rejected", h.rejected.decision_reason ?? h.rejected.home_address]] as Array<[string, string]>) : []),
        ]}
      />
      <div className="mt-3 flex justify-end">
        <Button className="phone:w-full" icon="home" onClick={() => openSheet(h)}>
          {h.approved || h.pending ? "Update Home" : "Set Home Location"}
        </Button>
      </div>
    </Card>
  );
}

type HomeValues = { home_address: string; home_latitude: number | null; home_longitude: number | null; accuracy_m: number | null };

/** The sheet: one reading taken here, the address, and Send for Approval. */
export function SetHomeForm({ max, close }: { max: number; close: () => void }) {
  const f = useContractForm<HomeValues>(
    { home_address: "", home_latitude: null, home_longitude: null, accuracy_m: null },
    { safeParse: (v: unknown) => attendance.HomeRequestCreate.safeParse({ ...(v as HomeValues), home_address: (v as HomeValues).home_address.trim() }) },
  );
  const send = useMutation("POST /api/v1/attendance/me/home");
  const { reading, setReading, locate } = useReading(max, (fix) => {
    f.set("home_latitude", fix.latitude);
    f.set("home_longitude", fix.longitude);
    f.set("accuracy_m", fix.accuracy_m);
  });

  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      await send.run({ body: { home_address: v.home_address.trim(), home_latitude: v.home_latitude!, home_longitude: v.home_longitude!, accuracy_m: v.accuracy_m! } });
      invalidate("/api/v1/attendance");
      close();
      toast("Home location sent for approval");
    } catch (e) {
      if (e instanceof ApiError && e.code === "HOME_READING_WEAK" && reading.kind === "fix") setReading({ kind: "weak", fix: reading.fix });
      else if (e instanceof ApiError && e.fields.home_address) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Home location not sent");
    }
  };

  const located = reading.kind === "fix";
  return (
    <>
      <div className="mb-3">
        <ReadingStep reading={reading} idle={{ title: "At Home Now", text: "Take the reading where you work from home." }} />
      </div>
      <Field label="Address" {...f.status("home_address")}>
        <AddressField {...f.field("home_address")} search={searchPlaces} placeholder="12 Sample Street" maxLength={300} />
      </Field>
      <FormFooter>
        {located ? (
          <>
            <Button icon="refresh" onClick={locate}>Retry Location</Button>
            <Button variant="primary" icon="send" busy={send.pending} onClick={() => submit()}>Send for Approval</Button>
          </>
        ) : (
          <>
            <Button onClick={close}>Not Now</Button>
            <Button variant="primary" icon="target" busy={reading.kind === "locating"} onClick={locate}>
              {reading.kind === "none" ? "Use This Location" : "Retry Location"}
            </Button>
          </>
        )}
      </FormFooter>
    </>
  );
}
