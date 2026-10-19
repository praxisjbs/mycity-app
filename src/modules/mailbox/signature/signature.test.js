"use strict";
/** Signature rules that need no database (the API and sending are covered in tests/integration/mailbox-signature.test.js). */
const sharp = require("sharp");
const { resolve, phoneDisplay, webDisplay } = require("./signature.resolve");
const { rcOf } = require("../../../shared/organisation/profile");
const { full, slim } = require("./signature.html");
const { place, quoteIn } = require("./signature.place");
const { signatureFor, domainOf } = require("./signature.service");
const images = require("./signature.images");

const person = {
  first_name: "Chidinma",
  preferred_name: "Chidi",
  last_name: "Okafor",
  job_title: "Content Associate",
  department: "HR & Operations",
  phone: "+2348031234567",
  work_email: "chidi@mycityapp.io",
};
const org = {
  legal_name: "MyCity App Ltd",
  trading_name: "MyCity App",
  registration_number: "1234567",
  address: "Lekki, Lagos",
  website: "https://mycityapp.io/",
};

describe("what a signature is made of", () => {
  test("the preferred name, the record's lines, and the company from the organisation profile", () => {
    const m = resolve({ person, org, mailbox: "chidi@mycityapp.io" });
    expect(m).toMatchObject({
      name: "Chidi Okafor",
      job_title: "Content Associate",
      department: "HR & Operations",
      email: "chidi@mycityapp.io",
      company: "MyCity App",
      legal_name: "MyCity App Ltd",
      rc: "RC 1234567",
      address: "Lekki, Lagos",
      website: { display: "mycityapp.io", href: "https://mycityapp.io/" },
      band: "pin",
      socials: [],
      apps: [],
    });
    expect(m.mobile).toEqual({ display: "+234 803 123 4567", tel: "+2348031234567", whatsapp: "https://wa.me/2348031234567" });
  });

  test("a value that is not there is null, never an empty string", () => {
    const m = resolve({ person: { first_name: "Ada", last_name: "Obi", job_title: " ", phone: null, work_email: "ada@mycityapp.io" }, org: {} });
    expect(m).toMatchObject({ name: "Ada Obi", job_title: null, department: null, mobile: null, office: null, rc: null, address: null, website: null, note: null });
    expect(m.company).toBe("MyCity App");
  });

  test("WhatsApp needs the person's switch and the company's; Show Mobile off hides both", () => {
    expect(resolve({ person, mine: { show_whatsapp: false } }).mobile.whatsapp).toBeNull();
    expect(resolve({ person, config: { show_whatsapp: false } }).mobile.whatsapp).toBeNull();
    expect(resolve({ person, mine: { show_mobile: false } }).mobile).toBeNull();
  });

  test("links only where entered, in the band's order; switches off take them away", () => {
    const config = { youtube_url: "https://youtube.com/@mycity", instagram_url: "https://instagram.com/mycityapp", tiktok_url: "", app_store_url: "https://apps.apple.com/x" };
    const m = resolve({ person, config });
    expect(m.socials.map((s) => s.key)).toEqual(["instagram", "youtube"]);
    expect(m.apps.map((a) => a.key)).toEqual(["app_store"]);
    const off = resolve({ person, config: { ...config, show_social_links: false, show_app_links: false, show_legal: false, confidentiality_note: "Confidential." }, org });
    expect(off).toMatchObject({ socials: [], apps: [], rc: null, note: null });
  });

  test("the band: the White Logo, else the Icon, else the drawn pin", () => {
    expect(resolve({ person, brand: { white_logo: true, icon: true } }).band).toBe("logo_white");
    expect(resolve({ person, brand: { icon: true } }).band).toBe("icon");
    expect(resolve({ person }).band).toBe("pin");
  });

  test("numbers, addresses and the RC number as people read them", () => {
    expect(phoneDisplay("+2348031234567")).toBe("+234 803 123 4567");
    expect(phoneDisplay("+447884050144")).toBe("+447884050144");
    expect(webDisplay("https://www.mycityapp.io/")).toBe("www.mycityapp.io");
    expect(rcOf("1234567")).toBe("RC 1234567");
    expect(rcOf("RC 1234567")).toBe("RC 1234567");
  });
});

