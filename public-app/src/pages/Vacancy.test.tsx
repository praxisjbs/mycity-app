// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Vacancy } from "./Vacancy";

/** A vacancy on the in-browser mock: its hero, its text part by part, The Role card, More Roles and Apply. */
const draw = (slug: string) =>
  render(
    <RouterProvider>
      <Vacancy slug={slug} />
    </RouterProvider>,
  );

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Vacancy", () => {
  it("heads the role with All Roles, its team, its facts with the closing date, and its actions", async () => {
    draw("head-sales-revenue-lagos");
    expect(await screen.findByRole("heading", { level: 1, name: "Head, Sales & Revenue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All Roles" }).getAttribute("href")).toBe("/jobs");
    const chips = screen.getByRole("list", { name: "About the role" });
    for (const fact of ["Lekki Phase 1, Lagos", "Hybrid, 2 days in office", "Full Time"]) expect(within(chips).getByText(fact)).toBeTruthy();
    expect(within(chips).getByText(/^Closes \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
    /* The job description gives no band, so none shows. */
    expect(within(chips).queryByText(/₦/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Apply for This Role" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Share Role" })).toBeTruthy();
    expect(screen.getAllByText("12 people have applied").length).toBeGreaterThan(0);
  });

  it("draws its text part by part: the overview, its KPIs as tiles, what it asks, the statement and How We Hire", async () => {
    draw("head-sales-revenue-lagos");
    await screen.findByRole("heading", { level: 1, name: "Head, Sales & Revenue" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).slice(0, 6)).toEqual([
      "Role Overview",
      "Key Performance Indicators (KPIs)",
      "Required Experience and Qualifications",
      "What We Are Looking For",
      "How We Hire",
      "The Role",
    ]);
    /* About MyCityApp is the index's now, never each role's. */
    expect(screen.queryByRole("heading", { name: "About MyCityApp" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Key Responsibilities" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "8. Sales Process & Systems" })).toBeTruthy();
    const kpis = screen.getByRole("list", { name: "Key Performance Indicators (KPIs)" });
    expect(within(kpis).getAllByRole("listitem")).toHaveLength(11);
    expect(within(kpis).getByText("Value of closed deals")).toBeTruthy();
    expect(screen.getByText("We are looking for a commercial leader, not simply a sales administrator.").closest("blockquote")).toBeTruthy();
    const route = screen.getByRole("list", { name: "How We Hire" });
    expect(within(route).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Apply", "2Screening", "3Assessment", "4Interview"]);
  });

  it("names the role's facts on The Role card, and More Roles of its team without this one", async () => {
    draw("head-sales-revenue-lagos");
    const card = await screen.findByRole("region", { name: "The Role" });
    for (const [k, v] of [["Employment", "Full Time"], ["Working Days", "Monday to Saturday"], ["Experience", "At least 8 years"], ["Reports To", "Chief Executive Officer"], ["Probation", "6 months"]])
      expect(within(card).getByText(k).nextElementSibling?.textContent).toBe(v);
    expect(within(card).getByText(/^Closes \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
    const more = await screen.findByRole("list", { name: "More Roles" });
    expect(within(more).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Marketing & SalesPartnerships AssociateLekki Phase 1, Lagos. Hybrid.Marketing & Sales. Lekki Phase 1, Lagos. Hybrid.",
      "Marketing & SalesSocial Media ManagerLekki Phase 1, Lagos. Hybrid.Marketing & Sales. Lekki Phase 1, Lagos. Hybrid.",
      "Marketing & SalesCommunity ManagerLekki Phase 1, Lagos. Hybrid.Marketing & Sales. Lekki Phase 1, Lagos. Hybrid.",
    ]);
  });

  it("Share Role and Copy Role Link copy the role's link and say so", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    draw("head-sales-revenue-lagos");
    fireEvent.click(await screen.findByRole("button", { name: "Copy Role Link" }));
    expect(await screen.findByRole("button", { name: "Link Copied" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share Role" })).toBeTruthy();
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/jobs/head-sales-revenue-lagos`);
  });

  it("a description that opens with its own Role Overview heading shows it once", async () => {
    draw("graphics-and-motion-designer-lagos");
    await screen.findByRole("heading", { level: 1, name: "Graphics and Motion Designer" });
    expect(screen.getAllByRole("heading", { name: "Role Overview" })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3, name: "Key Responsibilities" })).toBeTruthy();
  });

  it("Apply for This Role mints a link and opens the form on it; the phone's bar carries Apply too", async () => {
    draw("graphics-and-motion-designer-lagos");
    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    const [apply] = screen.getAllByRole("button", { name: "Apply for This Role" });
    fireEvent.click(apply!);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/apply\/[A-Za-z0-9]{12}$/));
  });

  it("a paused role keeps its page, says so and takes no applications", async () => {
    draw("video-editor-lagos");
    expect(await screen.findByText("This role is not taking applications right now. This link works again if it reopens.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply for This Role" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByRole("button", { name: "See Open Roles" })).toBeTruthy();
  });

  it("a filled role says so, a role past its closing day reads closed, an unknown address is Role Not Found", async () => {
    const filled = draw("studio-assistant-lagos");
    expect(await screen.findByText("This role has been filled. Thank you to everyone who applied.")).toBeTruthy();
    filled.unmount();
    const past = draw("copywriter-lagos");
    expect(await screen.findByText("This role has closed. Our other open roles are on the careers page.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply for This Role" })).toBeNull();
    past.unmount();
    draw("no-such-role");
    expect(await screen.findByRole("heading", { level: 2, name: "Role Not Found" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("head-sales-revenue-lagos");
    await screen.findByRole("list", { name: "More Roles" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
