"use strict";
/**
 * Files, documents, templates, spreadsheets, imports and the small services, without a
 * database. The database and binary halves (vault rows, PDF rendering, ffmpeg, the import
 * engine end to end) are in tests/integration/documents-import.test.js.
 */
const sharp = require("sharp");
const ExcelJS = require("exceljs");
const { sniff, zipEntryNames } = require("../../../src/shared/files/sniff");
const policy = require("../../../src/shared/files/mime-policy");
const { displayName, storageKey, contentDisposition } = require("../../../src/shared/files/safe-name");
const { sha256, sameHash } = require("../../../src/shared/files/hash");
const storage = require("../../../src/services/storage/storage.service");
const images = require("../../../src/services/media/image-pipeline");
const scan = require("../../../src/services/media/scan");
const { markdownToHtml, markdownToText } = require("../../../src/shared/documents/markdown");
const { render, parse, variablesOf } = require("../../../src/shared/documents/render");
const { canonicalize, canonicalHash } = require("../../../src/shared/documents/canonical");
const vault = require("../../../src/shared/documents/vault");
const variables = require("../../../src/shared/templates/variables");
const templates = require("../../../src/shared/templates/template-store");
const crypt = require("../../../src/services/secrets/encryption.service");
const qr = require("../../../src/services/qr/qr");
const ics = require("../../../src/services/calendar/ics");
const dnsCheck = require("../../../src/services/mail/deliverability/dns-check");
const mail = require("../../../src/services/mail/system-mail.service");
const { parseCsv, buildCsv } = require("../../../src/shared/spreadsheet/csv");
const { escapeFormula, sheetName } = require("../../../src/shared/spreadsheet/cells");
const dates = require("../../../src/shared/spreadsheet/day-first-cells");
const { buildWorkbook } = require("../../../src/shared/spreadsheet/build");
const { parseUpload } = require("../../../src/shared/spreadsheet/parse");
const mapping = require("../../../src/shared/import/mapping");
const registry = require("../../../src/shared/import/registry");
const engine = require("../../../src/shared/import/engine");
const { z } = require("zod");

/** A minimal ZIP local-file header naming one entry: enough for the sniffer. */
function zipNamed(name) {
  const n = Buffer.from(name);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(n.length, 26);
  return Buffer.concat([h, n, Buffer.from("payload")]);
}

const iso = (brand) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4);
  b.write(brand, 8);
  return b;
};

describe("sniff and the upload policy", () => {
  let jpeg;
  let png;
  beforeAll(async () => {
    jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#014339" } }).jpeg().toBuffer();
    png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#FFDF55" } }).png().toBuffer();
  });

  test("types come from the bytes, never the name", async () => {
    expect(sniff(jpeg, "evil.pdf").mime).toBe("image/jpeg");
    expect(sniff(png, "x.jpg").ext).toBe("png");
    expect(sniff(Buffer.from("%PDF-1.7\n..."), "a.png").kind).toBe("pdf");
    expect(sniff(Buffer.concat([Buffer.from("RIFF0000WEBP"), Buffer.alloc(8)])).ext).toBe("webp");
    expect(sniff(Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(8)])).kind).toBe("audio");
    expect(sniff(Buffer.from("OggS\0\0\0\0")).ext).toBe("ogg");
    expect(sniff(Buffer.from("ID3\x04\0\0\0\0")).ext).toBe("mp3");
    expect(sniff(iso("isom")).mime).toBe("video/mp4");
    expect(sniff(iso("heic")).ext).toBe("heic");
    expect(sniff(iso("avif")).ext).toBe("avif");
    expect(sniff(iso("M4A ")).kind).toBe("audio");
    expect(sniff(zipNamed("word/document.xml")).ext).toBe("docx");
    expect(sniff(zipNamed("xl/workbook.xml")).ext).toBe("xlsx");
    expect(sniff(zipNamed("payload.exe")).kind).toBe("archive");
    expect(zipEntryNames(zipNamed("xl/a.xml"))).toEqual(["xl/a.xml"]);
    expect(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).kind).toBe("legacy_office");
  });

  test("text is text, CSV only by name, and markup is recognised so it can be refused", () => {
    expect(sniff(Buffer.from("a,b\n1,2\n"), "staff.csv").ext).toBe("csv");
    expect(sniff(Buffer.from("a,b\n1,2\n"), "notes.txt").ext).toBe("txt");
    expect(sniff(Buffer.from("\uFEFF<!DOCTYPE html><html>"), "cv.pdf").kind).toBe("markup");
    expect(sniff(Buffer.from('<?xml version="1.0"?><svg xmlns="x">'), "logo.png").ext).toBe("svg");
    expect(sniff(Buffer.from("hello <script>alert(1)</script>"), "a.txt").kind).toBe("markup");
    expect(sniff(Buffer.from([0, 1, 2, 3, 0, 0, 9])).kind).toBe("unknown");
  });

  test("each purpose accepts its own list and nothing that runs", () => {
    expect(policy.assertAllowed("document", sniff(Buffer.from("%PDF-1.4")))).toBeTruthy();
    expect(() => policy.assertAllowed("avatar", sniff(Buffer.from("%PDF-1.4")))).toThrow(/Accepted: JPG, PNG, WEBP, HEIC/);
    expect(() => policy.assertAllowed("attachment", sniff(Buffer.from("<svg></svg>"), "a.svg"))).toThrow(/not accepted/);
    expect(() => policy.assertAllowed("import_sheet", sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))).toThrow(/Save it as .docx or .xlsx/);
    expect(policy.isAllowed("import_sheet", sniff(Buffer.from("a,b\n"), "x.csv"))).toBe(true);
    expect(() => policy.assertAllowed("nope", sniff(Buffer.from("%PDF-")))).toThrow(/unknown purpose/);
  });
});

