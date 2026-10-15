"use strict";
/* global document, window, getComputedStyle */
/**
 * Opens every screen in Chromium at phone and desktop size and records what a
 * person sees: the copy in each slot (page title, card titles, buttons,
 * captions, help), the layout (sideways scroll, which navigation shows,
 * tables, tap targets) and any script error. The screen gates read it:
 * five-second.js (gate 8) and two-shells.js (gate 11), FRONTEND_GUIDE §5, §7.
 *
 * TARGETS (FRONTEND_FOUNDATION F10, F23)
 *   gallery  packages/ui's component gallery: built when missing or stale
 *            (lib/gallery.js), served on a local port, every component page
 *            (`#/<Component>`) opened at 390 and 1440 px. Copy is read by the
 *            data-ui slots the components set (SPEC §4). It is not an app, so
 *            the navigation and first-screen checks do not apply; sideways
 *            scroll (also a state wider than its phone frame), tap targets and
 *            tables do.
 *   demo     docs/MyCity-ERP-Documents/demo.html, frozen as a visual reference:
 *            crawled ONLY when the change touches it (lib/changes.js) or with
 *            --demo (or MYCITY_DEMO=1). It signs in, walks every module and tab
 *            in the navigation, the detail pages a row opens, and the modals a
 *            KPI card, an action or a row opens (desktop).
 *   app      the staff app, once it has a build and an exportable route list
 *            (FRONTEND_FOUNDATION PR 2). Until then it is reported as not built.
 *
 * One crawl serves both gates: the result is cached in the OS temp folder,
 * keyed by the inputs (the gallery's input hash, the demo when it is crawled,
 * this file and copy.js), so the second gate reuses it.
 *
 * Needs Playwright and Chromium: `npm ci`, then once `npx playwright install
 * chromium` (CI does this). Set MYCITY_CHROMIUM to use a browser binary of
 * your own. A crawl that cannot start fails the gate; it never passes it.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gallery = require("./gallery");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEMO = "docs/MyCity-ERP-Documents/demo.html";

const WIDTHS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 } },
};

/**
 * Where each kind of copy lives in the demo. The React app's shared components
 * carry the same slots as data-ui attributes (FRONTEND_GUIDE §9.4).
 */
const DEMO_TARGET = {
  id: "demo",
  file: DEMO,
  slots: {
    pageTitle: "#page .phead h1",
    pageSubtitle: "#page .phead > div > p",
    title: "#page .ch h3, #page .card > h3, #page .emptyb h3, #page .kpi .lab, #page .icard b, #modal .mhd h3",
    kpiCaption: "#page .kpi .trend",
    button: "#app button.btn, #app button.chip, #app button.tabbtn, #modal button.btn",
    header: "#page th, #modal th",
    chartCaption: "#page .cap",
    emptyText: "#page .emptyb p",
    help: ".htp, .ihelp",
    details: ".dtl-b",
    modalFooter: "#modal .mft",
    prose: "#page p, #page dd, #page li, #modal .mbd p, #modal .mbd dd, #modal .mbd li",
    nav: "#nav .navlab, #mob a",
  },
  /** Content a person wrote or received: data, not interface copy (§5.3). */
  content: [
    "[data-copy=content]",
    "td",
    ".art",
    ".mread",
    ".paper",
    ".paperwrap",
    ".bub",
    ".msg2",
    ".annmsg",
    ".annc",
    ".ai-a",
    ".ai-q",
    ".chat",
    ".rte",
    ".quote",
    ".celeb",
    ".recog",
    ".mlist",
    ".tl",
    ".task",
    ".who",
    ".pill",
    ".cal",
    ".pubpage",
    ".og-n",
  ],
  interactive: "#app a[href], #app button, #app [role=button], #app input:not([type=hidden]), #app select, #app textarea, #app summary",
  page: "#page",
  scroller: "#scroll",
  desktopNav: ".rail",
  phoneNav: "#mob",
  /** What a click on these opens is swept for modal copy (desktop). */
  modalOpeners: "[data-hk], [data-mo], [data-rule], .phead .right .btn",
  maxOpenersPerScreen: 12,
  modalRoot: "#modal",
  /** A help term is a word inside a sentence or a label, tapped as text (FRONTEND_GUIDE §5.2). */
  tapExempt: ".ht",
  checks: { navigation: true, firstScreen: true },
};

