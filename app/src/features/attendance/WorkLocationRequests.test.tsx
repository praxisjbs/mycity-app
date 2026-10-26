// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { formatDate, ModalProvider, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { setMockHomeLocation } from "@/api/mock/modules/policies";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";
import { WorkLocationRequestsPage } from "./WorkLocationRequests";
import { Worksites } from "./Worksites";

/**
 * Temporary sites and the work location requests made before them, on the in-browser mock
 * (docs/guides/attendance.md §6.11, §10). Add Work Site: the purpose searched, the addresses picked
 * with their radius and map, checked as it is filled, sent to Operations & People and withdrawn
 * with a reason. People · Worksites shows Permanent alone and Temporary beside it, where People
 * approve or reject a waiting site, take someone off and cancel one in force, and still decide the
 * old requests. The mock's sites and requests are invented: TS-0001, Partner Training Week, is in
 * progress for Bashir and Tolu; TS-0002, in Gaborone, waits on Operations & People; WLR-0003 is
 * Chidera's remote day waiting on their line manager, Cynthia.
 */

// Nothing here reads the location: a temporary site's addresses are picked, never read from the device.
const getCurrentPosition = vi.fn();

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  setViewport(1440);
  getCurrentPosition.mockClear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let clock: ReturnType<typeof useClock> | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
function Clock({ children }: { children?: ReactNode }) {
  clock = useClock();
  return <>{children}</>;
}
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <Clock>{children}</Clock> : null;
}

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
  clock = null;
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{screenUnderTest}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await waitFor(() => expect(clock?.today).toBeTruthy(), { timeout: 5000 });
}

/** A day from today, as a person types it (day-first). */
const typed = (days: number) => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d.toISOString().slice(0, 10));
};
const fill = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
const pressIn = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));
/** Picks an address the way a person does (F27): types to search, then presses the place found. */
async function pickAddress(dialog: HTMLElement, text: string, option: RegExp) {
  // The newest address card's search: a picked address shows its place, not a search box.
  const box = within(dialog).getAllByRole("combobox", { name: "Address" }).at(-1)!;
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(await within(dialog).findByRole("option", { name: option }, { timeout: 5000 }));
}

