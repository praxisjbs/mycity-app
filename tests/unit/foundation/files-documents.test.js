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
const { markdownToHtml, markdownToText, stripTrailingAcceptanceBlock } = require("../../../src/shared/documents/markdown");
const { render, parse, variablesOf } = require("../../../src/shared/documents/render");
const canonical = require("../../../src/shared/documents/canonical");
const vault = require("../../../src/shared/documents/vault");
const variables = require("../../../src/shared/templates/variables");
const templates = require("../../../src/shared/templates/template-store");
const crypt = require("../../../src/services/secrets/encryption.service");
const qr = require("../../../src/services/qr/qr");
const ics = require("../../../src/services/calendar/ics");
const dnsCheck = require("../../../src/services/mail/deliverability/dns-check");
const routeCheck = require("../../../src/services/mail/deliverability/route-check");
const { parseDmarc } = require("../../../src/services/mail/deliverability/dmarc");
const { toRow, regression } = require("../../../src/services/mail/deliverability/evaluate");
const mail = require("../../../src/services/mail/system-mail.service");
const { parseCsv, parseCsvGrid, buildCsv } = require("../../../src/shared/spreadsheet/csv");
const { escapeFormula, sheetName, serialDate, exportFilename, cellRawValue } = require("../../../src/shared/spreadsheet/cells");
const { workbookContext } = require("../../../src/shared/spreadsheet/context");
const dates = require("../../../src/shared/spreadsheet/day-first-cells");
const { buildWorkbook } = require("../../../src/shared/spreadsheet/build");
const { parseUpload, readSheets } = require("../../../src/shared/spreadsheet/parse");
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

  test("markdown blocks: headings, lists, tables, rules; a drafted signature block is dropped", () => {
    expect(markdownToHtml("# Offer\n\nDear *Ada*,\n\n- Basic: `450,000`\n- Leave\n\n1. one\n2. two\n\n| Item | Amount |\n|---|---|\n| Basic | 1 |\n\n---\nend")).toBe(
      "<h1>Offer</h1>\n<p>Dear <em>Ada</em>,</p>\n<ul><li>Basic: <code>450,000</code></li><li>Leave</li></ul>\n<ol><li>one</li><li>two</li></ol>\n" +
        "<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Basic</td><td>1</td></tr></table>\n<hr />\n<p>end</p>",
    );
    expect(markdownToHtml("| <b>x</b> |\n|---|\n| y |")).toContain("<th>&lt;b&gt;x&lt;/b&gt;</th>");
    expect(stripTrailingAcceptanceBlock("Body.\nTo accept, please sign below.\n\n**Accepted and Agreed**\n______\nDate:")).toBe("Body.\nTo accept, please sign below.");
    expect(stripTrailingAcceptanceBlock("No block here.")).toBe("No block here.");
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

  test("canonical signature payloads: fixed key order, money as strings, versioned, Map lookup", () => {
    const contract = {
      number: "CON-0001", date: "2026-10-14", employee: "Ada Obi", job_title: "Analyst",
      contract_type: "permanent", start_date: "2026-11-01", gross_salary: "450000",
      probation_months: 3, clauses: [{ heading: "Duties", body: "not hashed" }, "Leave"],
    };
    const payload = canonical.canonical("EMPLOYMENT_CONTRACT", contract);
    expect(Object.keys(payload)).toEqual(["v", "type", "number", "date", "employee", "job_title", "contract_type",
      "start_date", "end_date", "currency", "gross_salary", "probation_months", "clauses"]);
    expect(payload).toMatchObject({ currency: "NGN", gross_salary: "450000.00", clauses: ["Duties", "Leave"] });
    // Golden: changing this builder changes this digest, and every signed contract would read as amended.
    expect(canonical.hash("EMPLOYMENT_CONTRACT", contract)).toBe("d163b22321b5fa17288458a335887564ab34d732fe6d9d4c8cf3dabcc29ab231");
    // "450000" and "450000.004" are the same figure on the page, so the same hash.
    expect(canonical.hash("EMPLOYMENT_CONTRACT", { ...contract, gross_salary: "450000.004" })).toBe(canonical.hash("EMPLOYMENT_CONTRACT", contract));
    expect(canonical.build("EMPLOYMENT_CONTRACT", contract)).toMatchObject({ version: 1, hash: canonical.hash("EMPLOYMENT_CONTRACT", contract) });
    expect(canonical.diff(payload, canonical.canonical("EMPLOYMENT_CONTRACT", { ...contract, gross_salary: "500000" })))
      .toEqual([{ field: "gross_salary", before: "450000.00", after: "500000.00" }]);
    expect(() => canonical.hash("constructor", {})).toThrow(expect.objectContaining({ code: "NO_CANONICAL_PAYLOAD" }));
    expect(() => canonical.hash("EMPLOYMENT_CONTRACT", contract, 2)).toThrow(expect.objectContaining({ code: "UNKNOWN_PAYLOAD_VERSION" }));
    expect(canonical.isSignable("EMPLOYMENT_CONTRACT")).toBe(true);
    expect(canonical.isSignable("toString")).toBe(false);
  });

  test("a policy version's payload is pinned, and its rules hash the same in any key order", () => {
    const version = {
      number: "POL-0001",
      version: 3,
      title: "Attendance Policy",
      effective_from: "2026-11-01",
      applies_to: { everyone: false, department_ids: ["b", "a"], work_patterns: ["remote"], employee_ids: [] },
      body_markdown: "",
      rules: { home_radius_m: 150, grace_minutes: 5, late_rule: { on: true, count: 3 } },
    };
    expect(canonical.hash("POLICY_VERSION", version)).toBe("61d70174a1f769eda15540811f3c12668f973fa8c0e1a3e985e9b8318c0e512e");
    const reordered = { ...version, rules: { late_rule: { count: 3, on: true }, grace_minutes: 5, home_radius_m: 150 } };
    expect(canonical.hash("POLICY_VERSION", reordered)).toBe(canonical.hash("POLICY_VERSION", version));
    expect(canonical.hash("POLICY_VERSION", { ...version, rules: { ...version.rules, grace_minutes: 10 } }))
      .not.toBe(canonical.hash("POLICY_VERSION", version));
  });
});

