"use strict";
/* global document, window, location, getComputedStyle, PopStateEvent */
/**
 * Opens every screen in Chromium at phone and desktop size and records what a
 * person sees: the copy in each slot (page title, card titles, buttons,
 * captions, help), the layout (sideways scroll, which navigation shows,
 * tables, tap targets), anything the browser draws for itself, and any
 * script error. The screen gates read it: five-second.js (gate 8),
 * two-shells.js (gate 11) and native-ui.js (gate 21), FRONTEND_GUIDE §5, §7, §8.8.
 *
 * TARGETS (FRONTEND_FOUNDATION F10, F23)
 *   gallery  packages/ui's component gallery: built when missing or stale
 *            (lib/gallery.js), served on a local port, every component page
 *            (`#/<Component>`) opened at 390 and 1440 px. Copy is read by the
 *            data-ui slots the components set. It is not an app, so the
 *            navigation and first-screen checks do not apply; sideways scroll
 *            (also a state wider than its phone frame), tap targets and tables do.
 *   demo     docs/MyCity-ERP-Documents/demo.html, frozen as a visual reference:
 *            crawled ONLY when the change touches it (lib/changes.js) or with
 *            --demo (or MYCITY_DEMO=1). It signs in, walks every module and tab
 *            in the navigation, the detail pages a row opens, and the modals a
 *            KPI card, an action or a row opens (desktop).
 *   app      the staff app's mock build (app/dist, `npm run build:demo` in app/:
 *            the in-browser mock API, so no server or database). Built here when
 *            it is missing or older than app/src. Signs in, then opens every
 *            module and tab in app/dist/screens.json, the route list the build
 *            writes from the shell's catalogue (FRONTEND_GUIDE §9.2). On a
 *            phone it then taps each screen's first two rows that open
 *            something and records where the record went (`rowOpens`, F31).
 *
 * One crawl serves both gates: the result is cached in the OS temp folder,
 * keyed by the inputs (the gallery's input hash, the demo when it is crawled,
 * the app build, this file and copy.js), so the second gate reuses it.
 *
 * MYCITY_SCREEN_TARGETS=gallery,app (any of gallery, demo, app) crawls only
 * those, for a quicker loop while fixing a screen; CI crawls them all.
 *
 * Needs Playwright and Chromium: `npm ci`, then once `npx playwright install
 * chromium` (CI does this). Set MYCITY_CHROMIUM to use a browser binary of
 * your own. A crawl that cannot start fails the gate; it never passes it.
 */
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const gallery = require("./gallery");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEMO = "docs/MyCity-ERP-Documents/demo.html";
/*
 * The screen gates' own demo build of the staff app (the in-browser mock), apart from app/dist,
 * where `npm run fe:build` writes the release build: `npm run ci` runs the frontend and screens
 * groups at the same time, and two builds in one folder would overwrite each other. It lives
 * under node_modules/.cache, which every scanner, ESLint and git already skip, and never ships.
 */
const APP_DIST = "node_modules/.cache/mycity/demo-app";

const WIDTHS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 } },
};

/**
 * What gate 21 (native-ui.js) looks for on a rendered page: elements the
 * browser draws itself, inputs whose type it draws, and the controls whose
 * computed appearance must be none (base.css resets them).
 */
const NATIVE = {
  tags: "select, datalist, progress, meter, dialog[open]",
  types: ["date", "time", "datetime-local", "month", "week", "number", "range", "color", "checkbox", "radio"],
  controls: "input:not([type=hidden]):not([type=file]), textarea, select, button",
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
  modal: "#modal",
  /** Help terms inside a sentence or heading: exempt from the 44 px tap rule (§7). */
  inlineHelp: ".ht",
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
  native: NATIVE,
};

/**
 * The staff app. Its shared components carry the slots as data-ui attributes
 * (FRONTEND_GUIDE §9.4); content a person wrote is marked data-copy="content".
 * Prototype-only chrome (the view switch, never on production) is marked
 * data-ui-ignore and is not part of a screen.
 */