describe("names, keys and hashes", () => {
  test("display names lose paths, controls and bidi tricks, and gain the real extension", () => {
    expect(displayName("C:\\Users\\ada\\cv.pdf", "pdf")).toBe("cv.pdf");
    expect(displayName("../../etc/passwd")).toBe("passwd");
    expect(displayName("cv\u202Efdp.exe", "pdf")).toBe("cvfdp.pdf");
    expect(displayName("IMG_0001.HEIC", "jpg")).toBe("IMG_0001.jpg");
    expect(displayName("", "pdf")).toBe("file.pdf");
    expect(displayName("x".repeat(400), "pdf")).toHaveLength(180);
  });

  test("storage keys follow the media layout", () => {
    expect(storageKey("vault", "pdf", { date: "2026-10-14" })).toMatch(/^vault\/2026\/10\/[0-9a-f-]{36}\.pdf$/);
    expect(storageKey("avatars", "webp")).toMatch(/^avatars\/[0-9a-f-]{36}\.webp$/);
    expect(() => storageKey("etc", "pdf")).toThrow(/unknown area/);
    expect(() => storageKey("vault", "p/df")).toThrow(/bad extension/);
  });

  test("content disposition keeps any name and an ASCII fallback", () => {
    expect(contentDisposition("Chíọmá's CV.pdf")).toBe(`attachment; filename="Chioma's CV.pdf"; filename*=UTF-8''Ch%C3%AD%E1%BB%8Dm%C3%A1's%20CV.pdf`);
    expect(contentDisposition("a.pdf", { inline: true })).toMatch(/^inline;/);
  });

  test("hashes", () => {
    const h = sha256(Buffer.from("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sameHash(h, h.toUpperCase())).toBe(true);
    expect(sameHash(h, "00")).toBe(false);
  });
});

describe("storage", () => {
  test("atomic write, read, range, move and remove inside MEDIA_ROOT", async () => {
    const key = storageKey("vault", "txt");
    await storage.put(key, Buffer.from("hello world"));
    await expect(storage.put(key, Buffer.from("again"))).rejects.toThrow(/already exists/);
    expect((await storage.get(key)).toString()).toBe("hello world");
    const { stream, size } = await storage.open(key, { start: 6, end: 10 });
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    expect([Buffer.concat(chunks).toString(), size]).toEqual(["world", 11]);
    const to = storageKey("vault", "txt");
    await storage.move(key, to);
    expect(await storage.exists(key)).toBe(false);
    await storage.remove(to);
    expect(await storage.stat(to)).toBeNull();
  });

  test("keys cannot leave the store, and only binary goes in", async () => {
    for (const bad of ["../x", "vault/../../etc/passwd", "/etc/passwd", "vault\\x", "vault//x", "Vault/x", "vault/x\0"]) {
      expect(() => storage.absPath(bad)).toThrow(/Invalid storage key/);
    }
    await expect(storage.put("vault/x.txt", "a string")).rejects.toThrow(/Only binary/);
    expect((await storage.put(storageKey("vault", "bin"), new Uint8Array([1, 2, 3]))).bytes).toBe(3);
    expect((await storage.health()).status).toBe("up");
  });
});

describe("image pipeline", () => {
  test("photo: upright, capped, metadata gone, AVIF and WebP variants", async () => {
    const src = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#0E7C6B" } })
      .withExif({ IFD0: { Copyright: "secret", Make: "Phone" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(src).metadata()).exif).toBeTruthy();
    const out = await images.processImage(src, sniff(src), "photo");
    expect(out.master.type.ext).toBe("jpg");
    expect([out.master.width, out.master.height]).toEqual([2400, 1600]);
    expect((await sharp(out.master.buffer).metadata()).exif).toBeUndefined();
    expect(out.variants.map((v) => v.kind).sort()).toEqual(["avif-1600", "avif-320", "avif-640", "avif-960", "webp-1600", "webp-320", "webp-640", "webp-960"]);
  });

  test("avatar: square; document: no tonal change and no upscaling", async () => {
    const src = await sharp({ create: { width: 900, height: 400, channels: 3, background: "#FFDF55" } }).png().toBuffer();
    const avatar = await images.processImage(src, sniff(src), "avatar");
    expect([avatar.master.width, avatar.master.height]).toEqual([512, 512]);
    expect(avatar.variants.map((v) => v.kind)).toContain("webp-96");
    const doc = await images.processImage(src, sniff(src), "document");
    expect(doc.master.type.ext).toBe("png");
    expect(doc.master.width).toBe(900);
    const { data } = await sharp(doc.master.buffer).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0xff, 0xdf, 0x55]);
    expect(images.variantKinds("avatar")).toEqual(["avif-96", "webp-96", "avif-192", "webp-192", "avif-384", "webp-384"]);
  });

  test("a damaged image is a readable error", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]);
    await expect(images.processImage(broken, sniff(broken), "photo")).rejects.toMatchObject({ code: "IMAGE_UNREADABLE" });
  });
});

