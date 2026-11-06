// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Careers } from "./Careers";

/**
 * Careers on the in-browser mock: the approved design's twelve roles take applications (a paused, a
 * filled, a closed one and one past its day do not), in seven teams; the server narrows by search and
 * by one department.
 */
const draw = (at = "/jobs") => {
  window.history.replaceState({}, "", at);
  return render(
    <RouterProvider>
      <Careers />
    </RouterProvider>,
  );
};

afterEach(() => window.history.replaceState({}, "", "/"));

const roles = () => screen.queryAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/jobs/"));

/** The words a link is described by (aria-describedby). */
const described = (el: Element) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("Careers", () => {
  it("opens on Open Roles with its line, and lists only the roles taking applications, closing soonest first", async () => {
    draw();
    expect(screen.getByRole("heading", { level: 1, name: "Open Roles" })).toBeTruthy();
    expect(await screen.findByText("12 roles across 7 teams, in Lagos and Abuja.")).toBeTruthy();
    await waitFor(() => expect(roles()).toHaveLength(12));
    expect(document.getElementById(roles()[0]!.getAttribute("aria-labelledby")!)?.textContent).toBe("Operations Intern");
    const role = screen.getByRole("link", { name: "Head, Sales & Revenue" });
    expect(role.getAttribute("href")).toBe("/jobs/head-sales-revenue-lagos");
    expect(described(role)).toMatch(/^Marketing & Sales\. Lekki Phase 1, Lagos\. Hybrid, 2 days in office\. Full Time\. Closes \d{2}\/\d{2}\/\d{4}$/);
    for (const t of ["Video Editor", "Studio Assistant", "Events Coordinator", "Copywriter", "Backend Engineer"]) expect(screen.queryByText(t)).toBeNull();
    expect(screen.getByText("Closing soonest first")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Recommend them" }).getAttribute("href")).toBe("/#refer");
  });

  it("narrows to one team at a time, with its count, and back to All Teams", async () => {
    draw();
    const teams = await screen.findByRole("list", { name: "Teams" });
    await within(teams).findByRole("button", { name: "Marketing & Sales 4" });
    expect(within(teams).getByRole("button", { name: "All Teams 12" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(teams).getByRole("button", { name: "Marketing & Sales 4" }));
    await waitFor(() => expect(roles()).toHaveLength(4));
    expect(screen.getByText(/Showing/).textContent).toBe("Showing 4 of 12");
    fireEvent.click(within(teams).getByRole("button", { name: "All Teams 12" }));
    await waitFor(() => expect(roles()).toHaveLength(12));
  });

  it("searches on the server, says when nothing matches, and Clear Search brings every role back", async () => {
    draw();
    const box = screen.getByRole("searchbox", { name: "Search Roles" });
    fireEvent.change(box, { target: { value: "Abuja" } });
    await waitFor(() => expect(roles()).toHaveLength(1));
    expect(screen.getByRole("link", { name: "City Editor, Abuja" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "astronaut" } });
    expect(await screen.findByText("No Matching Roles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));
    await waitFor(() => expect(roles()).toHaveLength(12));
  });

  it("opens narrowed by the address: the index's search and a team's code", async () => {
    const first = draw("/jobs?q=Abuja");
    await waitFor(() => expect(roles()).toHaveLength(1));
    expect((screen.getByRole("searchbox", { name: "Search Roles" }) as HTMLInputElement).value).toBe("Abuja");
    first.unmount();
    draw("/jobs?department=STU");
    await waitFor(() => expect(roles()).toHaveLength(2));
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    await waitFor(() => expect(roles()).toHaveLength(12));
    expect(await axe(container)).toHaveNoViolations();
  });
});