/** The data-ui slot names (packages/ui/src/lib/slots.ts) under the keys the gates use. */
const SLOT_NAMES = {
  pageTitle: "page-title",
  pageSubtitle: "page-subtitle",
  title: "title",
  kpiCaption: "kpi-caption",
  button: "button",
  header: "header",
  chartCaption: "chart-caption",
  emptyText: "empty-text",
  help: "help",
  details: "details",
  modalFooter: "modal-footer",
  nav: "nav",
};

/** The gallery: one page per component, each state in a light and a dark frame. */
const GALLERY_TARGET = {
  id: "gallery",
  slots: {
    ...Object.fromEntries(Object.entries(SLOT_NAMES).map(([k, v]) => [k, `[data-ui="${v}"]`])),
    prose: "main p, main dd, main li",
  },
  content: ["[data-copy=content]"],
  interactive:
    "main a[href], main button, main [role=button], main [role=tab], main [role=switch], main [role=checkbox], main [role=radio], main [role=menuitem], main input:not([type=hidden]), main select, main textarea, main summary",
  page: "main",
  scroller: null,
  desktopNav: null,
  phoneNav: null,
  modalRoot: "[role=dialog], [role=alertdialog]",
  /** A help term is a word inside a sentence or a label, tapped as text (FRONTEND_GUIDE §5.2). */
  tapExempt: "[data-help-term]",
  /** Each state's frame; a state wider than its phone frame scrolls sideways on a phone. */
  frames: "[data-gallery-frame]",
  /** The element that names a state (its heading via aria-labelledby). */
  state: "section[aria-labelledby]",
  /** Not an app: no navigation and no first phone screen to judge. */
  checks: { navigation: false, firstScreen: false },
};

function hashOf(files) {
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(fs.existsSync(f) ? fs.readFileSync(f) : "");
  return h.digest("hex").slice(0, 16);
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (err) {
    throw new Error("Playwright is not installed. Run `npm ci`.", { cause: err });
  }
}

async function launch() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch({ executablePath: process.env.MYCITY_CHROMIUM || undefined });
  } catch (err) {
    throw new Error(
      `Chromium did not start (${String(err.message).split("\n")[0]}).\n` +
        "Run `npx playwright install chromium` once, or set MYCITY_CHROMIUM to a Chromium binary.",
      { cause: err },
    );
  }
}

/* ───── runs in the page ───── */

function collect(cfg) {
  const contentSel = cfg.content.join(",");
  const visible = (el) =>
    el.checkVisibility
      ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length > 0
      : !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const text = (el) => String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const footerText = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("button").forEach((b) => b.remove());
    return String(c.textContent || "").replace(/\s+/g, " ").trim();
  };

  /* The gallery state an element belongs to ("" outside one, and on every other target). */
  const stateOf = (el) => {
    const s = cfg.state && el.closest(cfg.state);
    const id = s && s.getAttribute("aria-labelledby");
    const h = id && document.getElementById(id);
    return h ? text(h) : "";
  };

  const slots = [];
  for (const [slot, sel] of Object.entries(cfg.slots)) {
    document.querySelectorAll(sel).forEach((el) => {
      if (slot !== "help" && slot !== "details" && el.closest(contentSel)) return;
      const t = slot === "modalFooter" ? footerText(el) : text(el) || String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) return;
      const r = el.getBoundingClientRect();
      slots.push({ slot, text: t, visible: visible(el), modal: !!el.closest(cfg.modalRoot), state: stateOf(el), top: Math.round(r.top), bottom: Math.round(r.bottom) });
    });
  }

  /* Interface copy on the first screen: every visible text node in the page
     that is not content, counted once. */
  let firstScreenWords = 0;
  const firstScreenText = [];
  const page = document.querySelector(cfg.page);
  if (page) {
    const walker = document.createTreeWalker(page, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue.replace(/\s+/g, " ").trim();
      if (!v || !/\p{L}/u.test(v)) continue;
      const parent = n.parentElement;
      if (!parent || parent.closest(contentSel) || !visible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.top >= window.innerHeight || r.bottom <= 0) continue;
      const w = v.split(" ").filter((t) => /\p{L}/u.test(t)).length;
      firstScreenWords += w;
      firstScreenText.push(v);
    }
  }

  const taps = [];
  document.querySelectorAll(cfg.interactive).forEach((el) => {
    if (!visible(el) || el.closest(contentSel) || el.closest(cfg.tapExempt)) return;
    if (getComputedStyle(el).display === "inline") return;
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // A control inside its label (a checkbox row) is tapped through the label.
    const label = el.closest("label");
    if (label) {
      const lr = label.getBoundingClientRect();
      if (lr.width * lr.height > r.width * r.height) r = lr;
    }
    if (Math.round(r.width) < 44 || Math.round(r.height) < 44) {
      const name = (text(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName.toLowerCase()).slice(0, 40);
      const st = stateOf(el);
      taps.push({ label: st ? `${st} › ${name}` : name, w: Math.round(r.width), h: Math.round(r.height) });
    }
  });

  /* Gallery frames whose content is wider than the frame: on a phone that state scrolls sideways. */
  const frameOverflow = [];
  if (cfg.frames) {
    document.querySelectorAll(cfg.frames).forEach((f) => {
      if (f.scrollWidth > f.clientWidth + 1) {
        frameOverflow.push({ state: stateOf(f), frame: f.getAttribute("data-gallery-frame") || "", scrollWidth: f.scrollWidth, clientWidth: f.clientWidth });
      }
    });
  }

  const tables = page ? [...page.querySelectorAll("table")].filter((t) => visible(t) && !t.closest("[data-copy=content]")).length : 0;
  const scroller = cfg.scroller && document.querySelector(cfg.scroller);
  const desktopNav = cfg.desktopNav && document.querySelector(cfg.desktopNav);
  const phoneNav = cfg.phoneNav && document.querySelector(cfg.phoneNav);
  return {
    slots,
    firstScreenWords,
    firstScreenText: firstScreenText.join(" | ").slice(0, 400),
    layout: {
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      scrollerScrollWidth: scroller ? scroller.scrollWidth : 0,
      scrollerClientWidth: scroller ? scroller.clientWidth : 0,
      // On screen, not merely rendered: a phone may keep the sidebar as an off-screen drawer.
      desktopNav: !!(desktopNav && visible(desktopNav) && desktopNav.getBoundingClientRect().width > 0 &&
        desktopNav.getBoundingClientRect().right > 1 && desktopNav.getBoundingClientRect().left < window.innerWidth - 1),
      phoneNav: !!(phoneNav && visible(phoneNav) && phoneNav.getBoundingClientRect().height > 0),
      tables,
      taps,
      frameOverflow,
    },
  };
}

