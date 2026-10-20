import { useEffect, useSyncExternalStore } from "react";
import { currentStep, goHistory, historyStartedFresh, isInstalled, onHistory, restoreSteps, startHistory, type HistoryChange } from "@mycity/ui";

/**
 * This device's trail of places (FRONTEND_FOUNDATION F29).
 *
 * The window's own history is the record of where a person has been
 * (@mycity/ui's history); this follows it step by step and keeps what the
 * history cannot say: each step's address and, for a record, the name a screen
 * gives it (useTrailTitle). The desktop capsule names where Back and Forward
 * go from it, and the trail (an arrow held, the pin held) lists the last BACK
 * places and the AHEAD one.
 *
 * It lives on the device only (localStorage `mc-trail`), never sent to the
 * server or shared with the person's other devices. The installed app opening
 * fresh at its start address, within RESUME_MS of the last move, goes back to
 * the last place: before the first render (resumeTrail, so Home never flashes),
 * and once the person signed in is known to be the same one, the steps behind
 * it come back too (startTrail), so Back works as it did. Anyone else starts
 * afresh at Home; Sign Out wipes it (forgetTrail).
 */

/** One step on the trail. */
export interface Place {
  /** Its key in the window's history. */
  key: string;
  /** Its address: path and query. */
  url: string;
  /** Its entry's place in the window's history, for a jump. */
  pos: number;
  /** A record's own name, when its screen gave one. */
  title?: string;
}

export interface TrailView {
  places: Place[];
  /** The place on screen. */
  index: number;
}

interface Saved extends TrailView {
  v: 1;
  /** Whose trail it is: the login's id. */
  user: string | null;
  /** When it last moved. */
  at: number;
}

const STORE = "mc-trail";
/** Places kept on the device. */
const KEEP = 40;
/** The trail shows this many places back, and this many ahead. */
export const BACK = 8;
export const AHEAD = 1;
/** The installed app reopens where the person was when they left it within this. */
export const RESUME_MS = 12 * 60 * 60 * 1000;

let places: Place[] = [];
let index = -1;
let user: string | null = null;
/** The places of the last session, put back at the start and waiting for the person to be known. */
let resumed: Place[] | null = null;
/** While the trail rebuilds the window's history itself. */
let quiet = false;
let unfollow: (() => void) | null = null;
let view: TrailView = { places, index };
const listeners = new Set<() => void>();

const here = () => window.location.pathname + window.location.search;

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && saved.v === 1 && Array.isArray(saved.places) && typeof saved.index === "number" ? saved : null;
  } catch {
    return null;
  }
}

function save(): void {
  try {
    const saved: Saved = { v: 1, user, at: Date.now(), places, index };
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    /* storage can be blocked: the trail then lasts as long as the window */
  }
}

function moved(): void {
  view = { places, index };
  listeners.forEach((l) => l());
  save();
}

function follow(change: HistoryChange): void {
  if (quiet) return;
  if (change.kind === "push") {
    places = [...places.slice(0, index + 1), { key: change.key, url: change.url, pos: change.pos }].slice(-KEEP);
    index = places.length - 1;
    return moved();
  }
  const at = places.findIndex((p) => p.key === change.key);
  if (at < 0) {
    // A step the trail never saw (written before it started): it starts from here.
    places = [{ key: change.key, url: change.url, pos: change.pos }];
    index = 0;
    return moved();
  }
  index = at;
  places = places.map((p, i) => (i === at ? { ...p, url: change.url } : p));
  moved();
}

/**
 * At the app's start, before the first render: the installed app opening fresh
 * at its start address goes back to the last place of the last session.
 */
export function resumeTrail(): void {
  startHistory();
  if (typeof window === "undefined" || !historyStartedFresh() || !isInstalled() || here() !== "/") return;
  const saved = load();
  const last = saved?.places[saved.index];
  if (!saved || !last || Date.now() - saved.at > RESUME_MS) return;
  quiet = true;
  restoreSteps([last.url]);
  quiet = false;
  resumed = saved.places.slice(0, saved.index + 1);
}

/**
 * Once the person signed in is known (the shell): their trail goes on, or a
 * fresh one starts. Returns "home" when the place on screen was put back from
 * someone else's session, so the shell lands on Home instead.
 */
export function startTrail(userId: string): "home" | null {
  if (user === userId && unfollow) return null;
  const saved = load();
  const mine = saved && saved.user === userId ? saved : null;
  user = userId;
  unfollow?.();
  unfollow = onHistory(follow);
  const back = resumed;
  resumed = null;
  if (back) {
    if (!mine) {
      places = [];
      index = -1;
      moved();
      return "home";
    }
    // The same person: the steps behind the place on screen come back, so Back works as it did.
    const kept = back.slice(-(BACK + 1));
    quiet = true;
    const steps = restoreSteps(kept.map((p) => p.url));
    quiet = false;
    places = steps.map((s, i) => ({ key: s.key, url: s.url, pos: s.pos, title: kept[i]?.title }));
    index = places.length - 1;
    moved();
    return null;
  }
  const now = currentStep();
  // A reload: the window's history still holds its steps, by key.
  const at = mine ? mine.places.findIndex((p) => p.key === now.key) : -1;
  if (mine && at >= 0) {
    places = mine.places;
    index = at;
  } else {
    places = [{ key: now.key, url: here(), pos: now.pos }];
    index = 0;
  }
  moved();
  return null;
}

/** Sign Out: the trail leaves the device. */
export function forgetTrail(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing kept */
  }
  unfollow?.();
  unfollow = null;
  user = null;
  resumed = null;
  places = [];
  index = -1;
  view = { places, index };
  listeners.forEach((l) => l());
}

/** The trail as it stands, redrawn as the person moves. */
export function useTrail(): TrailView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
    () => view,
  );
}

/** Jumps to a place on the trail: -2 two back, 1 ahead. */
export function goTrail(offset: number): void {
  const target = places[index + offset];
  if (offset && target) goHistory(target.pos - currentStep().pos);
}

/** A record's screen names the place on screen, so the trail reads "Ada Obi" rather than the screen's name. */
export function useTrailTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const at = places.findIndex((p) => p.key === currentStep().key);
    if (at < 0 || places[at]!.title === title) return;
    places = places.map((p, i) => (i === at ? { ...p, title } : p));
    moved();
  }, [title]);
}

/** Tests only: a device with no trail. */
export function resetTrailForTest(): void {
  forgetTrail();
}