describe("document types, served types, derived file names", () => {
  const types = require("../../../src/shared/documents/types");
  const mimePolicy = require("../../../src/shared/files/mime-policy");
  const { variantKey } = require("../../../src/shared/files/variant-key");

  test("a doc type is registered once, with a reader module and a signing ceiling", () => {
    const spec = types.defineDocumentType("unit_offer_letter", { label: "Offer letter", module: "recruitment", sensitivity: "personal", signable: true });
    expect(spec).toMatchObject({ module: "recruitment", sensitivity: "personal", signable: true, wet: false });
    expect(types.defineDocumentType("unit_offer_letter", { label: "Offer letter", module: "recruitment", sensitivity: "personal", signable: true })).toBe(spec);
    expect(() => types.defineDocumentType("unit_offer_letter", { label: "Offer", module: "settings" })).toThrow(/already defined/);
    expect(() => types.defineDocumentType("unit_x", { label: "X", wet: true })).toThrow(/needs signable/);
    expect(types.signatureCeiling("unit_offer_letter")).toEqual({ signable: true, wet: false });
    expect(types.signatureCeiling("constructor")).toEqual({ signable: false, wet: false });
    expect(() => types.assertDocType("unit_ofer_letter")).toThrow(expect.objectContaining({ code: "UNKNOWN_DOC_TYPE" }));
    expect(types.typeOf("import_source")).toMatchObject({ sensitivity: "restricted", module: null });
  });

  test("an export type is kept a day and never locked; reserving one needs a transaction, an export type and a file type", async () => {
    const exportFiles = require("../../../src/shared/documents/exports");
    const { DEPTH } = require("../../../src/shared/db/tx");
    types.defineDocumentType("unit_export", { label: "Unit export", module: "settings", sensitivity: "restricted", export: true });
    expect(types.isExport("unit_export")).toBe(true);
    expect(types.isExport("unit_offer_letter")).toBe(false);
    expect(types.isExport("constructor")).toBe(false);
    expect(types.exportTypes()).toContain("unit_export");
    expect(types.exportTypes()).not.toContain("unit_offer_letter");
    expect(exportFiles.KEPT_HOURS).toBe(24);

    const rows = [];
    const query = async (sql, params) => {
      const cols = /\(([^)]*)\) VALUES/.exec(sql)[1].split(", ");
      rows.push(Object.fromEntries(cols.map((c, i) => [c, params[i]])));
      return { rows: [rows[rows.length - 1]] };
    };
    const client = { [DEPTH]: 1, query };
    const asked = { doc_type: "unit_export", entity: { type: "unit_export", id: "e1" }, file_name: "unit-log-2026-10-19.xlsx", actor: { user_id: "u1" } };
    await expect(exportFiles.reserve({ query }, asked)).rejects.toThrow(/inside atomically/);
    await expect(exportFiles.reserve(client, { ...asked, doc_type: "unit_offer_letter" })).rejects.toThrow(/export: true/);
    await expect(exportFiles.reserve(client, { ...asked, file_name: "unit-log.exe" })).rejects.toThrow(/no file type/);
    await expect(exportFiles.reserve(client, { ...asked, actor: null })).rejects.toThrow(/person asking/);
    expect(rows).toEqual([]);

    const doc = await exportFiles.reserve(client, asked);
    expect(doc).toMatchObject({
      doc_type: "unit_export",
      original_name: "unit-log-2026-10-19.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: 0,
      sensitivity: "restricted",
      source: "generated",
      scan_status: "skipped",
      render_status: "pending",
      entity_type: "unit_export",
      entity_id: "e1",
      uploaded_by: "u1",
    });
    expect(doc.storage_key).toMatch(/^generated\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.xlsx$/);
    // What the screen reads while it waits; a file stored whole before exports were reserved is done.
    expect(exportFiles.present(doc)).toEqual({ document_id: doc.document_id, file_name: "unit-log-2026-10-19.xlsx", status: "pending" });
    expect(exportFiles.present({ ...doc, render_status: null }).status).toBe("done");
  });

  test("only allow-listed types are served as themselves", () => {
    expect(mimePolicy.servedType("application/pdf")).toBe("application/pdf");
    expect(mimePolicy.servedType("text/html")).toBe("application/octet-stream");
    expect(mimePolicy.servedType("image/svg+xml")).toBe("application/octet-stream");
    expect(mimePolicy.servedType(undefined)).toBe("application/octet-stream");
  });

  test("derived files have one name, built one way", () => {
    const id = "0b9a6f3e-2c1d-4e5f-8a7b-9c0d1e2f3a4b";
    expect(variantKey(id, "webp-640", "webp")).toBe(`derived/${id}/webp-640.webp`);
    expect(variantKey(id, "voice", "ogg")).toBe(`derived/${id}/voice.ogg`);
    expect(() => variantKey("../etc", "x", "jpg")).toThrow();
    expect(() => variantKey(id, "../x", "jpg")).toThrow();
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
  test("encryption: round trip, fresh IV, tamper-evident", () => {
    const sealed = crypt.encrypt("imap-pass");
    expect(crypt.decrypt(sealed)).toBe("imap-pass");
    expect(crypt.encrypt("x")).not.toBe(crypt.encrypt("x"));
    const tampered = Buffer.from(Buffer.from(sealed, "base64").map((b, i) => (i === 30 ? b ^ 1 : b))).toString("base64");
    expect(() => crypt.decrypt(tampered)).toThrow();
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

  test("deliverability: domains, DMARC reading, relay suggestions", () => {
    expect(dnsCheck.domainOf("smtp.mail.mycity.com.ng")).toBe("mycity.com.ng");
    expect(dnsCheck.domainOf("mail.mycityapp.io")).toBe("mycityapp.io");
    expect(dnsCheck.domainOf("localhost")).toBeNull();
    expect(dnsCheck.senderDomain("MyCity App <no-reply@mycityapp.io>")).toBe("mycityapp.io");
    expect(dnsCheck.spfSuggestions("mycityapp.io", "smtp.sendgrid.net")).toEqual(["v=spf1 include:sendgrid.net ~all"]);
    expect(dnsCheck.spfSuggestions("mycityapp.io", "mail.hostbox.com.ng")).toEqual(["v=spf1 mx include:hostbox.com.ng ~all"]);
    expect(dnsCheck.spfSuggestions("mycityapp.io", null)).toEqual(["v=spf1 mx ~all"]);
    const weak = parseDmarc("v=DMARC1; p=none; rua=mailto:x@y");
    expect(weak).toMatchObject({ ok: true, policy: "none", rua: "mailto:x@y", dkim_alignment: "relaxed" });
    expect(weak.reading).toMatch(/monitoring only/);
    expect(parseDmarc("v=DMARC1; p=reject; adkim=s").dkim_alignment).toBe("strict");
    expect(parseDmarc("p=reject").reading).toMatch(/not a DMARC record/);
    expect(toRow("x.ng", "SPF", { ok: false, suggest: ["v=spf1 mx ~all"] })).toMatchObject({ verdict: "FAIL", suggestion: "v=spf1 mx ~all" });
    expect(regression({ verdict: "PASS" }, { verdict: "FAIL" })).toBe(true);
  });

  test("deliverability: route trap needs co-hosting AND a remote MX", async () => {
    const { STATES } = routeCheck;
    expect(routeCheck.classify({ relayIps: ["1.1.1.1"], recipientIps: ["2.2.2.2"], mxIps: ["3.3.3.3"] }).state).toBe(STATES.OK);
    expect(routeCheck.classify({ relayIps: ["1.1.1.1"], recipientIps: ["1.1.1.1"], mxIps: ["1.1.1.1"] }).state).toBe(STATES.OK);
    expect(routeCheck.classify({ relayIps: ["1.1.1.1"], recipientIps: ["1.1.1.1"], mxIps: ["9.9.9.9"] }).state).toBe(STATES.LOCAL_TRAP);
    expect(routeCheck.classify({ relayIps: [], recipientIps: ["1.1.1.1"], mxIps: [] }).state).toBe(STATES.UNKNOWN);
    expect(routeCheck.classify({ relayIps: ["1.1.1.1"], recipientIps: ["1.1.1.1"], mxIps: [], hasMx: false }).ok).toBeNull();
    await expect(routeCheck.assertRoutable({ smtpHost: "", to: "a@b.ng" })).resolves.toBeUndefined();
  });

  test("deliverability: a domain whose mailboxes are on the relay is sent, any other trapped domain refused", async () => {
    // Staging's shape: the relay is the domain's own host, its MX the host's spam filter.
    const dns = require("dns/promises");
    const hosts = { "mycityapp.io": ["198.51.100.7"], "partner.ng": ["198.51.100.7"] };
    const a = jest.spyOn(dns, "resolve4").mockImplementation(async (h) => hosts[h] || ["203.0.113.9"]);
    const mx = jest.spyOn(dns, "resolveMx").mockResolvedValue([{ exchange: "mx1-hosting.jellyfish.systems", priority: 10 }]);
    routeCheck._resetCache();
    try {
      const smtpHost = "mycityapp.io";
      await expect(routeCheck.assertRoutable({ smtpHost, to: ["ada@mycityapp.io"] })).rejects.toMatchObject({ code: "MAIL_ROUTE_TRAPPED" });
      await expect(
        routeCheck.assertRoutable({ smtpHost, to: ["Ada Obi <Ada@MyCityApp.io>"], localDomains: "mycityapp.io" }),
      ).resolves.toBeUndefined();
      await expect(
        routeCheck.assertRoutable({ smtpHost, to: ["ada@mycityapp.io", "obi@partner.ng"], localDomains: " other.ng, MyCityApp.io " }),
      ).rejects.toMatchObject({ code: "MAIL_ROUTE_TRAPPED", details: { domain: "partner.ng" } });
    } finally {
      a.mockRestore();
      mx.mockRestore();
      routeCheck._resetCache();
    }
  });

  test("mail text part", () => {
    expect(mail.textOf('<p>Hi <a href="https://x.y">there</a></p><br><style>p{}</style>&amp;')).toBe("Hi there (https://x.y)\n\n&");
  });
});

describe("spreadsheets", () => {
  test("CSV: quotes, line breaks, semicolons, a byte-order mark", () => {
    expect(parseCsvGrid('\uFEFFname,note\r\n"Obi, Ada","said ""hi""\nthen left"\r\n,\r\n')).toEqual([["name", "note"], ["Obi, Ada", 'said "hi"\nthen left']]);
    expect(parseCsvGrid("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("Name,Email\nAda,ada@x.io\n,\n")).toEqual([{ Name: "Ada", Email: "ada@x.io" }]);
    const out = buildCsv({
      columns: [{ key: "a", header: "A" }, { key: "b", header: "B" }, { key: "d", header: "Day", format: "date" }, { key: "ok", header: "Ok", format: "bool" }],
      rows: [{ a: "=SUM(A1)", b: "x,y", d: "2026-11-03", ok: true }],
    }).toString("utf8");
    expect(out).toBe("\uFEFFA,B,Day,Ok\r\n'=SUM(A1),\"x,y\",03/11/2026,Yes\r\n");
  });

  test("cells: a formula reads as its saved result, or blank when the file kept none", () => {
    expect(cellRawValue({ formula: "SUM(A1:A2)", result: 7 })).toBe(7);
    expect(cellRawValue({ formula: "IF(B2=\"\",\"\",B2)" })).toBeNull();
    expect(cellRawValue({ sharedFormula: "N6" })).toBeNull();
    expect(cellRawValue({ richText: [{ text: "On " }, { text: "track" }] })).toBe("On track");
  });

  test("cells: formula injection escaped, sheet names Excel accepts, Lagos dates, filenames", () => {
    expect(escapeFormula("+2348031234567")).toBe("'+2348031234567");
    expect(escapeFormula("@cmd")).toBe("'@cmd");
    expect(escapeFormula("Ada")).toBe("Ada");
    expect(escapeFormula(-5)).toBe(-5);
    const taken = new Set();
    expect(sheetName("Staff: Oct/Nov [draft]", { taken })).toBe("Staff Oct Nov draft");
    expect(sheetName("Staff: Oct/Nov [draft]", { taken })).toBe("Staff Oct Nov draft (2)");
    // 23:30 UTC is 00:30 the next day in Lagos.
    expect(serialDate("2026-10-14T23:30:00Z").toISOString()).toBe("2026-10-15T00:30:00.000Z");
    expect(serialDate("2026-10-14T23:30:00Z", { hasTime: false }).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(serialDate("2026-10-14").toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(exportFilename({ base: "Staff list", extension: "xlsx", date: "2026-10-14" })).toBe("Staff-list-2026-10-14.xlsx");
    expect(exportFilename({ base: "x", env: "staging", extension: "csv", date: "2026-10-14" })).toBe("x-STAGING-2026-10-14.csv");
  });

  test("dates read from a person's sheet: Excel serials, day-first text, impossible dates refused", () => {
    expect(dates.fromSerial(45000)).toBe("2023-03-15");
    expect(dates.toSerial("2023-03-15")).toBe(45000);
    expect(dates.readDate("03/07/1991")).toEqual({ date: "1991-07-03", error: null });
    expect(dates.readDate("13/31/1991").error).toMatch(/day-first/);
    expect(dates.readDate("31/02/2026").error).toBeTruthy();
    expect(dates.readDate(new Date(Date.UTC(2026, 9, 14))).date).toBe("2026-10-14");
    expect(dates.readDate("2026-10-14T00:00:00.000Z").date).toBe("2026-10-14");
    expect(dates.readDate(45000).date).toBe("2023-03-15");
  });

  test("an export reads back: money, dates, lists, totals; the Reference sheet is skipped", async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: "Employees",
          columns: [
            { key: "name", header: "Name" },
            { key: "start", header: "Start Date", format: "date" },
            { key: "pay", header: "Gross Monthly", format: "money", total: true },
            { key: "pattern", header: "Work Pattern", list: ["On-site", "Hybrid", "Remote"] },
            { key: "dept", header: "Department", refColumn: "Department" },
          ],
          rows: [{ name: "=cmd|calc", start: "2026-11-03", pay: "450000.50", pattern: "Hybrid", dept: "Partnerships" }],
        },
      ],
      reference: [{ title: "Department", values: ["Partnerships", "Operations"] }],
      context: workbookContext({ actor: { full_name: "Ada Obi" }, title: "Employees" }),
      cover: true,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cover", "Employees", "Reference"]);
    const ws = wb.getWorksheet("Employees");
    expect(ws.getCell("A1").fill.fgColor.argb).toBe("FF014339");
    expect(ws.getCell("C2").numFmt).toContain("₦");
    expect(ws.getCell("B2").numFmt).toBe("dd/mm/yyyy");
    expect(ws.getCell("D2").dataValidation.type).toBe("list");
    expect(ws.getCell("E2").dataValidation.formulae[0]).toBe("Reference!$A$3:$A$4");
    expect(ws.getCell("C3").value).toEqual(expect.objectContaining({ formula: "SUM(C2:C2)" }));
    expect(wb.getWorksheet("Cover").getCell("A1").value).toBe("Employees");

    const plain = await buildWorkbook({ sheets: [{ name: "Employees", columns: [{ key: "name", header: "Name" }, { key: "start", header: "Start Date" }, { key: "pay", header: "Gross Monthly" }], rows: [{ name: "Ada", start: "2026-11-03", pay: 1 }] }] });
    const keyed = await parseUpload({ buffer: plain, filename: "export.xlsx" });
    expect(keyed).toEqual([{ Name: "Ada", "Start Date": "2026-11-03", "Gross Monthly": 1 }]);

    const book = await readSheets({ buffer, filename: "export.xlsx" });
    expect(book.sheets.map((s) => s.name)).toEqual(["Cover", "Employees"]);
    const [header, row] = book.sheets[1].rows;
    expect(header).toEqual(["Name", "Start Date", "Gross Monthly", "Work Pattern", "Department"]);
    expect(row[0]).toBe("'=cmd|calc");
    expect(dates.readDate(row[1]).date).toBe("2026-11-03");
    expect(row[2]).toBe(450000.5);
  });

  test("uploads that are not sheets are refused", async () => {
    await expect(readSheets({ buffer: Buffer.from("%PDF-1.4"), filename: "x.pdf" })).rejects.toMatchObject({ code: "SHEET_TYPE" });
    await expect(readSheets({ buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), filename: "x.xls" })).rejects.toMatchObject({ code: "SHEET_OLD_FORMAT" });
    const csv = await readSheets({ buffer: Buffer.from("Name,Email\nAda,ada@x.io\n"), filename: "s.csv" });
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
    expect(() => registry.defineImporter({ ...base, extract: "sheets" })).toThrow(/extract/);
    expect(() => registry.defineImporter({ ...base, capability: "importing.everything" })).toThrow(/capability/);
    expect(() => registry.defineImporter({ ...base, fields: [{ key: "a", label: "A", max: 0 }], matchKeys: ["a"] })).toThrow(/max/);
  });
});
