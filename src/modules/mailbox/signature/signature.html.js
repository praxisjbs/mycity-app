"use strict";
/**
 * A signature drawn, PURE (mailbox.md §3 step 7): the model from signature.resolve.js and its
 * pictures in, email-safe HTML and plain text out, for the full signature and the slim line.
 *
 * Email-safe means what Outlook's Word engine and Gmail both draw: tables, inline styles, a
 * web-safe stack, no classes, no flex, no web fonts, every picture an <img> with its size and
 * an alt. Outlook ignores max-width, so the 400 px limit is also a fixed table only it reads.
 *
 * Colours are chosen for dark mode too, which recolours text and backgrounds but never
 * pictures: the band is already dark and stays as sent; the yellow rules are borders, which
 * keep their colour; secondary text is #32413D, dark enough to be flipped light (10.7:1 on
 * white, 4.6:1 after the flip), where the mid greys of printed paper stay put and fade.
 */

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const INK = "#0A1412";
const GREEN = "#014339";
const SECONDARY = "#32413D";
const SEPARATOR = "#B9C4C1";
const DEEP = "#01221D";
const YELLOW = "#FFDF55";
const WHITE = "#FFFFFF";
const WIDTH = 400;

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const link = (href, text, style) =>
  `<a href="${esc(href)}" style="${style};text-decoration:none">${esc(text)}</a>`;
const dot = `<span style="color:${SEPARATOR}">&nbsp;&middot;&nbsp;</span>`;
const line = (html, style) => `<div style="${style}">${html}</div>`;

/** One picture: always its size, its alt, and no border; alt text styled for a reader that hides pictures. */
function img(pic, alt, altStyle = "") {
  return `<img src="${esc(pic.src)}" width="${pic.width}" height="${pic.height}" alt="${esc(alt)}" style="display:block;width:${pic.width}px;height:${pic.height}px;border:0;outline:none;text-decoration:none${altStyle}">`;
}

