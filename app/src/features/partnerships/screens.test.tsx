// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Partnerships from "./index";

/**
 * Pipeline, Partners and Leads with both 360s on the in-browser mock (docs/guides/partnerships.md §10):
 * each screen draws from the contract's shapes, a row opens its record beside the list, a lead's
 * stage moves on its switcher, and a phone opens the record in a sheet (F31). Proposals: the list beside
 * the studio, each proposal at its step (Questions, Edit, Sent), and on a phone the studio in a sheet.
 */
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "partnerships" ? <Partnerships tab={location.tab ?? "pipeline"} id={location.id} /> : null;
}
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Screen /> : null;
}
const app = (show: boolean) => (
  <RouterProvider>
    <AuthProvider>
      <ModalProvider>
        <ScreenActionProvider>
          <Harness show={show} />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock (as Operations unless `email` says otherwise) and opens a Partnerships address. */
async function open(at: string, email = "cynthia@mycityapp.io") {
  window.history.replaceState(null, "", at);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
}

beforeAll(() => setViewport(1440));
afterEach(() => {
  cleanup();
  setViewport(1440);
});

describe("Partnerships on the contract", () => {
  it("Pipeline: the KPI strip, the stages and the stalled deals with their blockers", async () => {
    await open("/partnerships?tab=pipeline");
    expect(await screen.findByRole("heading", { level: 1, name: "Pipeline" }, { timeout: 8000 })).toBeTruthy();
    expect((await screen.findAllByText("Open Deals", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Signed Value").length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Stalled" }, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Leads: a row opens the Lead 360 beside the list, with its stage switcher and KPI cards", async () => {
    await open("/partnerships?tab=leads");
    expect(await screen.findByRole("heading", { level: 1, name: "Leads" }, { timeout: 8000 })).toBeTruthy();
    const switcher = await screen.findByRole("group", { name: /^Stage of / }, { timeout: 8000 });
    expect(within(switcher).getByRole("button", { name: /current stage$/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Days at Stage")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Deal" })).toBeTruthy();
  }, 30000);

  it("Partners: the Partner 360 with its eight tabs and four cards", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByRole("heading", { level: 1, name: "Partners" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    for (const t of ["Overview", "Deals", "Documents", "Returns", "Work", "Activity", "Contacts", "Details"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Work" }), { button: 0 });
    expect(await screen.findByText("No Tasks Yet")).toBeTruthy();
  }, 30000);

  it("Partners: the Work tab's New Task opens My Workspace's form already connected, and lists the task (§6.16)", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Work" }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "New Task" }));
    const dialog = await screen.findByRole("dialog");
    // Connected already: Partner names the record, with Disconnect beside it.
    expect(within(dialog).getByText("Partner")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Task"), { target: { value: "Print the festival banners" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Task" }));
    expect(await screen.findByText("Print the festival banners", {}, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Partners: the Returns tab, with the money, lists the months and opens Enter Returns", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Export" }).length).toBeGreaterThan(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Returns" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Months" }, { timeout: 8000 })).toBeTruthy();
    for (const k of ["Commission", "Gross Sales", "Units Sold", "Downloads"]) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Enter Returns" }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    for (const label of ["Month", "Units Sold", "Gross Sales", "MyCity Commission", "Paid to Partner", "Downloads", "Note"]) expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Save Returns" })).toBeTruthy();
  }, 30000);

  it("Partners: the desktop filters, the Owner column, and the 360's Activity naming each deal's history", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByRole("heading", { level: 1, name: "Partners" }, { timeout: 8000 })).toBeTruthy();
    for (const f of ["Stage", "Category", "Region", "Owner", "Health"]) expect(screen.getAllByText(f).length).toBeGreaterThan(0);
    expect(await screen.findByRole("columnheader", { name: "Owner" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText("Days Since Last Contact", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Activity" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Stage History" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByText(/ · Moved to /).length).toBeGreaterThan(0);
  }, 30000);

  it("New Deal: Deal Options up to five, and the deal's terms behind Advanced for a holder of the money", async () => {
    await open("/partnerships?tab=partners");
    fireEvent.click(await screen.findByRole("button", { name: "New Deal" }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    for (let i = 0; i < 5; i += 1) fireEvent.click(within(dialog).getByRole("button", { name: "Add Option" }));
    expect(within(dialog).getByText("Option 5")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Add Option" })).toBeNull();
    expect(within(dialog).getAllByText("MyCity's Commission").length).toBe(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Option 5" }));
    expect(within(dialog).getByRole("button", { name: "Add Option" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Advanced/ }));
    for (const label of ["Impact Rating", "Commission %", "Validity", "Team"]) expect(await within(dialog).findByText(label)).toBeTruthy();
    // Impact is typed or picked: MyCity's names are suggested, and one it does not hold is added as typed (§6.3).
    const impact = within(dialog).getByRole("combobox", { name: /^Impact( Optional)?$/ });
    fireEvent.focus(impact);
    expect(await within(dialog).findByRole("option", { name: "Brand Visibility" }, { timeout: 8000 })).toBeTruthy();
    fireEvent.change(impact, { target: { value: "Tourism Reach" } });
    fireEvent.keyDown(impact, { key: "Enter" });
    expect(within(dialog).getByRole("button", { name: "Remove Tourism Reach" })).toBeTruthy();
  }, 30000);

  it("Documents: a row opens its file in the viewer; each has Download, and an upload has Remove Document", async () => {
    await open("/partnerships?tab=partners");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Documents" }, { timeout: 8000 }), { button: 0 });
    // An upload on every partner of the first page, so the one open beside the list has one.
    const partners = await api.call("GET /api/v1/partnerships/partners", { query: {} });
    for (const p of partners.data) await api.call("POST /api/v1/partnerships/documents", { body: { document_id: crypto.randomUUID(), kind: "MOU", partner_id: p.partner_id } });
    await act(async () => invalidate("/api/v1/partnerships/documents"));
    expect(await screen.findByRole("button", { name: "Download Upload.pdf" }, { timeout: 8000 })).toBeTruthy();
    const removes = screen.getAllByRole("button", { name: "Remove Upload.pdf" });
    expect(removes.length).toBe(screen.getAllByRole("button", { name: "Download Upload.pdf" }).length);
    // A signed copy the hub filed has Download and no Remove.
    for (const b of screen.queryAllByRole("button", { name: /^Download .* Agreement\.pdf$/ })) expect(b.closest("tr")?.querySelector('[aria-label^="Remove"]')).toBeNull();

    fireEvent.click(removes[0]!);
    const ask = await screen.findByRole("alertdialog", {}, { timeout: 8000 });
    fireEvent.click(within(ask).getByRole("button", { name: "Remove Document" }));
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Remove Upload.pdf" }).length).toBe(removes.length - 1), { timeout: 8000 });

    fireEvent.click(screen.getAllByRole("button", { name: /^Download / })[0]!.closest("tr")!.querySelector("td")!);
    expect(await screen.findByRole("dialog", {}, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Upload Document: Kind is typed or picked from MyCity's document kinds", async () => {
    await open("/partnerships?tab=partners");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Documents" }, { timeout: 8000 }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Upload Document" }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    const kind = within(dialog).getByRole("combobox", { name: /^Kind/ });
    fireEvent.focus(kind);
    expect(await within(dialog).findByRole("option", { name: "Service Agreement" }, { timeout: 8000 })).toBeTruthy();
    fireEvent.change(kind, { target: { value: "Deal Merchant Agreement" } });
    expect(await within(dialog).findByRole("option", { name: /^Add .Deal Merchant Agreement.$/ }, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("on a phone nothing opens until a row is tapped, then the record opens in a sheet", async () => {
    setViewport(390);
    await open("/partnerships?tab=leads");
    await screen.findByRole("heading", { level: 1, name: "Leads" }, { timeout: 8000 });
    expect(screen.queryByRole("group", { name: /^Stage of / })).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-row-open]")).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(document.querySelector("[data-row-open]") as HTMLElement);
    const sheet = await screen.findByRole("dialog", {}, { timeout: 8000 });
    expect(await within(sheet).findByRole("group", { name: /^Stage of / }, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Contracts & MOUs: the KPI strip, the agreements beside the picked one, its lifecycle, signers, wording and reference", async () => {
    await open("/partnerships?tab=contracts-and-mous");
    expect(await screen.findByRole("heading", { level: 1, name: "Contracts & MOUs" }, { timeout: 8000 })).toBeTruthy();
    for (const k of ["Active", "In Approval", "Awaiting Signature", "Renewals 180 Days"]) expect((await screen.findAllByText(k, {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    // The first row, an active agreement, opens beside the list: its lifecycle, signer, reference and wording.
    expect(await screen.findByRole("list", { name: "Agreement lifecycle" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Reference and QR" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole("img", { name: /^QR code for AGR-/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Signers" })).toBeTruthy();
    // The wording's options table, each row named by its term.
    expect(await screen.findByRole("rowheader", { name: "Deal Price" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Renew" }).length).toBeGreaterThan(0);
  }, 30000);

  it("Contracts & MOUs: a Draft names its empty field, and Submit for Approval is refused until it is filled", async () => {
    await open("/partnerships?tab=contracts-and-mous");
    const chips = await screen.findByRole("group", { name: "Agreements" }, { timeout: 8000 });
    fireEvent.click(within(chips).getByRole("button", { name: "Draft" }));
    expect(await screen.findByText(/^Fill Event Title before you submit/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit Draft" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Submit for Approval" })).toBeNull();
  }, 30000);

  it("Contracts & MOUs on a phone: two KPI cards, nothing open until a row is tapped, then its sheet with the next step at its foot", async () => {
    setViewport(390);
    await open("/partnerships?tab=contracts-and-mous");
    await screen.findByRole("heading", { level: 1, name: "Contracts & MOUs" }, { timeout: 8000 });
    expect(await screen.findByText("Awaiting Signature", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("Renewals 180 Days")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Reference and QR" })).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-row-open]")).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(document.querySelector("[data-row-open]") as HTMLElement);
    const sheet = await screen.findByRole("dialog", {}, { timeout: 8000 });
    expect((await within(sheet).findAllByRole("button", { name: "Renew" }, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(within(sheet).queryByRole("table")).toBeNull();
  }, 30000);

  it("Proposals: the list beside the studio, the sent proposal's pages and its outcome", async () => {
    await open("/partnerships?tab=proposals");
    expect(await screen.findByRole("heading", { level: 1, name: "Proposals" }, { timeout: 8000 })).toBeTruthy();
    expect((await screen.findAllByText("Sent This Year", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(screen.getByText("Acceptance Rate")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Mark Accepted" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByLabelText("Proposal PRO-0027", { selector: "iframe" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send Proposal" })).toBeNull();
  }, 30000);

  it("Proposals: the studio's steps, Questions with their cards and Edit with Send", async () => {
    await open("/partnerships?tab=proposals");
    fireEvent.click(await screen.findByText("PRO-0030", {}, { timeout: 8000 }));
    expect(await screen.findByText("What would make this season a success for them?", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("0 of 6 answered")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write Draft" })).toBeTruthy();
    fireEvent.click(screen.getByText("PRO-0028"));
    expect(await screen.findByRole("button", { name: "Send Proposal" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Edit Words" }, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send Proposal" }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    expect(within(dialog).getByRole("button", { name: "Confirm and Send" })).toBeTruthy();
  }, 30000);

  it("Proposals on a phone: nothing opens until a row is tapped, then the studio opens in a sheet", async () => {
    setViewport(390);
    await open("/partnerships?tab=proposals");
    await screen.findByRole("heading", { level: 1, name: "Proposals" }, { timeout: 8000 });
    await waitFor(() => expect(document.querySelector("[data-row-open]")).toBeTruthy(), { timeout: 8000 });
    expect(screen.queryByRole("button", { name: "Mark Accepted" })).toBeNull();
    fireEvent.click(document.querySelector("[data-row-open]") as HTMLElement);
    const sheet = await screen.findByRole("dialog", {}, { timeout: 8000 });
    expect(await within(sheet).findByRole("button", { name: "Mark Accepted" }, { timeout: 8000 })).toBeTruthy();
  }, 30000);
  it("Analytics: the period, the KPI strip, each lead owner's eight measures and the tables beside them", async () => {
    await open("/partnerships?tab=analytics");
    expect(await screen.findByRole("heading", { level: 1, name: "Analytics" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "By Lead Owner" }, { timeout: 8000 })).toBeTruthy();
    for (const k of ["New Prospects", "Partnerships Signed", "Meetings Held", "Proposals Sent"]) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    for (const h of ["Signed per Month", "Returns per Month", "By Category", "By Region", "Stage Conversion"]) expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    expect(screen.getAllByText("Vendor Leads").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "This Year" }));
    await waitFor(() => expect(screen.getByText(/^01\/01\/\d{4} to 31\/12\/\d{4}$/)).toBeTruthy(), { timeout: 8000 });
  }, 30000);

  it("Analytics on a phone: two KPI cards, a card a lead owner, and Signed per Month only", async () => {
    setViewport(390);
    await open("/partnerships?tab=analytics");
    await screen.findByRole("heading", { level: 1, name: "Analytics" }, { timeout: 8000 });
    expect(await screen.findByText("Partnerships Signed", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText("Meetings Held", { selector: "h3, h2, [data-kpi-title]" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Signed per Month" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Stage Conversion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  }, 30000);

  it("Contracts & MOUs: Approve and Reject are offered to whoever may decide the approval, and Approve opens Send for Signature", async () => {
    // Operations is not named on the CEO's stage, so the Approval card only reads.
    await open("/partnerships?tab=contracts-and-mous");
    let chips = await screen.findByRole("group", { name: "Agreements" }, { timeout: 8000 });
    fireEvent.click(within(chips).getByRole("button", { name: "In Approval" }));
    expect(await screen.findByRole("heading", { name: "Approval" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    cleanup();

    // The CEO may decide any stage: both buttons show, and Approve moves the agreement to its next step.
    await open("/partnerships?tab=contracts-and-mous", "ifeoma@mycityapp.io");
    chips = await screen.findByRole("group", { name: "Agreements" }, { timeout: 8000 });
    fireEvent.click(within(chips).getByRole("button", { name: "In Approval" }));
    expect(await screen.findByRole("button", { name: "Reject" }, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect((await screen.findAllByRole("button", { name: "Send for Signature" }, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  }, 40000);
});
