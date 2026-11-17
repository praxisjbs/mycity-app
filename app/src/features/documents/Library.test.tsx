// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { LIBRARY_ROWS } from "@/api/mock/modules/library";
import { copyProblems, openAs, settled } from "./testKit";

/**
 * Document Centre · Library on the in-browser mock (docs/guides/document-centre.md §6, §10): the four
 * figures that set the list's filter, the search and filters the server answers, a document beside
 * the list on a wide desktop and in a sheet on a phone (F31), and what an account sees of it.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  setViewport(1440);
});

const HERE = "/documents?tab=library";
const agreement = LIBRARY_ROWS.find((d) => d.title === "Chowdeck Service Agreement")!;
const rowsShown = () => screen.getAllByRole("row").length - 1;
const typeSearch = async (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Search documents"), { target: { value: text } });
  await settled();
};

describe("Document Centre · Library", () => {
  it("shows the four figures and the documents, newest first, within the copy rules", async () => {
    await openAs("cynthia@mycityapp.io", HERE);
    for (const label of ["All Documents", "Added This Month", "Expiring Soon", "Signed"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Library", level: 1 })).toBeTruthy();
    expect(screen.getAllByText(String(LIBRARY_ROWS.length)).length).toBeGreaterThan(0);
    // 25 a page, the server's; the pager says how many there are.
    expect(rowsShown()).toBe(25);
    expect(screen.getAllByText("Afrobeat Live MOU").length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("opens a document beside the list on a wide desktop, with what it belongs to and its actions", async () => {
    await openAs("cynthia@mycityapp.io", `${HERE}&id=${agreement.document_id}`);
    expect(screen.queryByRole("dialog")).toBeNull();
    const heading = await screen.findByRole("heading", { name: "Chowdeck Service Agreement", level: 2 });
    let pane: HTMLElement = heading;
    while (pane.parentElement && !within(pane).queryByText("Belongs To")) pane = pane.parentElement;
    expect(within(pane).getByText("Service Agreement")).toBeTruthy();
    expect(within(pane).getByText("Chowdeck, AGR-2026-0004")).toBeTruthy();
    for (const name of ["Open Record", "View File", "Download"]) expect(within(pane).getByRole("button", { name })).toBeTruthy();
    expect(within(pane).getAllByText("Expiring").length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("searches and filters on the server: every word is held to the row, a figure sets the filter", async () => {
    await openAs("cynthia@mycityapp.io", HERE);
    await typeSearch("chowdeck agreement");
    expect(rowsShown()).toBe(1);
    expect(screen.getAllByText("Chowdeck Service Agreement").length).toBeGreaterThan(0);
    await typeSearch("zebra");
    expect(screen.getByText("No Documents Found")).toBeTruthy();
    await typeSearch("");

    // A figure opens the documents behind its number.
    fireEvent.click(screen.getAllByRole("button", { name: /^Expiring Soon/ })[0]!);
    await settled();
    const expiring = LIBRARY_ROWS.filter((d) => d.status === "expiring").length;
    expect(rowsShown()).toBe(expiring);

    // Area narrows Type to its own types, and the list to its documents.
    fireEvent.click(screen.getAllByRole("button", { name: /^All Documents/ })[0]!);
    await settled();
    await chooseOption(screen.getByLabelText("Area"), "Expenses");
    await settled();
    expect(rowsShown()).toBe(LIBRARY_ROWS.filter((d) => d.area === "expenses").length);
    await chooseOption(screen.getByLabelText("Type"), "Expense Invoice");
    await settled();
    expect(rowsShown()).toBe(LIBRARY_ROWS.filter((d) => d.doc_type === "expense_invoice").length);
  }, 60000);

  it("lists for an account only what it may open", async () => {
    await openAs("emeka@mycityapp.io", HERE);
    expect(screen.queryByText("Query QRY-0014: Lateness")).toBeNull();
    expect(screen.getAllByText("Chowdeck Service Agreement").length).toBeGreaterThan(0);
    // A document that is not theirs is not found by its address either.
    cleanup();
    const letter = LIBRARY_ROWS.find((d) => d.doc_type === "query_letter")!;
    await openAs("emeka@mycityapp.io", `${HERE}&id=${letter.document_id}`);
    expect(await screen.findByText("Document Not Found")).toBeTruthy();
  }, 60000);

  it("on a phone the list is cards, the filters are a sheet, and a tapped card opens its sheet", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", HERE);
    expect(screen.queryByRole("table")).toBeNull();
    // Nothing opens until a card is tapped (F31).
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter Documents" }));
    const sheet = await screen.findByRole("dialog", { name: "Filter Documents" });
    expect(within(sheet).getByRole("button", { name: "Show Documents" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear Filters" }));
    await settled();

    fireEvent.click((await screen.findAllByText("Chowdeck Service Agreement"))[0]!);
    await settled();
    const record = screen.getAllByRole("dialog").at(-1)!;
    expect(within(record).getByRole("button", { name: "Download" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("a company document shows its category and tags, and its keeper may edit, replace and archive it", async () => {
    const cac = LIBRARY_ROWS.find((d) => d.title === "Certificate of Incorporation")!;
    await openAs("cynthia@mycityapp.io", `${HERE}&id=${cac.document_id}`);
    const heading = await screen.findByRole("heading", { name: "Certificate of Incorporation", level: 2 });
    let pane: HTMLElement = heading;
    while (pane.parentElement && !within(pane).queryByText("Category")) pane = pane.parentElement;
    expect(within(pane).getByText("Registration & Statutory")).toBeTruthy();
    expect(within(pane).getByText("cac, incorporation")).toBeTruthy();
    fireEvent.pointerDown(within(pane).getByRole("button", { name: "Document Actions" }), { button: 0, pointerType: "mouse" });
    for (const name of ["Edit Details", "Upload New Version", "Archive Document"]) expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Edit Details").at(-1)!);
    const form = await screen.findByRole("dialog", { name: "Edit Details" });
    for (const label of ["Title", "Category", "Tags", "Expires", "Description"]) expect(within(form).getByText(label)).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Save Details" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("Upload Document asks for the file and its details; staff cannot upload, and never see a category kept from them", async () => {
    await openAs("cynthia@mycityapp.io", HERE);
    fireEvent.click(screen.getAllByRole("button", { name: "Upload Document" })[0]!);
    const form = await screen.findByRole("dialog", { name: "Upload Document" });
    for (const label of ["File", "Title", "Category", "Tags", "Expires", "Description"]) expect(within(form).getByText(label)).toBeTruthy();
    // Pressing it with nothing filled marks the fields, and sends nothing.
    fireEvent.click(within(form).getByRole("button", { name: "Upload Document" }));
    await settled();
    expect(screen.getByRole("dialog", { name: "Upload Document" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    cleanup();

    await openAs("emeka@mycityapp.io", HERE);
    expect(screen.queryByRole("button", { name: "Upload Document" })).toBeNull();
    expect(screen.queryByText("Annual Status Report")).toBeNull();
    expect(screen.getAllByText("Certificate of Incorporation").length).toBeGreaterThan(0);
  }, 60000);

  it("Download Letterhead offers PDF and Word", async () => {
    await openAs("emeka@mycityapp.io", HERE);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Download Letterhead" }), { button: 0, pointerType: "mouse" });
    expect((await screen.findAllByText("PDF File")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Word File").length).toBeGreaterThan(0);
  }, 60000);
});