/* ───── demo driver ───── */

async function demoSignIn(page, file) {
  await page.goto(`file://${path.join(ROOT, file)}`);
  await page.fill("#email", "cynthia@mycityapp.io");
  await page.fill("#pass", "demo-password");
  await page.evaluate(() => document.querySelector("#lform").requestSubmit());
  await page.waitForSelector("#app.on", { timeout: 5000 });
  // Measure with the real typeface (Geist), not a fallback that wraps differently.
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // The clock-in prompt opens about 700 ms after sign-in (attendance guide).
  await page.waitForSelector("#modal.on", { timeout: 2500 }).catch(() => null);
}

const isModalOpen = (page) => page.evaluate(() => document.querySelector("#modal").classList.contains("on"));
async function closeModal(page) {
  await page.evaluate(() => {
    const x = document.querySelector("#modal [data-mx]");
    if (x) x.click();
    else document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  });
}

async function demoModules(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#nav a[data-m]")].map((a) => ({ m: a.dataset.m, name: a.textContent.trim().replace(/\s*\d+$/, "") })),
  );
}

async function demoGo(page, m, t) {
  await page.evaluate(
    ({ mm, tt }) => {
      const a = document.querySelector(`#nav a[data-m="${mm}"]`);
      if (a) a.click();
      if (tt !== null) {
        const b = document.querySelector(`.tabbtn[data-t="${tt}"]`);
        if (b) b.click();
      }
    },
    { mm: m, tt: t },
  );
}

