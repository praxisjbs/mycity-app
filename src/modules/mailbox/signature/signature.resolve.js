"use strict";
/**
 * A signature's content, PURE (mailbox.md §3 step 7): records in, one model out. Both drawings
 * (signature.html.js) and the Signature tab read this model, so what a person sees is what a
 * recipient gets.
 *
 * A value that is not there leaves its line out: the model holds null for it, never an empty
 * string, so no drawing can print an empty line or a separator with nothing beside it.
 */
const c = require("@mycity/contract");
const { displayName, rcOf } = require("../../../shared/organisation/profile");

/** No configuration row yet reads as no links and every switch on (mailbox.md §4). */
const CONFIG_DEFAULTS = Object.freeze({
  ...Object.fromEntries(c.mailbox.SIGNATURE_LINKS.map((k) => [k, null])),
  confidentiality_note: null,
  show_whatsapp: true,
  show_app_links: true,
  show_social_links: true,
  show_legal: true,
});

/** No row for a person reads as both switches on and no office line. */
const MINE_DEFAULTS = Object.freeze({ office_line: null, show_mobile: true, show_whatsapp: true });

/** The social links in the order the band shows them, and the app links in theirs. */
const SOCIAL = [
  ["instagram", "instagram_url", "Instagram"],
  ["tiktok", "tiktok_url", "TikTok"],
  ["linkedin", "linkedin_url", "LinkedIn"],
  ["x", "x_url", "X"],
  ["facebook", "facebook_url", "Facebook"],
  ["youtube", "youtube_url", "YouTube"],
];
const APPS = [
  ["app_store", "app_store_url", "App Store"],
  ["google_play", "google_play_url", "Google Play"],
];

const clean = (v) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
};

/**
 * A stored number as a person reads it. A Nigerian number (E.164, +234 and ten digits) is
 * grouped as it is spoken, +234 801 234 5678; any other number is shown as stored.
 */
function phoneDisplay(e164) {
  const v = clean(e164);
  if (!v) return null;
  const ng = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(v);
  return ng ? `+234 ${ng[1]} ${ng[2]} ${ng[3]}` : v;
}

/** `tel:` takes digits and a leading +, nothing else. */
const telOf = (v) => String(v || "").replace(/[^\d+]/g, "");

/** A web address as a person reads it: no scheme and no trailing slash. */
function webDisplay(url) {
  const v = clean(url);
  if (!v) return null;
  return v.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** A bare domain is not a link until it has a scheme. */
const webHref = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/**
 * @param {object} input
 * @param {object} input.person  employee: first_name, last_name, preferred_name, job_title,
 *                               department, phone (E.164), work_email
 * @param {object|null} input.mine     mail_signature: office_line, show_mobile, show_whatsapp
 * @param {string|null} input.mailbox  the connected mailbox's address, if any
 * @param {object} input.org     shared/organisation/profile readProfile()
 * @param {object|null} input.config  mail_signature_config
 * @param {{white_logo: boolean, icon: boolean}} [input.brand]  which brand files exist
 */
function resolve({ person = {}, mine = null, mailbox = null, org = {}, config = null, brand = {} }) {
  const p = person || {};
  const m = { ...MINE_DEFAULTS, ...(mine || {}) };
  const cfg = { ...CONFIG_DEFAULTS, ...(config || {}) };

  const first = clean(p.preferred_name) || clean(p.first_name);
  const name = [first, clean(p.last_name)].filter(Boolean).join(" ") || clean(p.work_email) || "";

  const mobileRaw = m.show_mobile ? clean(p.phone) : null;
  const mobile = mobileRaw
    ? {
        display: phoneDisplay(mobileRaw),
        tel: telOf(mobileRaw),
        whatsapp: cfg.show_whatsapp && m.show_whatsapp ? `https://wa.me/${telOf(mobileRaw).replace(/^\+/, "")}` : null,
      }
    : null;
  const officeRaw = clean(m.office_line);
  const office = officeRaw ? { display: phoneDisplay(officeRaw), tel: telOf(officeRaw) } : null;

  const website = clean(org.website) ? { display: webDisplay(org.website), href: webHref(clean(org.website)) } : null;
  const links = (list, on) =>
    on
      ? list
          .map(([key, field, label]) => ({ key, label, href: clean(cfg[field]) }))
          .filter((l) => l.href)
      : [];

  return {
    name,
    job_title: clean(p.job_title),
    department: clean(p.department),
    mobile,
    office,
    email: clean(mailbox) || clean(p.work_email),
    website,
    company: displayName(org),
    // The legal line names the entity the RC number belongs to.
    legal_name: clean(org.legal_name) || displayName(org),
    address: clean(org.address),
    rc: cfg.show_legal ? rcOf(org.registration_number) : null,
    note: cfg.show_legal ? clean(cfg.confidentiality_note) : null,
    socials: links(SOCIAL, cfg.show_social_links),
    apps: links(APPS, cfg.show_app_links),
    band: brand.white_logo ? "logo_white" : brand.icon ? "icon" : "pin",
  };
}

module.exports = { resolve, phoneDisplay, webDisplay, telOf, CONFIG_DEFAULTS, MINE_DEFAULTS, SOCIAL, APPS };
