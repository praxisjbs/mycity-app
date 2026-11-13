"use strict";
/**
 * The Word (.docx) builder. PURE: a title, a line under it and plain text in, a .docx buffer out.
 * Office Open XML is a zip of a few XML parts; this writes the smallest set Word, LibreOffice,
 * Google Docs and Pages all open: the document, its styles (Title, Subtitle and Normal, in
 * MyCity's green) and the core properties (title and author).
 *
 *   const buffer = await buildDocx({
 *     title: "Code of Conduct",
 *     subtitle: "My Notes · Ada Obi · 12/11/2026",
 *     body: "Lock the screen.\nReport a lost phone the same day.",
 *     author: "Ada Obi",
 *   });
 *
 * Each line of the body is a paragraph (blank lines kept), tabs stay tabs, and characters XML 1.0
 * forbids are dropped. Nothing here reads the database or knows who asked: an export's handler
 * gathers the text and passes it in (shared/documents/exports.js makes the file).
 */
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Text safe inside XML: escaped, without the control characters XML 1.0 forbids. */
function xmlText(value) {
  return (
    String(value ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

/** One paragraph of `style`; tabs stay tabs and spaces are kept as typed. */
function paragraph(text, style) {
  const runs = String(text)
    .split("\t")
    .map((part, i) => (i > 0 ? "<w:r><w:tab/></w:r>" : "") + (part ? `<w:r><w:t xml:space="preserve">${xmlText(part)}</w:t></w:r>` : ""))
    .join("");
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${props}${runs}</w:p>`;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES =
  `${XML}<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
  '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="014339"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
  '<w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="595959"/></w:rPr></w:style>' +
  "</w:styles>";

/**
 * @param {{title: string, subtitle?: string, body?: string, author?: string, date?: Date}} doc
 * @returns {Promise<Buffer>} the .docx file
 */
async function buildDocx({ title, subtitle = "", body = "", author = "", date = new Date() }) {
  const lines = String(body).replace(/\r\n?/g, "\n").split("\n");
  const document =
    `${XML}<w:document xmlns:w="${W}"><w:body>` +
    paragraph(title, "Title") +
    (subtitle ? paragraph(subtitle, "Subtitle") : "") +
    lines.map((line) => paragraph(line)).join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const core =
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"` +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlText(title)}</dc:title><dc:creator>${xmlText(author)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  );
  zip.file("word/document.xml", document);
  zip.file("word/styles.xml", STYLES);
  zip.file("docProps/core.xml", core);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: MIME });
}

module.exports = { buildDocx, MIME };