async function crawlDemo(browser, width, target, errors) {
  const ctx = await browser.newContext(WIDTHS[width]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  let where = "sign-in";
  page.on("pageerror", (e) => errors.push({ width, screen: where, message: String(e.message).split("\n")[0] }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ width, screen: where, message: msg.text().split("\n")[0] });
  });
  page.on("dialog", (d) => {
    errors.push({ width, screen: where, message: `native ${d.type()} dialog opened (gate 16)` });
    d.dismiss().catch(() => null);
  });

  const screens = [];
  const snap = async (name, kind) => {
    // Settle entrance animations first: a modal fading in reads as invisible (opacity 0).
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish();
      }
    });
    const s = await page.evaluate(collect, target);
    screens.push({ target: target.id, width, screen: name, kind, checks: target.checks, ...s });
  };

  await demoSignIn(page, target.file);
  if (await isModalOpen(page)) {
    where = "Sign In › Clock In prompt";
    await snap(where, "modal");
    await closeModal(page);
  }

  const seenDetail = new Set();
  const seenModal = new Set();
  let skippedOpeners = 0;
  for (const mod of await demoModules(page)) {
    await demoGo(page, mod.m, null);
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll(".tabbtn[data-t]")].map((b) => ({ t: b.dataset.t, name: b.textContent.trim() })),
    );
    for (const tab of tabs.length ? tabs : [{ t: null, name: "" }]) {
      const name = tab.name ? `${mod.name} · ${tab.name}` : mod.name;
      where = name;
      await demoGo(page, mod.m, tab.t);
      if (await isModalOpen(page)) await closeModal(page);
      await snap(name, "screen");

      // Detail pages a row opens (an employee 360, a partner 360), once per kind.
      const details = await page.evaluate(() =>
        [...document.querySelectorAll("[data-dk]")].map((el, i) => ({ i, k: el.dataset.dk })),
      );
      for (const d of details) {
        if (seenDetail.has(d.k)) continue;
        seenDetail.add(d.k);
        where = `${name} › ${d.k} detail`;
        await page.evaluate((i) => document.querySelectorAll("[data-dk]")[i].click(), d.i);
        await snap(where, "screen");
        await demoGo(page, mod.m, tab.t);
      }

      if (width !== "desktop") continue;
      // Modals: KPI cards, row actions and header actions, desktop only.
      const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, target.modalOpeners);
      const limit = Math.min(count, target.maxOpenersPerScreen);
      skippedOpeners += count - limit;
      for (let i = 0; i < limit; i += 1) {
        await demoGo(page, mod.m, tab.t);
        if (await isModalOpen(page)) await closeModal(page);
        const ok = await page.evaluate(
          ({ sel, idx }) => {
            const el = document.querySelectorAll(sel)[idx];
            if (!el) return false;
            el.click();
            return true;
          },
          { sel: target.modalOpeners, idx: i },
        );
        if (!ok || !(await isModalOpen(page))) continue;
        const title = await page.evaluate(() => (document.querySelector("#modal .mhd h3") || {}).textContent || "");
        if (seenModal.has(title)) {
          await closeModal(page);
          continue;
        }
        seenModal.add(title);
        where = `${name} › ${title || "modal"}`;
        await snap(where, "modal");
        await closeModal(page);
      }
    }
  }
  await ctx.close();
  return { screens, skippedOpeners };
}

/* ───── gallery driver ───── */

async function crawlGallery(browser, url, names, width, errors) {
  const ctx = await browser.newContext(WIDTHS[width]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  let where = "Gallery";
  page.on("pageerror", (e) => errors.push({ width, screen: where, message: String(e.message).split("\n")[0] }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ width, screen: where, message: msg.text().split("\n")[0] });
  });
  page.on("dialog", (d) => {
    errors.push({ width, screen: where, message: `native ${d.type()} dialog opened (gate 16)` });
    d.dismiss().catch(() => null);
  });
  const screens = [];
  for (const name of names) {
    where = `Gallery · ${name}`;
    try {
      await gallery.openComponent(page, url, name);
    } catch (err) {
      errors.push({ width, screen: where, message: `the page did not render (${String(err.message).split("\n")[0]})` });
      continue;
    }
    const s = await page.evaluate(collect, GALLERY_TARGET);
    screens.push({ target: "gallery", width, screen: where, kind: "component", checks: GALLERY_TARGET.checks, ...s });
  }
  await ctx.close();
  return screens;
}

/**
 * Is demo.html crawled this run? Only when the change touches it, or when asked
 * (F23). Pure, for the tests: `changed` is lib/changes.js changedFiles() (or
 * null when git could not say, which crawls it rather than skip it unseen).
 */
function demoWanted(changed, argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--demo") || env.MYCITY_DEMO === "1") return true;
  if (changed === null) return true;
  return changed.some((c) => c.path === DEMO);
}

function changedOrNull() {
  try {
    return require("./changes").changedFiles();
  } catch {
    return null;
  }
}

/**
 * Crawl every target at both widths. Returns
 *   { checked: [ids], notBuilt: [notes], screens: [...], errors: [...], notes: [...] }
 */
