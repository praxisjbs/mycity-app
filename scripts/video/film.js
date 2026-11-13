"use strict";
/* global document */
/**
 * Film a video's shots (docs/runbooks/training-videos.md §4): each desktop or phone shot is signed
 * in off camera, then recorded as full-resolution captures taken back to back, each with its time,
 * while its lines play out. A line's actions start as its narration starts and the next line waits
 * for both, so the picture and the voice stay together however long a screen takes.
 *
 * Writes <out>/shots/<shot>/NNNNN.jpg and <out>/shots/<shot>/take.json:
 *   { start, end, frames: [{ file, t }], lines: [{ id, at }] }   (times in seconds since the epoch)
 */
const fs = require("node:fs");
const path = require("node:path");
const { appSettle } = require("../check/lib/screens");
const { DESKTOP, PHONE } = require("./style");

/** The pause after a sentence, measured on the Milestone 3 video (median 0.74 s). */
const GAP = 0.74;
/** Before a shot's first line, and after its last, so a cut never clips a word. */
const LEAD = 0.35;
const TAIL = 0.45;

const sleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000));
const now = () => Date.now() / 1000;

/** The pointer drawn on desktop shots: a white arrow with a dark edge that follows the mouse. */
const CURSOR = `(() => {
  const draw = () => {
    if (document.getElementById("video-cursor")) return;
    const c = document.createElement("div");
    c.id = "video-cursor";
    c.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.2 28 L16 26.3 L11.8 17 L19.5 17 Z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(760px, 420px)", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.35))" });
    document.documentElement.appendChild(c);
    const follow = (e) => { if (e.clientX || e.clientY) c.style.transform = "translate(" + (e.clientX - 2) + "px," + (e.clientY - 2) + "px)"; };
    // A card dragged between columns sends drag events, not mouse moves: the pointer follows both.
    for (const type of ["mousemove", "dragover", "drag"]) addEventListener(type, follow, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", draw); else draw();
})();`;