const row = (cells) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cells.join("")}</tr></table>`;

/** The band's left: the White Logo alone, or the icon or pin beside the company's name. */
function bandLeft(model, pics) {
  const pic = pics.band;
  if (model.band === "logo_white" && pic)
    return img(pic, model.company, `;color:${WHITE};font-family:${FONT};font-size:15px;font-weight:700`);
  const name = `<td valign="middle" style="padding:0 0 0 7px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:${WHITE};letter-spacing:-0.3px">${esc(model.company)}</td>`;
  return pic ? row([`<td valign="middle" style="padding:0">${img(pic, "")}</td>`, name]) : row([name]);
}

/** The band's right: the social icons, or the website when there are none. */
function bandRight(model, pics) {
  const icons = model.socials
    .filter((s) => pics.social && pics.social[s.key])
    .map(
      (s, i) =>
        `<td valign="middle" style="padding:0 0 0 ${i ? 10 : 0}px"><a href="${esc(s.href)}" style="text-decoration:none">${img(pics.social[s.key], s.label, `;color:${WHITE};font-family:${FONT};font-size:11px`)}</a></td>`,
    );
  if (icons.length) return row(icons);
  if (model.website)
    return link(model.website.href, model.website.display, `color:${YELLOW};font-family:${FONT};font-size:12px;line-height:16px;font-weight:700`);
  return "";
}

/** The full signature (new mail, forwards): the person, the band, the apps, the company line. */
function full(model, pics = {}) {
  const socialsShown = model.socials.some((s) => pics.social && pics.social[s.key]);
  const person = [
    line(esc(model.name), `font-size:20px;line-height:24px;font-weight:700;color:${INK};letter-spacing:-0.3px`),
    model.job_title &&
      line(esc(model.job_title), `font-size:13px;line-height:19px;font-weight:700;color:${GREEN};padding-top:3px`),
    model.department && line(esc(model.department), `font-size:13px;line-height:19px;color:${SECONDARY}`),
  ];
  const label = (text) => `<span style="color:${SECONDARY}">${text}&nbsp;</span>`;
  const reach = [];
  if (model.mobile)
    reach.push(
      (model.office ? label("Mobile") : "") +
        link(`tel:${model.mobile.tel}`, model.mobile.display, `color:${INK}`) +
        (model.mobile.whatsapp ? dot + link(model.mobile.whatsapp, "WhatsApp", `color:${GREEN};font-weight:700`) : ""),
    );
  if (model.office) reach.push(label("Office") + link(`tel:${model.office.tel}`, model.office.display, `color:${INK}`));
  if (model.email) reach.push(link(`mailto:${model.email}`, model.email, `color:${INK}`));
  if (model.website && socialsShown)
    reach.push(link(model.website.href, model.website.display, `color:${GREEN};font-weight:700`));
  const reachHtml = reach
    .map((html, i) => line(html, `font-size:13px;line-height:20px${i ? "" : ";padding-top:10px"}`))
    .join("");

  const apps = model.apps.filter((a) => pics.app && pics.app[a.key]);
  const appsRow = apps.length
    ? `<tr><td style="padding:10px 0 0 0">${row([
        `<td valign="middle" style="padding:0 8px 0 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;color:${GREEN}">Get the App</td>`,
        ...apps.map(
          (a, i) =>
            `<td valign="middle" style="padding:0 0 0 ${i ? 6 : 0}px"><a href="${esc(a.href)}" style="text-decoration:none">${img(pics.app[a.key], a.label, `;color:${GREEN};font-family:${FONT};font-size:11px`)}</a></td>`,
        ),
      ])}</td></tr>`
    : "";
  const companyLine = [model.legal_name || model.company, model.rc, model.address].filter(Boolean).map(esc).join(dot);
  const note = model.note
    ? `<tr><td style="padding:4px 0 0 0;font-family:${FONT};font-size:10px;line-height:14px;color:${SECONDARY}">${esc(model.note)}</td></tr>`
    : "";

  const table = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:${WIDTH}px;border-collapse:separate;font-family:${FONT};color:${INK}">
<tr><td style="padding:0 0 14px 0;font-family:${FONT}">${person.filter(Boolean).join("")}${reachHtml}</td></tr>
<tr><td bgcolor="${DEEP}" style="background-color:${DEEP};border-radius:8px 8px 0 0;border-bottom:4px solid ${YELLOW};padding:11px 16px 11px 14px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td valign="middle" style="padding:0">${bandLeft(model, pics)}</td><td align="right" valign="middle" style="padding:0">${bandRight(model, pics)}</td></tr></table></td></tr>
${appsRow}<tr><td style="padding:8px 0 0 0;font-family:${FONT};font-size:11px;line-height:16px;color:${SECONDARY}">${companyLine}</td></tr>
${note}</table>`;
  const html = `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}"><tr><td><![endif]-->${table}<!--[if mso]></td></tr></table><![endif]-->`;

  const text = [
    model.name,
    model.job_title,
    model.department,
    model.mobile &&
      `${model.office ? "Mobile " : ""}${model.mobile.display}${model.mobile.whatsapp ? ` · WhatsApp ${model.mobile.whatsapp}` : ""}`,
    model.office && `Office ${model.office.display}`,
    model.email,
    model.website && model.website.display,
    [model.legal_name || model.company, model.rc, model.address].filter(Boolean).join(" · "),
    model.socials.length ? model.socials.map((s) => `${s.label} ${s.href}`).join(" · ") : null,
    model.apps.length ? `Get the App: ${model.apps.map((a) => `${a.label} ${a.href}`).join(" · ")}` : null,
    model.note,
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

/** The slim line (replies, colleague-only mail): two lines beside a yellow rule. */
function slim(model) {
  const phone = model.mobile || model.office;
  const first = `<span style="font-weight:700;color:${GREEN}">${esc(model.name)}</span>${model.job_title ? `<span style="color:${SECONDARY}">, ${esc(model.job_title)}</span>` : ""}`;
  const second = `<span style="font-weight:700;color:${GREEN}">${esc(model.company)}</span>${phone ? dot + link(`tel:${phone.tel}`, phone.display, `color:${INK}`) : ""}`;
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT}"><tr><td style="width:2px;padding:0;border-left:2px solid ${YELLOW};font-size:0;line-height:0">&nbsp;</td><td style="padding:1px 0 1px 12px;font-family:${FONT}">${line(first, "font-size:13px;line-height:19px")}${line(second, "font-size:13px;line-height:19px")}</td></tr></table>`;
  const text = [
    [model.name, model.job_title].filter(Boolean).join(", "),
    [model.company, phone && phone.display].filter(Boolean).join(" · "),
  ].join("\n");
  return { html, text };
}

/**
 * @param {object} model  signature.resolve.js resolve()
 * @param {object} [pics] { band, social: { instagram, … }, app: { app_store, google_play } }, each
 *                        { src, width, height }: cid: when sent, data: for a preview
 */
function render(model, pics = {}) {
  return { full: full(model, pics), slim: slim(model) };
}

module.exports = { render, full, slim, esc, WIDTH };