async function crawl() {
  const withDemo = demoWanted(changedOrNull()) && fs.existsSync(path.join(ROOT, DEMO));
  const galleryHash = gallery.inputsHash();
  const key = crypto
    .createHash("sha1")
    .update([galleryHash, withDemo ? hashOf([path.join(ROOT, DEMO)]) : "no-demo", hashOf([__filename, path.join(__dirname, "copy.js"), path.join(__dirname, "gallery.js")])].join("|"))
    .digest("hex")
    .slice(0, 16);
  const cacheFile = path.join(os.tmpdir(), `mycity-screens-${key}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      /* a broken cache is crawled again */
    }
  }

  const result = { checked: [], notBuilt: [], screens: [], errors: [], notes: [] };
  const built = gallery.ensureGallery();
  const server = await gallery.serve(built.dir);
  const browser = await launch();
  try {
    const probe = await browser.newPage({ viewport: WIDTHS.desktop.viewport });
    const names = await gallery.componentNames(probe, server.url);
    await probe.close();
    if (!names.length) throw new Error("the gallery lists no component pages (packages/ui/src/**/*.gallery.tsx)");
    for (const width of Object.keys(WIDTHS)) {
      result.screens.push(...(await crawlGallery(browser, server.url, names, width, result.errors)));
    }
    result.checked.push(`gallery (${names.length} components)`);

    if (withDemo) {
      for (const width of Object.keys(WIDTHS)) {
        const r = await crawlDemo(browser, width, DEMO_TARGET, result.errors);
        result.screens.push(...r.screens);
        if (r.skippedOpeners) result.notes.push(`demo (${width}): ${r.skippedOpeners} modal openers beyond ${DEMO_TARGET.maxOpenersPerScreen} per screen were not opened`);
      }
      result.checked.push("demo.html");
    } else {
      result.notes.push("demo.html: not crawled, the change does not touch it (F23); --demo crawls it");
    }
  } finally {
    await browser.close();
    await server.close();
  }
  result.notBuilt.push("app/: no build and route list yet (FRONTEND_FOUNDATION PR 2); add its target here when it lands");

  fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

/**
 * Merge the same finding seen on several screens into one line that names
 * every screen. `--screen=<prefix>` (a module name, e.g. "Home"; repeat it for
 * several) keeps only findings seen on a screen whose name starts with one.
 */
function summarise(findings, argv = process.argv.slice(2)) {
  const prefixes = argv.filter((a) => a.startsWith("--screen=")).map((a) => a.slice(9));
  const prefix = prefixes.length ? prefixes.join(" | ") : null;
  const merged = new Map();
  for (const f of findings) {
    const key = `${f.width}|${f.message}`;
    if (!merged.has(key)) merged.set(key, { width: f.width, message: f.message, screens: [] });
    const m = merged.get(key);
    if (!m.screens.includes(f.screen)) m.screens.push(f.screen);
  }
  const all = [...merged.values()];
  const kept = prefixes.length ? all.filter((m) => m.screens.some((s) => prefixes.some((p) => s.startsWith(p)))) : all;
  kept.sort((a, b) => a.screens[0].localeCompare(b.screens[0]) || a.width.localeCompare(b.width));
  const lines = kept.map((m) => `  [${m.width}] ${m.screens[0]}: ${m.message}${m.screens.length > 1 ? `\n      also on ${m.screens.slice(1, 7).join("; ")}${m.screens.length > 7 ? ` and ${m.screens.length - 7} more` : ""}` : ""}`);
  return { lines, count: kept.length, total: all.length, prefix };
}

/** The usual end of a screen gate: print and exit. */
function finish(gate, findings, result, extra = []) {
  const { lines, count, total, prefix } = summarise(findings);
  const scope = `${result.checked.join(", ") || "nothing"}, ${result.screens.length} screen views`;
  const pending = [...result.notBuilt, ...result.notes].map((n) => `  note: ${n}`);
  if (count || extra.length) {
    console.error(`${gate}: ${count + extra.length} problem(s)${prefix ? ` on screens starting "${prefix}" (of ${total})` : ""} in ${scope}\n`);
    for (const l of [...extra, ...lines]) console.error(l);
    if (pending.length) console.error(`\n${pending.join("\n")}`);
    console.error("\nRules: docs/FRONTEND_GUIDE.md §5, §7, §8.");
    process.exit(1);
  }
  console.log(`${gate}: ok (${scope})`);
  for (const p of pending) console.log(p);
}

/** Run a gate body and turn a crawl that cannot start into a failure with its reason. */
function run(gate, body) {
  body().catch((err) => {
    console.error(`${gate}: could not run\n  ${err.message}`);
    process.exit(1);
  });
}

module.exports = { crawl, demoWanted, summarise, finish, run, collect, WIDTHS, DEMO_TARGET, GALLERY_TARGET, ROOT };
