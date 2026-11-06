// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Home } from "./Home";

/**
 * The index on the in-browser mock: the design's twelve open roles in seven teams, in Lagos and
 * Abuja. The figures, the pill and Closing Soon come from /jobs/summary; the rest is the page's own.
 */
const draw = () =>
  render(
    <RouterProvider>
      <Home />
    </RouterProvider>,
  );

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

/** The words a link is described by (aria-describedby). */
const described = (el: Element) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("Home", () => {
  it("opens on Work With Us with the hiring pill and the three figures from the summary", async () => {
    draw();
    const h1 = screen.getByRole("heading", { level: 1, name: "Work With Us" });
    expect(h1.querySelector("em")?.textContent).toBe("Us");
    expect(await screen.findByText("Hiring in Lagos and Abuja")).toBeTruthy();
    const figures = screen.getByText("Open Roles", { selector: "dt" }).closest("dl")!;
    expect(within(figures).getByText("Open Roles").nextElementSibling?.textContent).toContain("12");
    expect(within(figures).getByText("Teams Hiring").nextElementSibling?.textContent).toContain("7");
    expect(within(figures).getByText("Cities").nextElementSibling?.textContent).toContain("2");
  });

  it("draws What We Build with About MyCityApp, Closing Soon's three roles, How We Hire and the two calls", async () => {
    draw();
    expect(screen.getByRole("heading", { level: 2, name: "One App, Every City" })).toBeTruthy();
    expect(await screen.findByText(/MyCityApp is a digital city and lifestyle platform/)).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Visit MyCityApp" }).getAttribute("href")).toBe("https://mycityapp.io");
    for (const t of ["Discover Places", "Find What's On", "Grow Businesses", "City Services"]) expect(screen.getByRole("heading", { level: 3, name: t })).toBeTruthy();
    const soon = await screen.findByRole("list", { name: "Closing Soon" });
    const links = within(soon).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/jobs/operations-intern-lagos", "/jobs/head-sales-revenue-lagos", "/jobs/graphics-and-motion-designer-lagos"]);
    expect(described(links[0]!)).toMatch(/^Operations & People\. Lekki Phase 1, Lagos\. Closes \d{2}\/\d{2}\/\d{4}\.$/);
    expect(screen.getByRole("link", { name: "See All Roles" }).getAttribute("href")).toBe("/jobs");
    const hire = screen.getByRole("list", { name: "How We Hire" });
    expect(within(hire).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Apply", "Screening", "Assessment", "Interview"]);
    expect(document.getElementById("hire")).not.toBeNull();
    expect(document.getElementById("refer")).not.toBeNull();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Verify a Document" }).getAttribute("href")).toBe("/verify");
  });

  it("Search Roles opens Careers on what was typed", async () => {
    draw();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Roles" }), { target: { value: "Abuja" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Roles" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/jobs?q=Abuja"));
  });

  it("Copy Careers Link copies the careers page and says so", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Copy Careers Link" }));
    expect(await screen.findByRole("button", { name: "Link Copied" })).toBeTruthy();
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/jobs`);
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    await screen.findByRole("list", { name: "Closing Soon" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
