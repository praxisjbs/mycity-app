#!/usr/bin/env node
/* global document, window, getComputedStyle, PopStateEvent */
"use strict";
/**
 * Take the User Guide's pictures (docs/guides/user-guide.md §6.5; docs/manual/README.md).
 *
 *   npm run guide:shots                         every picture of every chapter
 *   npm run guide:shots -- --chapter people     one chapter's
 *   npm run guide:shots -- --shot people-add    one picture
 *   npm run guide:shots -- --stale              only the ones the gate calls stale or missing
 *
 * Each picture is taken on the staff app's demo build (the in-browser mock on the staging seed's
 * people, never anybody's real data), signed in as its spec's account, at desktop (1440 × 900)
 * and phone (390 × 844) size: the script opens its address, does its steps, draws its numbered
 * marks over their targets, and saves `docs/manual/img/<chapter>/<shot>.<device>.png`. The
 * chapter's `shots.json` keeps each picture's hashes (scripts/guide/lib.js), which the gate
 * compares with today's to tell a picture whose screen changed since.
 *
 * Needs Chromium, as the screen gates do (MYCITY_CHROMIUM, or `npx playwright install chromium`).
 * Exit 0 when every picture asked for was taken, 1 when one could not be (each says why).
 */
const fs = require("node:fs");
const path = require("node:path");
const { ensureAppBuild, serve, appSettle, launch, WIDTHS, APP_DIST } = require("../check/lib/screens");
const { IMG, readChapters, hashesOf, readShots } = require("./lib");

/** The demo's accounts (app/src/api/mock/data): who each `as` signs in as. */
const ACCOUNTS = {
  operations: "cynthia@mycityapp.io",
  admin: "cynthia@mycityapp.io",
  ceo: "ifeoma@mycityapp.io",
  manager: "ngozi@mycityapp.io",
  staff: "kemi@mycityapp.io",
};
const PASSWORD = "demo1234";
/** The moment every picture shows: noon in Lagos on Sunday 25 October 2026, a day off for the demo's accounts. */
const PICTURE_TIME = new Date("2026-10-25T12:00:00+01:00");

/** Pictures at a size a guide reads well at, and a file small enough to keep in the repository. */
const SIZES = {
  desktop: { ...WIDTHS.desktop, deviceScaleFactor: 1 },
  phone: { ...WIDTHS.phone, deviceScaleFactor: 1.5 },
};