/** What a line's `do`, `before` and `after` receive: the page and moves a person makes on it. */
function hands(page, { phone, origin }) {
  let at = { x: 760, y: 420 };
  const find = (target) => {
    if (typeof target !== "string") return target;
    const exact = { name: target, exact: true };
    return page.getByRole("button", exact).or(page.getByRole("link", exact)).or(page.getByRole("tab", exact))
      .or(page.getByRole("menuitem", exact)).or(page.getByRole("option", exact)).first();
  };
  const glide = async (loc) => {
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.scrollIntoViewIfNeeded();
    // Measured again after each glide: a list that closes or opens as the pointer travels moves
    // what it aims at, and a press where it was can land outside a dialog and close it.
    for (let tries = 0; tries < 4; tries++) {
      const box = await loc.boundingBox();
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (tries && Math.hypot(to.x - at.x, to.y - at.y) < 3) break;
      const steps = tries ? 6 : Math.max(12, Math.round(Math.hypot(to.x - at.x, to.y - at.y) / 18));
      await page.mouse.move(to.x, to.y, { steps });
      at = to;
      await sleep(0.18);
    }
  };
  const s = {
    page,
    phone,
    find,
    /** Open an address in the app (a cut, not a click). */
    go: async (where) => { await page.goto(origin + where); await appSettle(page); },
    /** Move to and press a button, link, tab, menu item or option by its name, or a Locator. */
    click: async (target) => {
      const loc = find(target);
      if (phone) { await loc.waitFor({ state: "visible", timeout: 15000 }); await loc.scrollIntoViewIfNeeded(); await sleep(0.25); await loc.tap(); }
      else { await glide(loc); await page.mouse.down(); await sleep(0.06); await page.mouse.up(); }
      await appSettle(page);
    },
    hover: async (target) => { if (!phone) await glide(find(target)); },
    /** Drag `from` (a Locator) onto `to` (a Locator), at a person's pace: a card between columns. */
    drag: async (from, to) => {
      await glide(from);
      await page.mouse.down();
      const box = await to.boundingBox();
      const end = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 120) };
      await page.mouse.move(end.x, end.y, { steps: Math.max(20, Math.round(Math.hypot(end.x - at.x, end.y - at.y) / 14)) });
      at = end;
      await sleep(0.3);
      await page.mouse.up();
      await appSettle(page);
    },
    /** Type into a field by its label (or a Locator), at a person's pace. */
    type: async (field, text, { delay = 38, clear = true } = {}) => {
      const loc = typeof field === "string" ? page.getByLabel(field, { exact: true }).first() : field;
      if (phone) await loc.tap(); else { await glide(loc); await loc.click(); }
      if (clear) await loc.fill("");
      await loc.pressSequentially(text, { delay });
    },
    /** Choose `option` in the select labelled `label`, or the select Locator `label` (SelectField, FilterSelect): its name, or its name then " · " and a number ("Head, Sales & Revenue · VAC-0001"). */
    pick: async (label, option) => {
      await s.click(typeof label === "string" ? page.getByLabel(label, { exact: true }).first() : label);
      const name = new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( · .+)?$`);
      await s.click(page.getByRole("option", { name }).first());
    },
    /** Scroll the page (or the element under `within`) by `dy` pixels, smoothly. */
    scroll: async (dy, within) => {
      if (within) await glide(find(within));
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, dy / 12); await sleep(0.03); }
      await sleep(0.2);
    },
    wait: sleep,
    settle: () => appSettle(page),
  };
  return s;
}

/**
 * Chromium for filming. The app runs on this machine, but every address and link on screen must
 * read as MyCity's own (hub.mycityapp.io, go.mycityapp.io), never localhost: STAFF_ORIGIN and
 * PUBLIC_ORIGIN name those hosts (runbook §4.1) and Chromium sends them to the local server.
 */
async function browserFor(origins, port) {
  const { chromium } = require("playwright");
  const hosts = Object.values(origins).map((o) => new URL(o));
  // Where outbound traffic must pass a proxy (a cloud session), a YouTube video in a course plays
  // through it; MyCity's two hosts, which are this machine, never do.
  const via = process.env.HTTPS_PROXY || process.env.https_proxy;
  return chromium.launch({
    ...(via ? { proxy: { server: via, bypass: [...hosts.map((u) => u.hostname), "127.0.0.1", "localhost"].join(",") } } : {}),
    executablePath: process.env.MYCITY_CHROMIUM || undefined,
    args: [
      `--host-resolver-rules=${hosts.map((u) => `MAP ${u.hostname}:${u.port || 80} 127.0.0.1:${port}`).join(", ")}`,
      `--unsafely-treat-insecure-origin-as-secure=${hosts.map((u) => u.origin).join(",")}`,
    ],
  });
}

async function signIn(page, origin, email, password) {
  await page.goto(origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 });
  await appSettle(page);
  // The offer to turn on notifications, answered as a person would before a demonstration.
  const later = page.getByRole("button", { name: "Not Now", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click();
}

/**
 * Film one shot. `shot` is { kind: "desktop"|"phone", site: "hub"|"go", as, start, setup, lines },
 * each line { id, duration, before, do, after, hold }.
 */
async function filmShot(browser, shot, dir, { origins, password, emailOf }) {
  const phone = shot.kind === "phone";
  const site = shot.site || "hub";
  const origin = origins[site];
  const context = await browser.newContext({
    ...(phone ? { viewport: PHONE.viewport, deviceScaleFactor: PHONE.deviceScaleFactor, isMobile: true, hasTouch: true }
      : { viewport: DESKTOP.viewport, deviceScaleFactor: DESKTOP.deviceScaleFactor }),
    locale: "en-GB",
    timezoneId: "Africa/Lagos",
    acceptDownloads: true,
  });
  if (!phone) await context.addInitScript(CURSOR);
  // No red underline under words the dictionary lacks ("MyCityApp's") as a person types: the
  // fields inherit spellcheck from the page.
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.documentElement.setAttribute("spellcheck", "false")));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  if (shot.as) await signIn(page, origins.hub, emailOf(shot.as), password);
  if (site !== "hub" || shot.start) await page.goto(origin + (shot.start || "/"));
  await appSettle(page);
  // A policy waiting to be acknowledged opens its sheet over the screen: Later, as a person would
  // before a demonstration (acknowledging is theirs to do, never filming's).
  if (shot.as) {
    const later = page.getByRole("dialog", { name: "Policy Update" }).getByRole("button", { name: "Later", exact: true });
    // One sheet a policy, each after the last: Later to each.
    for (let i = 0; i < 12 && (await later.waitFor({ timeout: i ? 1500 : 4000 }).then(() => true, () => false)); i++) {
      await sleep(0.4);
      await later.click({ timeout: 3000 }).catch(() => null);
      await sleep(0.6);
      await appSettle(page);
    }
  }
  // The offer to clock in, which opens over the first screen of a working day: Not Now, as a
  // person would before a demonstration (clocking in is theirs to do, never filming's).
  if (shot.as) {
    const notNow = page.getByRole("dialog", { name: "Clock In" }).getByRole("button", { name: "Not Now", exact: true });
    if (await notNow.waitFor({ timeout: 2500 }).then(() => true, () => false)) {
      await notNow.click({ timeout: 3000 }).catch(() => null);
      await sleep(0.5);
      await appSettle(page);
    }
  }
  const s = hands(page, { phone, origin });
  if (shot.setup) await shot.setup(s);
  await sleep(0.6);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const take = { start: 0, end: 0, frames: [], lines: [] };
  // Full-resolution captures, one after another (about 20 a second): Chromium's screencast sends
  // frames at CSS size and ignores the device scale, which would leave the text soft.
  const cdp = await context.newCDPSession(page);
  const vp = phone ? PHONE.viewport : DESKTOP.viewport;
  const scale = phone ? PHONE.deviceScaleFactor : DESKTOP.deviceScaleFactor;
  let n = 0;
  let rolling = true;
  const camera = (async () => {
    while (rolling) {
      const t0 = now();
      // The clip is read in the document's coordinates, so it starts where the page is scrolled to:
      // the careers site scrolls the document, the staff app a panel inside it.
      const view = await cdp.send("Page.getLayoutMetrics").then((m) => m.cssVisualViewport, () => ({ pageX: 0, pageY: 0 }));
      const img = await cdp.send("Page.captureScreenshot", {
        format: "jpeg", quality: 92, optimizeForSpeed: true,
        clip: { x: view.pageX, y: view.pageY, width: vp.width, height: vp.height, scale },
      }).catch(() => null);
      if (!img) { await sleep(0.03); continue; }
      const file = String(++n).padStart(5, "0") + ".jpg";
      fs.writeFileSync(path.join(dir, file), Buffer.from(img.data, "base64"));
      take.frames.push({ file, t: (t0 + now()) / 2 });
    }
  })();
  take.start = now();
  await sleep(LEAD);
  for (const [i, line] of shot.lines.entries()) {
    if (line.before) await line.before(s);
    const at = now();
    take.lines.push({ id: line.id, at });
    await Promise.all([sleep(line.duration), line.do ? line.do(s) : null]);
    if (line.after) await line.after(s);
    const spoken = now() - at;
    await sleep((line.hold || 0) + (i < shot.lines.length - 1 ? GAP : TAIL) - Math.max(0, spoken - line.duration));
  }
  take.end = now();
  rolling = false;
  await camera;
  fs.writeFileSync(path.join(dir, "take.json"), JSON.stringify(take, null, 1));
  await context.close();
  return take;
}

/** Film every shot of `plan` that is not a card, or only those in `only` (a Set of shot ids). */
async function film(plan, out, opts) {
  const browser = await browserFor(opts.origins, opts.port);
  try {
    for (const shot of plan.shots) {
      if (shot.kind === "card" || (opts.only && !opts.only.has(shot.id))) continue;
      process.stdout.write(`filming ${shot.id} (${shot.kind}, ${shot.lines.length} lines) ... `);
      const take = await filmShot(browser, shot, path.join(out, "shots", shot.id), opts);
      console.log(`${(take.end - take.start).toFixed(1)}s, ${take.frames.length} frames`);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { film, GAP, LEAD, TAIL };