describe("the drawings", () => {
  const pic = { src: "cid:p", width: 16, height: 16 };

  test("every value is escaped", () => {
    const m = resolve({ person: { ...person, preferred_name: null, first_name: "<script>alert(1)</script>", job_title: 'A "quoted" & <b>' } });
    const f = full(m);
    expect(f.html).not.toContain("<script>");
    expect(f.html).toContain("&lt;script&gt;");
    expect(f.html).toContain("A &quot;quoted&quot; &amp; &lt;b&gt;");
    expect(slim(m).html).not.toContain("<b>");
  });

  test("an absent line is left out, with no stray separator", () => {
    const m = resolve({ person: { first_name: "Ada", last_name: "Obi", work_email: "ada@mycityapp.io" }, org: {} });
    const f = full(m, { band: pic });
    expect(f.html).not.toMatch(/null|undefined|&middot;&nbsp;<\/span><\/div>/);
    expect(f.text).toBe("Ada Obi\nada@mycityapp.io\nMyCity App");
    expect(slim(m).text).toBe("Ada Obi\nMyCity App");
  });

  test("the full signature: Mobile and Office labelled only when both are there; the website moves up beside the socials", () => {
    const both = full(resolve({ person, mine: { office_line: "+2342012345678" }, org }));
    expect(both.html).toContain("Mobile&nbsp;");
    expect(both.html).toContain("Office&nbsp;");
    const one = full(resolve({ person, org }));
    expect(one.html).not.toContain("Mobile&nbsp;");
    // No social icons: the website sits in the band.
    expect(one.html).toMatch(/border-bottom:4px solid #FFDF55[^]*mycityapp\.io<\/a>/);
    const social = resolve({ person, org, config: { instagram_url: "https://instagram.com/mycityapp" } });
    const withIcons = full(social, { band: pic, social: { instagram: pic } });
    expect(withIcons.html).toContain('alt="Instagram"');
    expect(withIcons.html.indexOf("mycityapp.io</a>")).toBeLessThan(withIcons.html.indexOf("border-bottom:4px"));
  });

  test("the slim line falls back to the office line when the mobile is hidden", () => {
    const s = slim(resolve({ person, mine: { show_mobile: false, office_line: "+2342012345678" } }));
    expect(s.text).toBe("Chidi Okafor, Content Associate\nMyCity App · +234 201 234 5678");
  });

  test("Outlook gets a fixed 400 px table; everyone else a fluid one capped at 400 px", () => {
    const f = full(resolve({ person }));
    expect(f.html).toMatch(/^<!--\[if mso\]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="400">/);
    expect(f.html).toContain("max-width:400px");
  });
});

describe("where it goes", () => {
  const sig = { html: "<table><tr><td>SIG</td></tr></table>", text: "Chidi Okafor" };

  test("above the composer's quote, after the person's words", () => {
    const body = "<p>Thanks.</p><p></p><p>On 19/10/2026 09:30, Ada Obi wrote:</p><blockquote><p>Can you confirm?</p></blockquote>";
    const out = place(body, sig);
    expect(out.html.indexOf("Thanks.")).toBeLessThan(out.html.indexOf("SIG"));
    expect(out.html.indexOf("SIG")).toBeLessThan(out.html.indexOf("wrote:"));
    expect(out.text).toBe("Thanks.\n\nChidi Okafor\n\nOn 19/10/2026 09:30, Ada Obi wrote:\n\nCan you confirm?");
  });

  test("at the end when there is no quote, or when the person wrote below it", () => {
    expect(place("<p>Hello</p>", sig).html).toMatch(/^<p>Hello<\/p><table[^]*SIG[^]*<\/table>$/);
    const below = "<p>On 19/10/2026 09:30, Ada Obi wrote:</p><blockquote><p>Question?</p></blockquote><p>Answer.</p>";
    expect(place(below, sig).html.indexOf("SIG")).toBeGreaterThan(below.indexOf("Answer."));
  });

  test("the last quote, whole: a quote inside the quote does not end it", () => {
    const body = "<p>Yes.</p><p>On 1, A wrote:</p><blockquote><p>On 2, B wrote:</p><blockquote><p>Deep</p></blockquote><p>Mid</p></blockquote>";
    const q = quoteIn(body);
    expect(body.slice(q.start, q.end)).toBe(body.slice(body.indexOf("<p>On 1")));
    const out = place(body, sig).html;
    expect(out.indexOf("SIG")).toBeLessThan(out.indexOf("On 1, A wrote:"));
  });

  test("a person's own sentence ending in wrote: is not the composer's quote", () => {
    const body = "<p>As Ada wrote:</p><blockquote><p>We are ready.</p></blockquote><p>Agreed.</p>";
    expect(quoteIn(body)).toBeNull();
    expect(place(body, sig).html.endsWith("</table>")).toBe(true);
  });

  test("no signature: the body as it was, with its text part", () => {
    expect(place("<p>Hi</p>", null)).toEqual({ html: "<p>Hi</p>", text: "Hi" });
  });
});

describe("which signature a message carries", () => {
  const from = "chidi@mycityapp.io";
  test("the slim line on a reply, whoever it goes to", () => {
    expect(signatureFor({ in_reply_to: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c11", to_addresses: ["ops@partner.ng"] }, from)).toBe("slim");
  });
  test("the slim line when every recipient is a colleague, Bcc included", () => {
    expect(signatureFor({ to_addresses: ["ada@MyCityApp.io"], cc_addresses: ["tolu@mycityapp.io"] }, from)).toBe("slim");
    expect(signatureFor({ to_addresses: ["ada@mycityapp.io"], bcc_addresses: ["ops@partner.ng"] }, from)).toBe("full");
  });
  test("the full signature on anything else, a message with no recipient yet included", () => {
    expect(signatureFor({ to_addresses: ["ops@partner.ng"] }, from)).toBe("full");
    expect(signatureFor({}, from)).toBe("full");
    expect(signatureFor({ to_addresses: ["ada@mycityapp.io"] }, null)).toBe("full");
  });
  test("a domain is the part after the last @, lower-cased", () => {
    expect(domainOf(" Ada@MyCityApp.IO ")).toBe("mycityapp.io");
    expect(domainOf("not-an-address")).toBe("");
  });
});

describe("the pictures", () => {
  test("drawn at twice their size, the pin until a brand file is uploaded, only the icons in use", async () => {
    const m = resolve({ person, config: { instagram_url: "https://instagram.com/x", google_play_url: "https://play.google.com/x" } });
    const pics = await images.picturesFor(null, m, {});
    expect(pics.band.kind).toBe("pin");
    expect(Object.keys(pics.social)).toEqual(["instagram"]);
    expect(Object.keys(pics.app)).toEqual(["google_play"]);
    const meta = await sharp(pics.app.google_play.buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 48, 48]);
    expect([pics.app.google_play.width, pics.app.google_play.height]).toEqual([24, 24]);
    const data = images.asData(pics);
    expect(data.band).toMatchObject({ kind: "pin", width: 18, height: 18 });
    expect(data.band.src).toMatch(/^data:image\/png;base64,/);
  });
});