function args(argv) {
  const out = { chapter: null, shot: null, stale: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--chapter") out.chapter = argv[(i += 1)];
    else if (argv[i] === "--shot") out.shot = argv[(i += 1)];
    else if (argv[i] === "--stale") out.stale = true;
    else if (argv[i] === "--help") out.help = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

/** The pictures asked for: { chapter, id, spec }. */
function wanted(opts) {
  const out = [];
  for (const { chapter, problems } of readChapters().chapters) {
    if (problems.length) throw new Error(`${chapter.file} has problems; run node scripts/check/user-guide.js first:\n  ${problems.join("\n  ")}`);
    if (opts.chapter && chapter.slug !== opts.chapter) continue;
    const shots = readShots(chapter.slug);
    for (const [id, spec] of Object.entries(chapter.shots)) {
      if (opts.shot && id !== opts.shot) continue;
      if (opts.stale) {
        const now = hashesOf(spec);
        const was = shots[id];
        const files = spec.devices.every((d) => fs.existsSync(path.join(IMG, chapter.slug, `${id}.${d}.png`)));
        if (was && files && was.spec === now.spec && was.source === now.source) continue;
      }
      out.push({ chapter: chapter.slug, id, spec });
    }
  }
  return out;
}

/** A target as a Playwright locator: the first one of its kind that is on screen. */
async function find(page, target) {
  // With a dialog or a sheet open, the target is in it: the screen behind may hold one of the
  // same name (a list's Department filter behind the form's Department field).
  const modal = page.locator("[data-ui=modal]");
  // A menu or a select's list opened from a dialog floats above it, outside it: while one is open,
  // the target is in it.
  const menu = page.locator("[role=menu], [data-radix-popper-content-wrapper] [role=listbox]");
  const scope = (await menu.count()) ? menu.last() : (await modal.count()) ? modal.last() : page;
  let loc;
  switch (target.kind) {
    case "button":
      loc = scope.getByRole("button", { name: target.name, exact: true });
      break;
    case "link":
      loc = scope.getByRole("link", { name: target.name, exact: true });
      break;
    case "tab":
      loc = scope.getByRole("tab", { name: target.name, exact: true });
      break;
    case "label":
      loc = scope.getByLabel(target.name, { exact: true });
      break;
    case "text":
      loc = scope.getByText(target.name, { exact: true });
      break;
    case "heading":
      loc = scope.getByRole("heading", { name: target.name, exact: true });
      break;
    case "searchbox":
      loc = scope.locator("input[type=search], [role=searchbox]");
      break;
    case "row":
      // A desktop table's row, or a phone card (DataView draws each as a list item).
      loc = page.locator("[data-ui=page] tbody tr:visible, [data-ui=page] ul[data-copy=content] > li:visible").nth(target.index - 1);
      break;
    case "role":
      loc = scope.getByRole(target.role, { name: target.name, exact: true });
      break;
    case "css":
      loc = scope.locator(target.selector);
      break;
    default:
      throw new Error(`unknown target ${target.kind}`);
  }
  // A screen may still be drawing (a record loading, a card animating in): look for 5 seconds.
  const until = Date.now() + 5000;
  for (;;) {
    const all = target.kind === "row" ? [loc] : await loc.all();
    for (const l of all) if (await l.isVisible().catch(() => false)) return l;
    if (Date.now() > until) break;
    await page.waitForTimeout(150);
  }
  const what = target.name || target.selector || (target.index ? String(target.index) : "");
  throw new Error(`${target.kind}${what ? ` "${what}"` : ""} is not on screen`);
}

/** Whether a reader sees a target: its middle is on screen and not under a header, a footer or the edge of its scrolling box. */
function seen(l) {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    // A label that takes no pointer is hit through the button or link that holds it.
    const holder = el.closest("button, a, [role=button], [role=option], [role=menuitem], [role=tab], label");
    return !!hit && (hit === el || el.contains(hit) || hit === holder);
  });
}

/** Draw the numbered marks over their targets, in the page, with the hub's own colours. */
async function drawMarks(page, marks) {
  const found = [];
  for (const m of marks) found.push({ n: m.n, l: await find(page, m.target) });
  // Bring every target into view, then centre them together in the box that scrolls the first,
  // so its label shows above it, and measure only once nothing scrolls any more: a box measured
  // before the page scrolls to the next target would sit off its target.
  for (const { l } of found) await l.scrollIntoViewIfNeeded().catch(() => null);
  const handles = await Promise.all(found.map((f) => f.l.elementHandle()));
  await page.evaluate((els) => {
    const scroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const y = getComputedStyle(p).overflowY;
        if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
      }
      return document.scrollingElement;
    };
    const box = scroller(els[0]);
    const view = box === document.scrollingElement ? { top: 0, height: window.innerHeight } : box.getBoundingClientRect();
    const rects = els.filter((el) => scroller(el) === box).map((el) => el.getBoundingClientRect());
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    box.scrollTop += top - view.top - Math.max(0, (view.height - (bottom - top)) / 2);
  }, handles);
  await page.waitForTimeout(80);
  const hidden = [];
  for (const f of found) if (!(await seen(f.l))) hidden.push(f.n);
  if (hidden.length) throw new Error(`mark ${hidden.join(", ")} is not on screen with mark ${found[0].n}: drop it or split the picture`);
  const boxes = [];
  for (const f of found) boxes.push({ n: f.n, box: await f.l.boundingBox() });
  await page.evaluate((list) => {
    const layer = document.createElement("div");
    layer.setAttribute("data-guide-marks", "");
    Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
    for (const { n, box } of list) {
      if (!box) continue;
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed",
        left: `${box.x - 4}px`,
        top: `${box.y - 4}px`,
        width: `${box.width + 8}px`,
        height: `${box.height + 8}px`,
        border: "3px solid var(--primary)",
        borderRadius: "10px",
        boxShadow: "0 0 0 2px var(--background)",
      });
      const badge = document.createElement("div");
      badge.textContent = String(n);
      Object.assign(badge.style, {
        position: "fixed",
        left: `${Math.max(2, box.x - 14)}px`,
        top: `${Math.max(2, box.y - 14)}px`,
        width: "24px",
        height: "24px",
        borderRadius: "999px",
        background: "var(--primary)",
        color: "var(--primary-foreground)",
        font: "700 13px/24px system-ui, sans-serif",
        textAlign: "center",
        boxShadow: "0 0 0 2px var(--background)",
      });
      layer.append(ring, badge);
    }
    document.body.append(layer);
  }, boxes);
}

