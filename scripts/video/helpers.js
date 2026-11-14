"use strict";
/* global window */
/**
 * Moves the Milestone 0 and 1 scenes share (docs/runbooks/training-videos.md §4.3): finding a window,
 * a field, a button or a toast the way a person reads the screen, the email a person opens on their
 * phone, signing in on camera, and the lock screen.
 */

/** A window by its name, never a help term's popup (runbook §6.16). */
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
/** A confirmation: an alertdialog, not a dialog (runbook §6.8). */
const confirmOf = (s, name) => s.page.getByRole("alertdialog", { name }).last();
const inside = (s, name, label) => named(s, name).getByLabel(label, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
const link = (s, name, within) => (within || s.page).getByRole("link", { name, exact: true }).first();
const tab = (s, start) => s.page.getByRole("tab", { name: new RegExp(`^${start}`) }).first();
const heading = (s, name) => s.page.getByRole("heading", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const field = (s, label) => s.page.getByLabel(label, { exact: true }).first();
/** Words on the page itself (a tile's label), never the menu's or a window's. */
const words = (s, w) => s.page.locator("main").getByText(w, { exact: true }).first();
/** A KPI tile: a button named by its label and its figure. */
const tile = (s, label) => s.page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first();
/** A table's row, or a list's item, holding every one of `words`. */
const row = (s, ...terms) => terms.reduce((r, w) => r.filter({ hasText: w }), s.page.getByRole("row").or(s.page.getByRole("listitem"))).first();

/** Wait for a toast that starts with `start` (the branded Toaster's), up to `seconds`. */
async function toastOf(s, start, seconds = 20) {
  await s.page.getByText(new RegExp(`^${start}`)).first().waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

/** Glide to `loc` when it shows within a few seconds (runbook §6.12). */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

/** Hover each of `names` in turn (tabs, tiles), pausing on each. */
async function tour(s, locs, pause = 0.45) {
  for (const loc of locs) {
    await s.hover(loc);
    await s.wait(pause);
  }
}

/**
 * Show on the phone the newest email to `email` (runbook §4.5): `subject` (a RegExp) picks it from
 * the mail the hub sent; an invitation or a reset comes from the mail catcher, anything else from
 * the queue.
 */
async function emailOnPhone(s, email, { subject, after = 0, template } = {}) {
  const mail = require("./mail");
  const m = template ? await mail.message(email, template) : await mail.caught(email, { subject, after });
  await s.page.setContent(m.html);
  await s.page.evaluate(() => window.scrollTo(0, 0));
  return m;
}

/** Type a password on camera at a person's pace. */
const typePassword = (s, label, password, within) =>
  s.type(within ? within.getByLabel(label, { exact: true }).first() : field(s, label), password, { delay: 55 });

/** The account menu at the foot of the desktop menu. */
const accountMenu = (s) => s.click(s.page.locator("nav button[aria-haspopup=menu]").first());

/** Lock the screen as the idle timer does: the session channel another tab of the hub listens on. */
async function lockNow(s, reason = "idle") {
  await s.page.evaluate((r) => {
    const c = new window.BroadcastChannel("mycity-session");
    c.postMessage({ t: "locked", reason: r });
    c.close();
  }, reason);
  await s.page.getByRole("dialog").last().waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
}

/** Close whatever opened by itself over the first screen (the clock's offer, an install bar). */
async function clearOffers(s) {
  for (const [dialog, name] of [["Clock In", "Not Now"], ["Clock Out", "Close"]]) {
    const b = s.page.getByRole("dialog", { name: dialog }).getByRole("button", { name, exact: true });
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => null);
  }
  const later = s.page.getByRole("button", { name: "Not Now", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => null);
}

module.exports = {
  named, confirmOf, inside, button, link, tab, heading, text, words, field, tile, row,
  toastOf, soft, tour, emailOnPhone, typePassword, accountMenu, lockNow, clearOffers,
};
