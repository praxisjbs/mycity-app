/**
 * The clock-in prompt opens once (docs/guides/home.md §6 Clock-in prompt, decision O12). The
 * server decides that it is due (`prompt_clock_in`: the first session of a working day for
 * someone not yet clocked in), and keeps saying so on every Overview that session reads
 * until they clock in, so the screen remembers that it has opened the panel: per person and
 * Lagos day, on this device. Closing the panel is then enough for the day.
 */
const KEY = "mc-clock-prompt";

/** Marks claimed while this page lives, for a browser that refuses storage. */
const claimed = new Set<string>();

/**
 * True the first time it is asked for this person and day, false after that: the caller
 * opens the panel only on true.
 * @param userId  the signed-in person (/me user_id)
 * @param date  today in Lagos, as the Overview sends it (YYYY-MM-DD)
 */
export function claimClockPrompt(userId: string, date: string): boolean {
  const mark = `${userId}|${date}`;
  if (claimed.has(mark)) return false;
  claimed.add(mark);
  try {
    if (localStorage.getItem(KEY) === mark) return false;
    localStorage.setItem(KEY, mark);
  } catch {
    /* storage refused (a private window): the mark in memory holds while the page is open */
  }
  return true;
}