/** Where the picture is cut: the page in view, the open dialog or sheet, or one element. */
async function clipOf(page, crop) {
  if (crop === "page" || crop === "viewport") return undefined;
  const sel = crop === "modal" ? "[data-ui=modal]" : crop;
  const el = page.locator(sel).first();
  const box = await el.boundingBox();
  if (!box) throw new Error(`crop ${crop}: nothing on screen`);
  const pad = 12;
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return { x, y, width: Math.min(vp.width - x, box.width + pad * 2), height: Math.min(vp.height - y, box.height + pad * 2) };
}

async function doStep(page, step) {
  if (step.action === "press") return page.keyboard.press(step.key);
  // The lock screen, told as another tab tells it (app/src/auth/AuthProvider.tsx, its session channel).
  if (step.action === "lock")
    return page.evaluate((reason) => {
      const c = new window.BroadcastChannel("mycity-session");
      c.postMessage({ t: "locked", reason });
      c.close();
    }, step.reason);
  const l = await find(page, step.target);
  if (step.action === "click") return l.click();
  if (step.action === "fill") return l.fill(step.value);
  if (step.action === "wait") return l.waitFor();
  if (step.action === "scroll") return l.scrollIntoViewIfNeeded();
  throw new Error(`unknown step ${step.action}`);
}

/**
 * What never reaches a picture: the demo's own chrome (the mock's account buttons, the prototype
 * view switch) and what comes and goes by itself (toasts, the urgent bar, the shell's notices, a
 * tooltip opened by the focus a step left behind).
 */
const HIDE_DEMO = "[data-ui-ignore], [data-sonner-toaster], [data-urgent-bar], [data-shell-notice], [data-state=delayed-open], [data-state=instant-open] { display: none !important; }";

/** What a step can leave open: a dialog or sheet, or a panel such as the bell's. */
const OPEN = "[data-ui=modal], [role=dialog][data-state=open]";

/**
 * Sign in once per account and device; every picture of theirs is taken in that session. A
 * `guest` is nobody: each of their pictures opens its address afresh (the sign-in screen, a link).
 */
async function session(browser, origin, account, device) {
  const ctx = await browser.newContext({ ...SIZES[device], serviceWorkers: "block", reducedMotion: "reduce" });
  // Every picture shows the same moment, whenever it is taken: the demo's clock prompts, greetings
  // and "today" follow the clock, and a Monday morning would open Clock In over the screen.
  await ctx.clock.setFixedTime(PICTURE_TIME);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  if (account === "guest") return { ctx, page, guest: true };
  await page.goto(`${origin}/`);
  await page.addStyleTag({ content: HIDE_DEMO });
  await page.fill("#email", ACCOUNTS[account]);
  await page.fill("#pass", PASSWORD);
  await page.press("#pass", "Enter");
  // An account whose two-step asks for a code (the demo's CEO): the demo takes any six digits.
  const code = await page.waitForSelector("[data-ui=page], input[autocomplete=one-time-code]", { timeout: 10000 });
  if ((await code.getAttribute("autocomplete")) === "one-time-code") {
    await page.keyboard.type("123456");
    await page.waitForSelector("[data-ui=page]", { timeout: 10000 });
  }
  await page.evaluate(() => document.fonts.ready.then(() => true));
  return { ctx, page };
}