describe("virus scan replies", () => {
  test("clean, infected, and anything else is an error, never a pass", () => {
    expect(scan.parseReply("stream: OK\0")).toEqual({ clean: true });
    expect(scan.parseReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
    expect(() => scan.parseReply("INSTREAM size limit exceeded. ERROR")).toThrow(/clamd answered/);
  });
});

describe("markdown and the template language", () => {
  test("markdown is markdown only: no raw HTML, no script links, no remote images", () => {
    const html = markdownToHtml('**Hi** <img src=x onerror=alert(1)> [ok](https://mycityapp.io) [bad](javascript:alert(1)) ![p](https://evil/x.png)');
    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("&lt;img");
    expect(html).toContain('<a href="https://mycityapp.io" rel="noopener noreferrer">ok</a>');
    expect(html).not.toMatch(/javascript:|<img/);
    expect(markdownToText("# Title\n**bold** [link](https://x.y)")).toBe("Title\nbold link (https://x.y)");
  });

  test("values are escaped; house formats; if, else, each", () => {
    const out = render(
      "{{ name }}|{{ money amt }}|{{ date d }}|{{ longdate d }}|{{#if flag}}Y{{else}}N{{/if}}|{{#each items}}{{ @number }}.{{ label }}={{ money amount }};{{/each}}",
      { name: "<Ada & Co>", amt: "1250000.5", d: "2026-10-09", flag: [], items: [{ label: "Basic", amount: "100.00" }, { label: "Transport", amount: "25.5" }] },
    );
    expect(out).toBe("&lt;Ada &amp; Co&gt;|₦1,250,000.50|09/10/2026|9 October 2026|N|1.Basic=₦100.00;2.Transport=₦25.50;");
    expect(render("<main>{{> body}}</main>", {}, { body: "<p>x</p>" })).toBe("<main><p>x</p></main>");
  });

  test("a broken template fails at parse time with its line", () => {
    expect(() => parse("a\n{{#if x}}open")).toThrow(/never closed \(line 2\)/);
    expect(() => parse("{{/each}}")).toThrow(/does not close anything/);
    expect(() => parse("{{ upper name }}")).toThrow(/not a formatter/);
    expect(() => parse("{{ a.__proto__.b }}")).toThrow(/not allowed/);
    expect(() => parse("{{#if a}}{{else}}{{else}}{{/if}}")).toThrow(/else/);
    expect([...variablesOf(parse("{{ a.b }}{{#each xs}}{{ c }}{{/each}}"))]).toEqual(["a.b", "xs", "~c"]);
    expect(() => parse("{{ constructor }}")).toThrow(/not allowed/);
    expect(render("{{ toString }}{{ hasOwnProperty }}", {})).toBe("");
  });

  test("variables: undeclared names refused, data checked before anything happens", () => {
    variables.defineVariables("document", "unit-letter", z.object({ employee: z.object({ first_name: z.string() }), amount: z.string() }));
    expect(variables.undeclared("{{ employee.first_name }} {{ org.name }} {{ salry }}", variables.schemaOf("document", "unit-letter"))).toEqual(["salry"]);
    expect(() => variables.assertTemplate("document", "unit-letter", "{{ salry }}")).toThrow(/"salry"/);
    expect(() => variables.parseData("document", "unit-letter", { employee: {} })).toThrow(/employee.first_name, amount/);
  });

  test("templates: front matter, the shipped letterhead and mail layout", () => {
    expect(templates.frontMatter("---\nsubject: Hi {{ name }}\ntitle: T\n---\n<p>x</p>")).toEqual({ meta: { subject: "Hi {{ name }}", title: "T" }, body: "<p>x</p>" });
    expect(templates.layout("document").body).toContain("{{> body}}");
    expect(templates.layout("email").body).toContain("{{> body}}");
    expect(() => parse(templates.layout("document").body)).not.toThrow();
    expect(() => parse(templates.layout("email").body)).not.toThrow();
  });

  test("canonical form: one spelling per value", () => {
    expect(canonicalize({ b: 1, a: "e\u0301", c: undefined, d: [true, null] })).toBe('{"a":"é","b":1,"d":[true,null]}');
    expect(canonicalHash({ x: "1", y: "2" })).toBe(canonicalHash({ y: "2", x: "1" }));
    expect(() => canonicalize({ amount: 12.5 })).toThrow(/as strings/);
    expect(canonicalize({ at: new Date("2026-10-14T10:00:00Z") })).toBe('{"at":"2026-10-14T10:00:00.000Z"}');
  });
});

describe("documents: serving helpers", () => {
  test("byte ranges", () => {
    expect(vault.parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(vault.parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(vault.parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(vault.parseRange("bytes=2000-", 1000)).toBe("unsatisfiable");
    expect(vault.parseRange("bytes=0-1,5-9", 1000)).toBeNull();
  });
});

describe("small services", () => {
  test("encryption: round trip, bound to its record, tamper-evident", () => {
    const sealed = crypt.encrypt("imap-pass", { aad: "mailbox:u1" });
    expect(sealed).toMatch(/^v1:/);
    expect(crypt.decrypt(sealed, { aad: "mailbox:u1" })).toBe("imap-pass");
    expect(() => crypt.decrypt(sealed, { aad: "mailbox:u2" })).toThrow(/altered, or belongs to another/);
    const tampered = `v1:${Buffer.from(Buffer.from(sealed.slice(3), "base64").map((b, i) => (i === 30 ? b ^ 1 : b))).toString("base64")}`;
    expect(() => crypt.decrypt(tampered, { aad: "mailbox:u1" })).toThrow();
    expect(() => crypt.decrypt("plain")).toThrow(/not a sealed value/);
    expect(crypt.encrypt("x")).not.toBe(crypt.encrypt("x"));
    expect(crypt.decryptJson(crypt.encryptJson({ a: 1 }))).toEqual({ a: 1 });
    expect(crypt.hint("abcdefgh")).toBe("••••••••efgh");
  });

  test("QR codes only for our own public links", async () => {
    expect(await qr.svg("http://localhost:5174/verify/OFF-0001")).toMatch(/^<svg/);
    expect(await qr.dataUrl("http://localhost:5174/verify/OFF-0001")).toMatch(/^data:image\/png;base64,/);
    expect(() => qr.svg("https://evil.example/verify")).toThrow(/only/);
  });

  test("calendar invites: UTC, escaped, folded, cancellable", () => {
    const text = ics.event({
      uid: "interview-1@mycityapp.io",
      start: "2026-10-20T10:00:00+01:00",
      end: "2026-10-20T11:00:00+01:00",
      stamp: "2026-10-14T09:00:00Z",
      summary: "Interview; Partnerships, Associate",
      description: `Panel: ${"x".repeat(120)}\nBring ID`,
      organizer: { name: "MyCity Recruitment", email: "recruitment@mycityapp.io" },
      attendees: [{ name: "Ada Obi", email: "ada@example.com" }],
    });
    expect(text).toContain("DTSTART:20261020T090000Z\r\n");
    expect(text).toContain("SUMMARY:Interview\\; Partnerships\\, Associate\r\n");
    expect(text.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(text).toContain("\r\n ");
    expect(ics.event({ uid: "a@b", start: "2026-10-20T10:00:00Z", end: "2026-10-20T11:00:00Z", summary: "x", method: "CANCEL" })).toContain("STATUS:CANCELLED");
    expect(() => ics.event({ uid: "a@b", start: "2026-10-20T10:00:00Z", end: "2026-10-20T09:00:00Z", summary: "x" })).toThrow(/end must be after/);
  });

  test("deliverability judgements", () => {
    expect(dnsCheck.judgeSpf(["v=spf1 include:_spf.mx.example -all"]).ok).toBe(true);
    expect(dnsCheck.judgeSpf(["v=spf1 +all"]).problems[0]).toMatch(/\+all/);
    expect(dnsCheck.judgeSpf(["v=spf1 -all", "v=spf1 ~all"]).problems[0]).toMatch(/More than one/);
    expect(dnsCheck.judgeSpf([]).ok).toBe(false);
    expect(dnsCheck.judgeDkim(["v=DKIM1; k=rsa; p=MIIBIjAN"]).ok).toBe(true);
    expect(dnsCheck.judgeDkim(["v=DKIM1; p="]).problems[0]).toMatch(/revoked/);
    expect(dnsCheck.judgeDmarc(["v=DMARC1; p=none; rua=mailto:x@y"]).warnings[0]).toMatch(/monitors/);
    expect(dnsCheck.judgeDmarc(["v=DMARC1; p=reject"]).ok).toBe(true);
    expect(dnsCheck.domainOf("MyCity App <no-reply@mycityapp.io>")).toBe("mycityapp.io");
  });

  test("mail text part", () => {
    expect(mail.textOf('<p>Hi <a href="https://x.y">there</a></p><br><style>p{}</style>&amp;')).toBe("Hi there (https://x.y)\n\n&");
  });
});

describe("spreadsheets", () => {
  test("CSV: quotes, line breaks, semicolons, a byte-order mark", () => {
    expect(parseCsv('\uFEFFname,note\r\n"Obi, Ada","said ""hi""\nthen left"\r\n,\r\n')).toEqual([["name", "note"], ["Obi, Ada", 'said "hi"\nthen left']]);
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    const out = buildCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: "=SUM(A1)", b: "x,y" }]).toString("utf8");
    expect(out).toBe("\uFEFFA,B\r\n'=SUM(A1),\"x,y\"\r\n");
  });

  test("cells: formula injection escaped, sheet names Excel accepts", () => {
    expect(escapeFormula("+2348031234567")).toBe("'+2348031234567");
    expect(escapeFormula("@cmd")).toBe("'@cmd");
    expect(escapeFormula("Ada")).toBe("Ada");
    const taken = new Set();
    expect(sheetName("Staff: Oct/Nov [draft]", taken)).toBe("Staff Oct Nov draft");
    expect(sheetName("Staff: Oct/Nov [draft]", taken)).toBe("Staff Oct Nov draft (2)");
  });

  test("dates: Excel serials, day-first text, impossible dates refused", () => {
    expect(dates.fromSerial(45000)).toBe("2023-03-15");
    expect(dates.toSerial("2023-03-15")).toBe(45000);
    expect(dates.readDate("03/07/1991")).toEqual({ date: "1991-07-03", error: null });
    expect(dates.readDate("13/31/1991").error).toMatch(/day-first/);
    expect(dates.readDate("31/02/2026").error).toBeTruthy();
    expect(dates.readDate(new Date(Date.UTC(2026, 9, 14))).date).toBe("2026-10-14");
    expect(dates.readDate(45000).date).toBe("2023-03-15");
  });

  test("an export reads back: money, dates, enums, text; the Reference sheet is skipped", async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: "Employees",
          columns: [
            { key: "name", label: "Name" },
            { key: "start", label: "Start Date", type: "date" },
            { key: "pay", label: "Gross Monthly", type: "money" },
            { key: "pattern", label: "Work Pattern", type: "enum", options: ["On-site", "Hybrid", "Remote"] },
          ],
          rows: [{ name: "=cmd|calc", start: "2026-11-03", pay: "450000.50", pattern: "Hybrid" }],
        },
      ],
      reference: [{ column: "Start Date", required: true, rule: "Day-first", example: "03/11/2026" }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Employees");
    expect(ws.getCell("C2").numFmt).toContain("₦");
    expect(ws.getCell("B2").numFmt).toBe("dd/mm/yyyy");
    expect(ws.getCell("D2").dataValidation.type).toBe("list");
    expect(wb.getWorksheet("Reference")).toBeTruthy();
    const book = await parseUpload({ buffer, filename: "export.xlsx" });
    expect(book.sheets.map((s) => s.name)).toEqual(["Employees"]);
    const [header, row] = book.sheets[0].rows;
    expect(header).toEqual(["Name", "Start Date", "Gross Monthly", "Work Pattern"]);
    expect(row[0]).toBe("'=cmd|calc");
    expect(dates.readDate(row[1]).date).toBe("2026-11-03");
    expect(row[2]).toBe(450000.5);
  });

  test("uploads that are not sheets are refused", async () => {
    await expect(parseUpload({ buffer: Buffer.from("%PDF-1.4"), filename: "x.pdf" })).rejects.toMatchObject({ code: "SHEET_TYPE" });
    await expect(parseUpload({ buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), filename: "x.xls" })).rejects.toMatchObject({ code: "SHEET_OLD_FORMAT" });
    const csv = await parseUpload({ buffer: Buffer.from("Name,Email\nAda,ada@x.io\n"), filename: "s.csv" });
    expect(csv.sheets[0].rows).toEqual([["Name", "Email"], ["Ada", "ada@x.io"]]);
  });
});

