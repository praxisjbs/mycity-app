/**
 * Sample documents for the Documents group's gallery pages: a small PDF and a
 * small picture as data URLs, so the gallery needs no server, and an article
 * list. Not exported from the package; a screen's files come from the vault.
 */

/** A one-page PDF, small enough to inline. */
export const SAMPLE_PDF =
  "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMTQgVGYgMjAgNTAgVGQgKFJlY2VpcHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iajw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSL1NpemUgNj4+";

/** A small picture, drawn as a plain coloured square. */
export const SAMPLE_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjgwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjI4MCIgZmlsbD0iI2UyZThlNiIvPjx0ZXh0IHg9IjIwMCIgeT0iMTQ1IiBmb250LWZhbWlseT0ic2Fuc-c2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZpbGw9IiMwMTQzMzkiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlJlY2VpcHQ8L3RleHQ+PC9zdmc+";

export const ARTICLE_GROUPS = [
  { label: "Getting Started", items: [{ key: "a1", title: "Your first week" }, { key: "a2", title: "Clocking in and out" }] },
  { label: "Pay And Leave", items: [{ key: "a3", title: "When you are paid" }, { key: "a4", title: "Booking leave" }] },
  { label: "Policies", items: [{ key: "a5", title: "Expenses policy" }] },
];