async function take(page, shot, device, file, { guest = false, origin = "" } = {}) {
  if (guest) {
    await page.goto(`${origin}${shot.spec.open}`);
    await page.addStyleTag({ content: HIDE_DEMO });
    await page.waitForSelector("#root *", { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
  } else {
    // Move inside the app: a reload would sign out (the session lives in memory).
    await page.evaluate((to) => {
      window.history.pushState(null, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, shot.spec.open);
  }
  await appSettle(page);
  // A prompt that opens by itself (clock in, a policy to acknowledge) is not the screen. An address
  // naming more than its tab may open a sheet on purpose (?policy=, ?view=), kept for the steps.
  const named = [...new URL(shot.spec.open, "http://guide").searchParams.keys()].some((k) => k !== "tab");
  for (let i = 0; i < 3 && (await page.$(OPEN)) && (!shot.spec.do.length || !named); i += 1) {
    await page.keyboard.press("Escape");
    await appSettle(page);
  }
  for (const step of shot.spec.do) {
    if (step.device && step.device !== device) continue;
    await doStep(page, step);
    await appSettle(page);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  if (shot.spec.marks.length) await drawMarks(page, shot.spec.marks);
  await page.waitForTimeout(80);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip: await clipOf(page, shot.spec.crop), animations: "disabled", caret: "hide" });
  await page.evaluate(() => document.querySelectorAll("[data-guide-marks]").forEach((n) => n.remove()));
  // Close whatever the steps opened, so the next picture starts from its screen.
  for (let i = 0; i < 3 && (await page.$(OPEN)); i += 1) {
    await page.keyboard.press("Escape");
    await appSettle(page);
  }
  // Escape hands focus back to what opened it, whose ring would show in the next picture.
  await page.evaluate(() => document.activeElement?.blur?.());
}

async function main(argv) {
  const opts = args(argv);
  if (opts.help) {
    console.log("Usage: npm run guide:shots [-- --chapter <slug> | --shot <id> | --stale]");
    return 0;
  }
  const list = wanted(opts);
  if (!list.length) {
    console.log("guide:shots: nothing to take");
    return 0;
  }
  ensureAppBuild();
  const { server, origin } = await serve(APP_DIST);
  const browser = await launch();
  const failed = [];
  const taken = new Map();
  try {
    for (const account of new Set(list.map((s) => s.spec.as)))
      for (const device of ["desktop", "phone"]) {
        const mine = list.filter((s) => s.spec.as === account && s.spec.devices.includes(device));
        if (!mine.length) continue;
        let s = await session(browser, origin, account, device);
        for (const shot of mine) {
          const file = path.join(IMG, shot.chapter, `${shot.id}.${device}.png`);
          try {
            await take(s.page, shot, device, file, { guest: s.guest, origin });
            taken.set(`${shot.chapter}/${shot.id}`, shot);
            console.log(`  ${shot.chapter}/${shot.id}.${device}.png`);
            // A locked session takes no more pictures: the next one starts signed in afresh.
            if (shot.spec.do.some((st) => st.action === "lock")) {
              await s.ctx.close();
              s = await session(browser, origin, account, device);
            }
          } catch (err) {
            failed.push(`${shot.chapter}/${shot.id} (${device}): ${String(err.message).split("\n")[0]}`);
            // A failed picture can leave the page anywhere: the next one starts from a fresh session.
            await s.ctx.close();
            s = await session(browser, origin, account, device);
          }
        }
        await s.ctx.close();
      }
  } finally {
    await browser.close();
    server.close();
  }
  for (const shot of taken.values()) {
    if (failed.some((f) => f.startsWith(`${shot.chapter}/${shot.id} `))) continue;
    const file = path.join(IMG, shot.chapter, "shots.json");
    const shots = readShots(shot.chapter);
    shots[shot.id] = { ...hashesOf(shot.spec), devices: shot.spec.devices };
    const sorted = Object.fromEntries(Object.entries(shots).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  if (failed.length) {
    console.error(`guide:shots: ${failed.length} picture(s) not taken\n  ${failed.join("\n  ")}`);
    return 1;
  }
  console.log(`guide:shots: ${taken.size} picture(s) taken`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`guide:shots: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { ACCOUNTS, wanted, main };
