import { useSyncExternalStore } from "react";

/**
 * The sound and the buzz when a notice arrives while the app is open (TB, 19/10/2026;
 * docs/guides/notifications.md §6): a soft two-note chime at 60% volume for mail, messages
 * and approvals, at most once every 5 seconds. No browser tells a page whether the phone is
 * on silent or vibrate, so:
 *
 *   iPhone, iPad   the chime through the ambient audio session, which the silent switch mutes
 *   Android        a short vibration; the chime as well only with Sound in App on this device
 *   desktop        the chime
 *
 * A closed or hidden app does neither: the device's own notification rings, vibrates or stays
 * quiet as the device is set. Sound in App is this device's own choice (localStorage).
 * Browsers start audio only after a press on the page, so the first press unlocks it.
 */
const VOLUME = 0.6;
const GAP_MS = 5000;
const SOUND_KEY = "mc-sound-in-app";
/** The categories that sound (shared/notifications/categories.js). */
const SOUNDING = new Set(["comms", "approvals"]);

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
export const isAndroid = () => /Android/i.test(ua());
const isApple = () => /iPhone|iPad|iPod/.test(ua());

let ctx: AudioContext | null = null;
let last = 0;

const listeners = new Set<() => void>();
function stored(): boolean {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? !isAndroid() : v === "1";
  } catch {
    return !isAndroid();
  }
}

/** Sound in App on this device: off by default on Android, on elsewhere. */
export function useSoundInApp(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    stored,
    () => true,
  );
  return [on, setSoundInApp];
}

export function setSoundInApp(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* a per-device convenience; fine to lose */
  }
  listeners.forEach((l) => l());
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) {
    // iOS: an ambient session mixes with other audio and is muted by the silent switch.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (isApple() && session) session.type = "ambient";
    ctx = new AudioContext();
  }
  return ctx;
}

/** The first press on the page lets audio start later (the browsers' autoplay rule). */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

function note(c: AudioContext, frequency: number, at: number, length: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** The chime: two soft rising notes, about 400 ms. */
export function chime(): void {
  const c = audio();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  note(c, 1046.5, t, 0.28);
  note(c, 1568, t + 0.11, 0.32);
}

/** A notice arrived while the app is open: chime or vibrate, as this device allows. */
export function alertArrival(category: string, now = Date.now()): "chime" | "vibrate" | "both" | "none" {
  if (!SOUNDING.has(category) || now - last < GAP_MS) return "none";
  last = now;
  const sound = stored();
  if (isAndroid()) {
    navigator.vibrate?.([18, 70, 28]);
    if (sound) chime();
    return sound ? "both" : "vibrate";
  }
  if (!sound) return "none";
  chime();
  return "chime";
}

/** Tests only. */
export function resetSoundForTest(): void {
  last = 0;
}