describe("temporary sites", () => {
  it("Add Work Site: the purpose searched, two addresses picked, checked as filled, sent for approval and withdrawn", async () => {
    await signedInAs("chidera@mycityapp.io", <WorkLocationRequestsPage />);
    await screen.findByText("No Temporary Sites");
    // The requests made before PR 4 stay under the sites; nobody makes a new one.
    await screen.findByText("WLR-0003 · Remote Day");
    expect(screen.queryByRole("button", { name: "New Request" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Add Work Site" })[0]);
    let dialog = await screen.findByRole("dialog", { name: "Add Work Site" });
    pressIn(dialog, "Submit for Approval");
    const purpose = within(dialog).getByRole("combobox", { name: "Purpose" });
    await waitFor(() => expect(purpose.getAttribute("aria-invalid")).toBe("true"));
    for (const label of ["Name", "First Day", "Last Day"]) expect(within(dialog).getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByRole("combobox", { name: "Address" }).getAttribute("aria-invalid")).toBe("true");

    // Seventeen purposes: typing narrows them.
    fireEvent.click(purpose);
    const search = await screen.findByRole("searchbox", { name: "Search Purpose" });
    fireEvent.change(search, { target: { value: "train" } });
    const purposes = screen.getByRole("listbox", { name: "Purpose" });
    expect(within(purposes).getAllByRole("option").map((o) => o.textContent)).toEqual(["Training (Delivering)", "Training (Attending)"]);
    fireEvent.click(within(purposes).getByRole("option", { name: "Training (Attending)" }));
    expect(purpose.textContent).toBe("Training (Attending)");

    fill(dialog, "Name", "Partner Training");
    expect(await axe(dialog)).toHaveNoViolations();
    await pickAddress(dialog, "herbert", /21 Herbert Macaulay Way, Yaba/);
    // Its point and the radius it starts at, on a small map.
    await waitFor(() => expect(dialog.querySelector("[data-points]")?.getAttribute("data-points")).toBe("6.50950, 3.37900"));
    pressIn(dialog, "Add Address");
    await pickAddress(dialog, "bourdillon", /Bourdillon Road, Ikoyi/);
    pressIn(dialog, "Add Address");
    const cards = () => within(dialog).getAllByText(/^Address \d$/).map((h) => h.textContent);
    expect(cards()).toEqual(["Address 1", "Address 2", "Address 3"]);
    // Remove takes the third out again; the first has none.
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Remove" })[1]);
    expect(cards()).toEqual(["Address 1", "Address 2"]);
    fill(dialog, "First Day", typed(3));
    fill(dialog, "Last Day", typed(4));
    fireEvent.change(within(dialog).getByPlaceholderText("Partner training, Lekki"), { target: { value: "Two days of partner training at their offices." } });
    pressIn(dialog, "Submit for Approval");
    const row = await screen.findByText("TS-0006 · Partner Training");
    const mine = await api.call("GET /api/v1/attendance/me/temporary-sites", { query: {} });
    expect(mine.data.find((x) => x.number === "TS-0006")).toMatchObject({
      purpose: "training_attending", status: "submitted", state: "submitted", days: 2, people: 1, waiting_on: "Operations & People", can_withdraw: true,
      locations: [{ position: 1, radius_m: 150, address: "21 Herbert Macaulay Way, Yaba, Lagos" }, { position: 2, radius_m: 150 }],
    });

    fireEvent.click(row);
    dialog = await screen.findByRole("dialog", { name: "TS-0006 · Partner Training" });
    const route = await within(dialog).findByRole("list", { name: "Approval route" });
    expect(within(route).getByText("Operations & People").textContent).toBe("Operations & People, waiting here");
    pressIn(dialog, "Withdraw Submission");
    const form = await screen.findByRole("dialog", { name: "Withdraw Submission" });
    fill(form, "Reason", "short");
    pressIn(form, "Withdraw Submission");
    await waitFor(() => expect(within(form).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    fill(form, "Reason", "The partner moved the training online");
    pressIn(form, "Withdraw Submission");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = await api.call("GET /api/v1/attendance/me/temporary-sites", { query: {} });
    expect(after.data.find((x) => x.number === "TS-0006")).toMatchObject({ status: "withdrawn", state: "withdrawn", cancel_reason: "The partner moved the training online", can_withdraw: false });
  }, 30000);

  it("Temporary Home is a purpose only while the policy's Home Location is on (attendance.md §1.3)", async () => {
    const offered = async () => {
      fireEvent.click((await screen.findAllByRole("button", { name: "Add Work Site" }))[0]);
      const dialog = await screen.findByRole("dialog", { name: "Add Work Site" });
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Purpose" }));
      fireEvent.change(await screen.findByRole("searchbox", { name: "Search Purpose" }), { target: { value: "home" } });
      return screen.queryAllByRole("option", { name: "Temporary Home" }).length;
    };
    await signedInAs("chidera@mycityapp.io", <WorkLocationRequestsPage />);
    expect(await offered()).toBe(0);
    cleanup();
    setMockHomeLocation(true);
    try {
      await signedInAs("chidera@mycityapp.io", <WorkLocationRequestsPage />);
      expect(await offered()).toBe(1);
    } finally {
      setMockHomeLocation(false);
    }
  }, 30000);

  it("Site Hours ask for a start and an end, and the site keeps them; the Usual Shift asks for neither", async () => {
    await signedInAs("chidera@mycityapp.io", <WorkLocationRequestsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Work Site" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add Work Site" });
    // Hours come first, on the Usual Shift.
    expect(within(dialog).getByRole("radio", { name: "Usual Shift" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).queryByLabelText("Starts At")).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Site Hours" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Purpose" }));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search Purpose" }), { target: { value: "delivering" } });
    fireEvent.click(within(screen.getByRole("listbox", { name: "Purpose" })).getByRole("option", { name: "Training (Delivering)" }));
    fill(dialog, "Name", "Partner Sunday Training");
    await pickAddress(dialog, "herbert", /21 Herbert Macaulay Way, Yaba/);
    fill(dialog, "First Day", typed(5));
    fill(dialog, "Last Day", typed(6));
    fireEvent.change(within(dialog).getByPlaceholderText("Partner training, Lekki"), { target: { value: "Training the partner's staff on the ERP over two days." } });
    pressIn(dialog, "Submit for Approval");
    await waitFor(() => expect(within(dialog).getByLabelText("Starts At").getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByLabelText("Ends At").getAttribute("aria-invalid")).toBe("true");
    fill(dialog, "Starts At", "15:00");
    fill(dialog, "Ends At", "11:00");
    pressIn(dialog, "Submit for Approval");
    await waitFor(() => expect(within(dialog).getByText("Ends before it starts")).toBeTruthy());
    fill(dialog, "Starts At", "11:00");
    fill(dialog, "Ends At", "15:00");
    pressIn(dialog, "Submit for Approval");
    const row = await screen.findByText(/^TS-\d{4} · Partner Sunday Training$/);
    const mine = await api.call("GET /api/v1/attendance/me/temporary-sites", { query: {} });
    expect(mine.data.find((x) => x.name === "Partner Sunday Training")).toMatchObject({ hours: "site", starts_at: "11:00", ends_at: "15:00" });
    fireEvent.click(row);
    const view = await screen.findByRole("dialog", { name: /Partner Sunday Training$/ });
    expect(within(view).getByText("11:00 to 15:00")).toBeTruthy();
  }, 30000);

  it("People · Worksites: Permanent alone, then Temporary, where Operations & People reject or approve a waiting site", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    await screen.findByText("Worksites", { selector: "h1" });
    expect(screen.queryByText("TS-0002 · Gaborone Partner Training")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Temporary" }));
    fireEvent.click(await screen.findByText("TS-0002 · Gaborone Partner Training", undefined, { timeout: 5000 }));
    let dialog = await screen.findByRole("dialog", { name: "TS-0002 · Gaborone Partner Training" });
    // An address abroad keeps its own time zone.
    expect(within(dialog).getByText("Africa/Gaborone")).toBeTruthy();
    pressIn(dialog, "Reject");
    const form = await screen.findByRole("dialog", { name: "Reject TS-0002" });
    pressIn(form, "Reject");
    await waitFor(() => expect(within(form).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    // Keeping it closes the form; the site is still waiting.
    pressIn(form, "Keep It");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("TS-0002 · Gaborone Partner Training"));
    dialog = await screen.findByRole("dialog", { name: "TS-0002 · Gaborone Partner Training" });
    pressIn(dialog, "Approve");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const page = await api.call("GET /api/v1/attendance/temporary-sites", { query: { q: "TS-0002" } });
    expect(page.data[0]).toMatchObject({ status: "approved", state: "upcoming", approved_by_name: "Cynthia Osakunih", can_decide: false, waiting_on: null });
  }, 30000);

  it("People take someone off a site in force with a reason, then cancel it", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click(screen.getByRole("radio", { name: "Temporary" }));
    fireEvent.click(await screen.findByText("TS-0001 · Partner Training Week", undefined, { timeout: 5000 }));
    let dialog = await screen.findByRole("dialog", { name: "TS-0001 · Partner Training Week" });
    fireEvent.click(within(within(dialog).getByText("Tolu Adeyemi").closest("tr")!).getByRole("button", { name: "Take Off" }));
    let form = await screen.findByRole("dialog", { name: "Take Off Tolu Adeyemi" });
    fill(form, "Reason", "Needed at the office this week");
    pressIn(form, "Take Off");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    let site = (await api.call("GET /api/v1/attendance/temporary-sites", { query: { q: "TS-0001" } })).data[0];
    expect(site).toMatchObject({ people: 1, status: "approved" });

    fireEvent.click(await screen.findByText("TS-0001 · Partner Training Week"));
    dialog = await screen.findByRole("dialog", { name: "TS-0001 · Partner Training Week" });
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Take Off" })).toBeNull());
    pressIn(dialog, "Cancel Site");
    form = await screen.findByRole("dialog", { name: "Cancel Site" });
    fill(form, "Reason", "The partner postponed the training");
    pressIn(form, "Cancel Site");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    site = (await api.call("GET /api/v1/attendance/temporary-sites", { query: { q: "TS-0001" } })).data[0];
    expect(site).toMatchObject({ status: "cancelled", state: "cancelled", cancel_reason: "The partner postponed the training", can_change: false });
  }, 30000);

  it("People add one in force at once, from the employee list, with Save Site", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click(screen.getByRole("radio", { name: "Temporary" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Temporary Site" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Temporary Site" });
    expect(within(dialog).getByRole("button", { name: "Save Site" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Submit for Approval" })).toBeNull();
  }, 30000);
});

describe("work location requests made before PR 4", () => {
  it("People decide the stage waiting on them on Worksites, Temporary, Requests: the line manager first, then Operations & People", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click(screen.getByRole("radio", { name: "Temporary" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Requests" }, { timeout: 5000 }));
    // Chidera's remote day waits on Cynthia as their line manager.
    fireEvent.click(await screen.findByText("WLR-0003 · Remote Day"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Reject" }));
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(within(dialog).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Approved by the line manager, it now waits on Operations & People, which Cynthia also is.
    let flow = await api.call("GET /api/v1/attendance/requests", { query: { q: "WLR-0003" } });
    expect(flow.data[0]).toMatchObject({ status: "submitted", waiting_on: "Operations & People", can_decide: true });
    fireEvent.click(await screen.findByText("WLR-0003 · Remote Day"));
    dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/^Approved by/);
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(screen.queryByText("WLR-0003 · Remote Day")).toBeNull());
    flow = await api.call("GET /api/v1/attendance/requests", { query: { q: "WLR-0003" } });
    expect(flow.data[0]).toMatchObject({ status: "approved", waiting_on: null, can_decide: false });
  }, 30000);
});
