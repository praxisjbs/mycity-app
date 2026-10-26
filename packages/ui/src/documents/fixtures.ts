/**
 * Sample documents for the Documents group's gallery pages: a small PDF and a
 * small picture as data URLs, so the gallery needs no server, and an article
 * list. Not exported from the package; a screen's files come from the vault.
 */

/** A one-page PDF, small enough to inline. */
export const SAMPLE_PDF =
  "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMTQgVGYgMjAgNTAgVGQgKFJlY2VpcHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iajw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSL1NpemUgNj4+";

/** SAMPLE_PDF's bytes, for PdfViewer and MediaViewer, which draw a PDF from its bytes. */
export const samplePdfBlob = (): Blob =>
  new Blob([Uint8Array.from(atob(SAMPLE_PDF.slice(SAMPLE_PDF.indexOf(",") + 1)), (c) => c.charCodeAt(0))], { type: "application/pdf" });

/** A small picture, drawn as a plain coloured square. */
export const SAMPLE_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjgwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjI4MCIgZmlsbD0iI2UyZThlNiIvPjx0ZXh0IHg9IjIwMCIgeT0iMTQ1IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMCIgZmlsbD0iIzAxNDMzOSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UmVjZWlwdDwvdGV4dD48L3N2Zz4=";

export const ARTICLE_GROUPS = [
  { label: "Getting Started", items: [{ key: "a1", title: "Your first week" }, { key: "a2", title: "Clocking in and out" }] },
  { label: "Pay And Leave", items: [{ key: "a3", title: "When you are paid" }, { key: "a4", title: "Booking leave" }] },
  { label: "Policies", items: [{ key: "a5", title: "Expenses policy" }] },
];

const plain = (text: string) => ({ text, bold: false, italic: false, code: false, href: null });
const bold = (text: string) => ({ ...plain(text), bold: true });
const link = (text: string, href: string) => ({ ...plain(text), bold: true, href });

/** A User Guide task as the API sends it: steps with a screen link and a picture, a tip and a table. */
export const GUIDE_BLOCKS = [
  { kind: "paragraph" as const, spans: [plain("Add a person once they have accepted the offer, before their first day.")] },
  {
    kind: "steps" as const,
    items: [
      { n: 1, spans: [plain("Open "), link("People · Employees", "/people?tab=employees"), plain(".")], figure: null },
      { n: 2, spans: [plain("Press "), bold("Add Employee"), plain(" at the top right.")], figure: { shot: "people-add", alt: "The Employees list with Add Employee at the top right" } },
      { n: 3, spans: [plain("Fill in "), bold("Person"), plain(", then press "), bold("Next"), plain(".")], figure: null },
    ],
  },
  { kind: "note" as const, tone: "tip" as const, spans: [plain("A field you cannot see is set by People, not by you.")] },
  {
    kind: "table" as const,
    head: [[plain("Field")], [plain("What to enter")]],
    rows: [
      [[bold("Work Email")], [plain("Their address at mycityapp.io")]],
      [[bold("Start Date")], [plain("Their first working day")]],
    ],
  },
];

/** The picture GUIDE_BLOCKS shows, with its marks. */
export const GUIDE_PICTURE = {
  desktop: SAMPLE_IMAGE,
  phone: SAMPLE_IMAGE,
  legend: [
    { n: 1, text: "Add Employee" },
    { n: 2, text: "The search box" },
  ],
};

/** Search results as the User Guide's API ranks them (GuideResults). */
export const GUIDE_HITS = [
  {
    anchor: "start-forgot-password",
    kind: "task",
    chapter_title: "Getting Started",
    section_title: "Signing In",
    title: "Forgot your password",
    step: 1,
    snippet: [
      { text: "On the sign-in screen, press ", hit: false },
      { text: "Forgot Password", hit: true },
      { text: ".", hit: false },
    ],
  },
  {
    anchor: "ess-change-password",
    kind: "task",
    chapter_title: "Employee Self-Service",
    section_title: "My Security",
    title: "Change your password",
    step: null,
    snippet: [
      { text: "Type your current ", hit: false },
      { text: "password", hit: true },
      { text: ", then the new one twice.", hit: false },
    ],
  },
  {
    anchor: "start-sign-in",
    kind: "section",
    chapter_title: "Getting Started",
    section_title: "Signing In",
    title: "Signing In",
    step: null,
    snippet: [{ text: "Open the hub and sign in with your work email.", hit: false }],
  },
] as const;

/** An answer written from GUIDE_HITS (GuideAnswerCard). */
export const GUIDE_ANSWER = {
  found: true,
  sentences: [
    { text: "On the sign-in screen, press Forgot Password and type your work email.", sources: [1] },
    { text: "A link to choose a new password arrives by email.", sources: [1] },
  ],
  sources: GUIDE_HITS,
};
