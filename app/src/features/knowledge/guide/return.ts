import { useSyncExternalStore } from "react";
import { hrefFor } from "@/lib/routes";

/**
 * Where a reader left the User Guide to do a step (docs/guides/user-guide.md §3): the section or
 * task, the step, and its title. Kept for this browser tab only (sessionStorage), so another tab
 * is untouched; the shell's Back to Guide chip reads it, and pressing it or reading the guide
 * again clears it. Sign Out clears it too.
 */
export const GUIDE_RETURN = "mc-guide-return";

export interface GuideReturn {
  /** The section's or task's slug. */
  id: string;
  /** The step the reader followed, or null for a link in the text. */
  step: number | null;
  /** The section's or task's title. */
  title: string;
}

const read = (): string | null => {
  try {
    return sessionStorage.getItem(GUIDE_RETURN);
  } catch {
    return null;
  }
};

const changed = () => window.dispatchEvent(new Event(GUIDE_RETURN));

export function setGuideReturn(value: GuideReturn): void {
  try {
    sessionStorage.setItem(GUIDE_RETURN, JSON.stringify(value));
  } catch {
    /* a blocked store only means no chip to come back with */
  }
  changed();
}

export function clearGuideReturn(): void {
  try {
    sessionStorage.removeItem(GUIDE_RETURN);
  } catch {
    /* nothing kept */
  }
  changed();
}

const subscribe = (notify: () => void) => {
  window.addEventListener(GUIDE_RETURN, notify);
  return () => window.removeEventListener(GUIDE_RETURN, notify);
};

/** The place to come back to, or null. */
export function useGuideReturn(): GuideReturn | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as GuideReturn;
    return typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The guide at that section, and that step. */
export const guideHref = (r: Pick<GuideReturn, "id" | "step">) =>
  hrefFor("knowledge", "user-guide", { id: r.id, step: r.step ? String(r.step) : null });

/** The guide at the section about a screen (`<module>/<tab>`): Help where you are. */
export const guideAt = (screen: string | null) => hrefFor("knowledge", "user-guide", { screen });
