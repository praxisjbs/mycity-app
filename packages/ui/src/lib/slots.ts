/**
 * The slot names the screen gates read (five-second.js, two-shells.js): each
 * shared component marks its text with `data-ui="<slot>"`, so a gate knows a
 * page title from a button from a help text without guessing from markup.
 * Content a person wrote or received is marked `data-copy="content"` and is
 * not counted as interface copy (FRONTEND_GUIDE §5.3).
 */

/** Every slot name, by its camelCase key. */
export const SLOTS = {
  pageTitle: "page-title",
  pageSubtitle: "page-subtitle",
  /** Card, section, modal and KPI titles. */
  title: "title",
  kpiCaption: "kpi-caption",
  /** Button, tab, chip, segment. */
  button: "button",
  /** A table header cell. */
  header: "header",
  chartCaption: "chart-caption",
  emptyText: "empty-text",
  /** HelpTerm and InfoButton text. */
  help: "help",
  /** A Details row's body. */
  details: "details",
  modalFooter: "modal-footer",
  nav: "nav",
  desktopNav: "desktop-nav",
  phoneNav: "phone-nav",
} as const;

/** One slot name. */
export type Slot = (typeof SLOTS)[keyof typeof SLOTS];

/** Spread onto an element: `<h1 {...slot("page-title")}>`. */
export const slot = (name: Slot) => ({ "data-ui": name }) as const;

/** Spread onto an element that shows content a person wrote or received. */
export const content = { "data-copy": "content" } as const;