const APP_TARGET = {
  id: "app",
  dist: APP_DIST,
  account: { email: "cynthia@mycityapp.io", password: "demo1234" },
  slots: {
    pageTitle: "[data-ui=page-title]",
    pageSubtitle: "[data-ui=page-subtitle]",
    title: "[data-ui=title]",
    kpiCaption: "[data-ui=kpi-caption]",
    button: "[data-ui=button]",
    header: "[data-ui=page] th, [data-ui=modal] th",
    chartCaption: "[data-ui=chart-caption]",
    emptyText: "[data-ui=empty-text]",
    help: "[data-ui=help]",
    details: "[data-ui=details]",
    modalFooter: "[data-ui=modal-footer]",
    prose: "[data-ui=page] p, [data-ui=page] dd, [data-ui=page] li, [data-ui=modal] p, [data-ui=modal] dd, [data-ui=modal] li",
    nav: "[data-ui=nav-label]",
  },
  content: ["[data-copy=content]", "td", "[data-ui-ignore]"],
  interactive: "#root a[href], #root button, #root [role=button], #root input:not([type=hidden]), #root select, #root textarea, #root summary",
  page: "[data-ui=page]",
  scroller: "[data-ui=scroller]",
  desktopNav: "[data-ui=desktop-nav]",
  phoneNav: "[data-ui=phone-nav]",
  modal: "[data-ui=modal]",
  modalRoot: "[data-ui=modal]",
  inlineHelp: "[data-help-term]",
  /* A help term is a word in a sentence: its tap target is the sentence's line (FRONTEND_GUIDE §5.2). */
  tapExempt: "[data-help-term]",
  checks: { navigation: true, firstScreen: true },
  native: NATIVE,
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

  /* Gate 21: anything the browser draws for itself (native-ui.js). Only where
     the target asks (the gallery and the app; demo.html is frozen, F23). */
  const native = [];
  if (cfg.native) {
    const shown = (el) => {
      if (!visible(el) || el.closest("[aria-hidden=true]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const push = (el, what) => {
      const label = (text(el) || el.getAttribute("aria-label") || el.getAttribute("name") || "").slice(0, 40);
      native.push({ what, label, state: stateOf(el) });
    };
    document.querySelectorAll(cfg.native.tags).forEach((el) => shown(el) && push(el, `<${el.tagName.toLowerCase()}>`));
    document.querySelectorAll("input").forEach((el) => {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (cfg.native.types.includes(type) && shown(el)) push(el, `<input type="${type}">`);
      else if (el.hasAttribute("list") && shown(el)) push(el, "<input list>");
    });
    document.querySelectorAll("[title]").forEach((el) => {
      if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || !String(el.getAttribute("title")).trim() || !visible(el)) return;
      push(el, `a title tooltip on <${el.tagName.toLowerCase()}>`);
    });
    document.querySelectorAll("form:not([novalidate])").forEach((el) => push(el, "a <form> without novalidate"));
    document.querySelectorAll(cfg.native.controls).forEach((el) => {
      if (!shown(el)) return;
      const look = getComputedStyle(el).appearance;
      if (look && look !== "none") push(el, `a <${el.tagName.toLowerCase()}> with appearance ${look}`);
    });
    document.querySelectorAll("[data-sonner-toast]").forEach((el) => {
      if (el.getAttribute("data-styled") !== "false") push(el, "a toast styled by sonner");
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
    native,
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

/* ───── app driver ───── */

/** The newest change under a folder (or a file), in ms. */
function newest(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return fs.readdirSync(p).reduce((m, f) => Math.max(m, newest(path.join(p, f))), st.mtimeMs);
}

/**
 * The staff app's demo build, made when it is missing or older than the app's
 * source, so the gates always read the app as it is now. Needs the
 * workspace's packages (`npm ci` at the root; CI installs them).
 */
function ensureAppBuild() {
  const app = path.join(ROOT, "app");
  if (!fs.existsSync(app)) return false;
  const built = path.join(ROOT, APP_DIST, "screens.json");
  // packages/ui is built into the app, so a change to a shared component makes the build stale too.
  // The demo carries the User Guide's chapters (the mock reads docs/manual), so a changed chapter rebuilds it too; its pictures do not.
  const manual = path.join(ROOT, "docs", "manual");
  const chapters = fs.existsSync(manual) ? fs.readdirSync(manual).filter((f) => f.endsWith(".md")).map((f) => newest(path.join(manual, f))) : [];
  const source = Math.max(newest(path.join(app, "src")), newest(path.join(ROOT, "packages", "ui", "src")), newest(path.join(app, "index.html")), newest(path.join(app, "vite.config.ts")), newest(path.join(app, "package.json")), newest(path.join(ROOT, "docs", "PROGRESS.md")), ...chapters);
  const mock = () => {
    try {
      return JSON.parse(fs.readFileSync(built, "utf8")).api_mode === "mock";
    } catch {
      return false;
    }
  };
  // A production build talks to the real API; the crawl needs the demo build.
  if (fs.existsSync(built) && fs.statSync(built).mtimeMs >= source && mock()) return true;
  const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) {
    throw new Error("The workspace has no packages installed. Run `npm ci` at the root (CI does this), then the gate again.");
  }
  // Vite alone, as `npm run build:demo` builds after its type check: the type check is the
  // frontend group's (fe-typecheck), and two `tsc -b` at once would share their build info.
  const r = spawnSync(process.execPath, [vite, "build", "--mode", "demo", "--outDir", path.join(ROOT, APP_DIST), "--emptyOutDir", "--logLevel", "warn"], {
    cwd: app,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`app/ did not build (vite build --mode demo):\n${String(r.stdout || "").slice(-1500)}${String(r.stderr || "").slice(-800)}`);
  return true;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

/** Serve a built single-page app on a free local port: files as they are, every other path gets index.html. */
function serve(dir) {
  const root = path.join(ROOT, dir);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(root, url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/** The app is settled when nothing on the page is loading and nothing is animating in. */
async function appSettle(page) {
  await page.waitForFunction(() => !document.querySelector("[data-ui=page] [aria-busy=true], [data-ui=modal] [aria-busy=true]"), null, { timeout: 4000 }).catch(() => null);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish();
    }
  });
}

/* ───── F31: where a phone row's record opens (two-shells.js) ───── */

/**
 * How many rows a phone screen's check taps: the first two, so a screen that
 * shows its first pick in the page unasked still changes on the second.
 */
const ROW_TAPS = 2;

/**
 * Runs in the page, in three steps. "mark": marks the i-th visible row that
 * opens something (DataView's phone cards, TapList, Kanban: `data-row-open`)
 * and its list, and reads what the page shows outside that list. "tap": taps
 * it. "after": says where the record went: "sheet" (a modal or sheet), "cover"
 * (a pane over the whole screen, as SplitPanes draws one), "screen" (the list
 * left the page: the record's own screen), "page" (the page beside the list
 * changed: the record opened in it, which F31 refuses), "address" or "nothing".
 */
function rowProbe({ step, i, before, page, modal }) {
  const visible = (el) =>
    el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length > 0 : !!el.getClientRects().length;
  const root = document.querySelector(page);
  const pageText = () => {
    const parts = [];
    if (!root) return "";
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue.replace(/\s+/g, " ").trim();
      const parent = n.parentElement;
      if (!v || !parent || parent.closest("[data-gate-list], [data-ui-ignore]") || !visible(parent)) continue;
      parts.push(v);
    }
    return parts.join(" ");
  };
  if (step === "mark") {
    document.querySelectorAll("[data-gate-row]").forEach((el) => el.removeAttribute("data-gate-row"));
    document.querySelectorAll("[data-gate-list]").forEach((el) => el.removeAttribute("data-gate-list"));
    if (!root || [...document.querySelectorAll(modal)].some(visible)) return null;
    const row = [...root.querySelectorAll("[data-row-open]")].filter(visible)[i];
    if (!row) return null;
    const list = row.closest("ul, ol, [role=list]") || row.parentElement;
    row.setAttribute("data-gate-row", "");
    list.setAttribute("data-gate-list", "");
    return { label: String(row.innerText || row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), href: location.href, text: pageText() };
  }
  if (step === "tap") {
    const row = document.querySelector("[data-gate-row]");
    if (row) row.click();
    return null;
  }
  if ([...document.querySelectorAll(modal)].some(visible)) return "sheet";
  const covers = (el) => {
    if (getComputedStyle(el).position !== "fixed" || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  };
  if (root && [...root.querySelectorAll("*")].some(covers)) return "cover";
  const list = document.querySelector("[data-gate-list]");
  if (!list || !visible(list)) return "screen";
  if (pageText() !== before.text) return "page";
  return location.href === before.href ? "nothing" : "address";
}

/** Closes whatever a tapped row opened: Esc, then the phone's Back, which every overlay answers (F29). */
async function closeOpened(page, target) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0), target.modal);
    if (!open) return;
    if (attempt < 2) await page.keyboard.press("Escape");
    else await page.evaluate(() => window.history.back());
    await appSettle(page);
  }
}

/** Taps the first rows of a phone screen and records where each record opened (F31). */
async function rowOpens(page, target, screenPath) {
  const opens = [];
  // A list that waits on its summary arrives a reply later than the page settles (the mock answers in 90 to 250 ms).
  await page.waitForFunction((sel) => !!document.querySelector(`${sel} [data-row-open]`), target.page, { timeout: 800 }).catch(() => null);
  await appSettle(page);
  for (let i = 0; i < ROW_TAPS; i += 1) {
    const before = await page.evaluate(rowProbe, { step: "mark", i, page: target.page, modal: target.modal });
    if (!before) break;
    await page.evaluate(rowProbe, { step: "tap", page: target.page, modal: target.modal });
    await appSettle(page);
    const outcome = await page.evaluate(rowProbe, { step: "after", before, page: target.page, modal: target.modal });
    opens.push({ label: before.label, outcome });
    await closeOpened(page, target);
    if (outcome !== "sheet" && outcome !== "nothing") {
      // Back to the screen as the crawl opened it, for the next tap.
      await page.evaluate((to) => {
        window.history.pushState(null, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, screenPath);
      await appSettle(page);
    }
  }
  return opens;
}

async function crawlApp(browser, width, target, origin, list, errors) {
  // No service worker: every screen is served fresh from the build.
  const ctx = await browser.newContext({ ...WIDTHS[width], serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  let where = "sign-in";
  page.on("pageerror", (e) => errors.push({ width, screen: where, message: String(e.message).split("\n")[0] }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ width, screen: where, message: msg.text().split("\n")[0] });
  });
  page.on("dialog", (d) => {
    errors.push({ width, screen: where, message: `native ${d.type()} dialog opened (gate 16)` });
    d.dismiss().catch(() => null);
  });

  await page.goto(`${origin}/`);
  await page.fill("#email", target.account.email);
  await page.fill("#pass", target.account.password);
  await page.press("#pass", "Enter");
  await page.waitForSelector(target.page, { timeout: 8000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const screens = [];
  for (const s of list) {
    where = `${s.module_label} · ${s.tab_label} [app]`;
    // Move inside the app (a reload would sign out: the session lives in memory).
    await page.evaluate((to) => {
      window.history.pushState(null, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, s.path);
    await appSettle(page);
    // A prompt that opens by itself (the clock-in prompt) is its own view; the screen is read without it.
    if (await page.$(target.modal)) {
      screens.push({ target: target.id, width, screen: `${where} › opened by itself`, kind: "modal", checks: target.checks, ...(await page.evaluate(collect, target)) });
      await page.keyboard.press("Escape");
      await appSettle(page);
    }
    const view = { target: target.id, width, screen: where, kind: "screen", checks: target.checks, ...(await page.evaluate(collect, target)) };
    // On a phone, where a tapped row's record opens (F31): read last, so the screen above is read as it loads.
    if (width === "phone") view.rowOpens = await rowOpens(page, target, s.path);
    screens.push(view);
  }
  await ctx.close();
  return { screens };
}

/**
 * Crawl every target at both widths. Returns
 *   { checked: [ids], notBuilt: [notes], screens: [...], errors: [...], notes: [...] }
 */
async function crawl() {
  const only = (process.env.MYCITY_SCREEN_TARGETS || "gallery,demo,app").split(",").map((t) => t.trim());
  const withDemo = only.includes("demo") && demoWanted(changedOrNull()) && fs.existsSync(path.join(ROOT, DEMO));
  if (only.includes("app")) ensureAppBuild();
  const appList = path.join(ROOT, APP_DIST, "screens.json");
  const appIndex = path.join(ROOT, APP_DIST, "index.html");
  const key = crypto
    .createHash("sha1")
    .update(
      [
        only.includes("gallery") ? gallery.inputsHash() : "no-gallery",
        withDemo ? hashOf([path.join(ROOT, DEMO)]) : "no-demo",
        only.includes("app") ? hashOf([appList, appIndex]) : "no-app",
        hashOf([__filename, path.join(__dirname, "copy.js"), path.join(__dirname, "gallery.js")]),
        only.join("+"),
      ].join("|"),
    )
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
  const built = only.includes("gallery") ? gallery.ensureGallery() : null;
  const server = built ? await gallery.serve(built.dir) : null;
  const browser = await launch();
  try {
    if (!only.includes("gallery")) {
      result.notes.push("gallery not crawled (MYCITY_SCREEN_TARGETS)");
    } else {
      const probe = await browser.newPage({ viewport: WIDTHS.desktop.viewport });
      const names = await gallery.componentNames(probe, server.url);
      await probe.close();
      if (!names.length) throw new Error("the gallery lists no component pages (packages/ui/src/**/*.gallery.tsx)");
      for (const width of Object.keys(WIDTHS)) {
        result.screens.push(...(await crawlGallery(browser, server.url, names, width, result.errors)));
      }
      result.checked.push(`gallery (${names.length} components)`);
    }

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
    if (!only.includes("app")) {
      result.notes.push("app/ not crawled (MYCITY_SCREEN_TARGETS)");
    } else if (fs.existsSync(appList) && fs.existsSync(appIndex)) {
      const list = JSON.parse(fs.readFileSync(appList, "utf8")).screens;
      const app = await serve(APP_DIST);
      try {
        for (const width of Object.keys(WIDTHS)) {
          const r = await crawlApp(browser, width, APP_TARGET, app.origin, list, result.errors);
          result.screens.push(...r.screens);
        }
      } finally {
        app.server.close();
      }
      result.checked.push("app/");
    } else {
      throw new Error("app/ did not produce dist/screens.json. Run `npm run build:demo` in app/ and read its output.");
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

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

module.exports = { crawl, demoWanted, summarise, finish, run, collect, ensureAppBuild, serve, appSettle, launch, hashOf, WIDTHS, DEMO_TARGET, GALLERY_TARGET, APP_TARGET, APP_DIST, ROOT };