describe("import mapping and rows", () => {
  const FIELDS = [
    { key: "staff_number", label: "Staff ID", aliases: ["staff no", "employee id"] },
    { key: "first_name", label: "First Name", required: true },
    { key: "last_name", label: "Last Name", required: true },
    { key: "work_email", label: "Work Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone" },
    { key: "start_date", label: "Start Date", type: "date" },
    { key: "gross", label: "Gross Monthly", type: "money" },
    { key: "pattern", label: "Work Pattern", type: "enum", options: [{ value: "on_site", label: "On-site" }, { value: "remote", label: "Remote" }] },
    { key: "manager", label: "Line Manager", type: "reference", ref: "test_person", pass: 2 },
  ];

  test("the header is found under a title, mapped by aliases, remembered by signature", () => {
    const grid = [["MyCity Staff List", null], ["October 2026"], [], ["Staff No.", "First Name", "Last Name", "E-mail", "Notes"], ["1", "Ada", "Obi"]];
    expect(mapping.detectHeaderRow(grid, FIELDS)).toBe(3);
    const m = mapping.autoMap(grid[3], FIELDS);
    expect(m.columns.map((c) => c.field)).toEqual(["staff_number", "first_name", "last_name", null, null]);
    expect(mapping.headerSignature(["A", "b "])).toBe(mapping.headerSignature(["B", "a"]));
    expect(mapping.problemsOf(m, FIELDS)).toEqual([]);
    expect(mapping.problemsOf({ columns: [{ header: "X", field: "first_name" }, { header: "Y", field: "first_name" }] }, FIELDS)).toEqual([
      '"Y" and "X" are both mapped to First Name',
      "No column is mapped to Last Name, which is required",
    ]);
    const moved = mapping.applyProfile(m, ["Notes", "Staff no", "Last Name", "First Name"]);
    expect(moved.columns.map((c) => c.field)).toEqual([null, "staff_number", "last_name", "first_name"]);
  });

  test("coercion: money, phone, email, enum, dates, booleans, required", () => {
    const f = (type, extra = {}) => ({ key: "x", label: "X", type, ...extra });
    expect(engine.coerce(f("money"), "₦1,250,000")).toEqual({ value: "1250000.00", error: null });
    expect(engine.coerce(f("money"), 450000.5)).toEqual({ value: "450000.50", error: null });
    expect(engine.coerce(f("money"), "abc").error).toMatch(/amount/);
    expect(engine.coerce(f("phone"), "0803 123 4567").value).toBe("+2348031234567");
    expect(engine.coerce(f("phone"), 8031234567).value).toBe("+2348031234567");
    expect(engine.coerce(f("email"), " Ada@MyCity.io ").value).toBe("ada@mycity.io");
    expect(engine.coerce(FIELDS[7], "on site").value).toBe("on_site");
    expect(engine.coerce(FIELDS[7], "office").error).toMatch(/On-site, Remote/);
    expect(engine.coerce(f("date"), "03/07/1991").value).toBe("1991-07-03");
    expect(engine.coerce(f("date"), "13/31/1991").error).toBeTruthy();
    expect(engine.coerce(f("boolean"), "Yes").value).toBe(true);
    expect(engine.coerce(f("int"), "1,200").value).toBe(1200);
    expect(engine.coerce(f("text", { required: true }), "  ").error).toBe("is required");
  });

  test("rows: coerced, validated against the contract schema, duplicates marked", () => {
    const imp = {
      key: "unit",
      fields: FIELDS,
      matchKeys: ["staff_number", "work_email"],
      schema: z.object({ first_name: z.string().min(2) }).passthrough(),
    };
    const grid = [
      ["Staff ID", "First Name", "Last Name", "Work Email", "Gross Monthly"],
      ["1", "Ada", "Obi", "ada@x.io", "100"],
      [null, null, null, null, null],
      ["2", "B", "Ade", "b@x.io", "x"],
      ["3", "Chidi", "Eze", "ADA@x.io", "5"],
    ];
    const m = mapping.autoMap(grid[0], FIELDS);
    const rows = engine.buildRows(imp, grid, 0, m);
    engine.markDuplicates(imp, rows);
    expect(rows.map((r) => [r.row_number, r.status])).toEqual([[2, "ok"], [4, "error"], [5, "duplicate"]]);
    expect(rows[1].problems.map((p) => p.message)).toEqual(["Gross Monthly should be an amount, like 250000.00"]);
    expect(rows[2].problems[0].message).toBe("Same Work Email as row 2");
    expect(rows[0].values).toEqual({ staff_number: "1", first_name: "Ada", last_name: "Obi", work_email: "ada@x.io", gross: "100.00" });
    expect(rows[0].raw["Work Email"]).toBe("ada@x.io");
  });

  test("an importer that cannot work is refused when it is defined", () => {
    const base = {
      key: "unit_bad",
      label: "Bad",
      permission: ["people", "create"],
      entity: "test_person",
      schema: z.object({}),
      matchKeys: ["a"],
      fields: [{ key: "a", label: "A" }],
      find() {},
      write() {},
      archive() {},
      restore() {},
    };
    expect(() => registry.defineImporter({ ...base, permission: ["hr", "create"] })).toThrow(/permission/);
    expect(() => registry.defineImporter({ ...base, matchKeys: ["zz"] })).toThrow(/matchKeys/);
    expect(() => registry.defineImporter({ ...base, fields: [{ key: "a", label: "A", type: "reference", ref: "x", pass: 2 }], resolve() {} })).toThrow(/link/);
    expect(() => registry.defineImporter({ ...base, write: undefined })).toThrow(/write/);
  });
});
