// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Careers } from "./Careers";

/**
 * Careers on the in-browser mock: nine roles take applications (a paused, a closed and a filled one
 * do not), so the search box shows; the Lagos skyline heads the page.
 */
const draw = () =>
  render(
    <RouterProvider>
      <Careers />
    </RouterProvider>,
  );

const cards = () => within(screen.getByRole("region", { name: "Open Roles" })).queryAllByRole("link");

describe("Careers", () => {
  it("opens on Work With Us and lists only the roles taking applications, each a link to its page", async () => {
    draw();
    expect(screen.getByRole("heading", { level: 1, name: "Work With Us" })).toBeTruthy();
    await waitFor(() => expect(cards()).toHaveLength(9));
    const role = screen.getByRole("link", { name: "Head, Sales & Revenue" });
    expect(role.getAttribute("href")).toBe("/jobs/head-sales-revenue-lagos");
    /* Paused, filled, closed, past its closing day, or a draft: none of them is listed. */
    for (const t of ["Customer Support Lead", "Partnerships Associate", "Events Coordinator", "Content Producer", "Backend Engineer"]) expect(screen.queryByText(t)).toBeNull();
    const card = role.closest("li")!;
    expect(within(card).getByText("Marketing & Sales")).toBeTruthy();
    expect(within(card).getByText("Lekki Phase 1, Lagos")).toBeTruthy();
    expect(within(card).getByText("Hybrid")).toBeTruthy();
  });

  it("shows a search above more than 8 roles, which the server narrows", async () => {
    draw();
    const box = await screen.findByRole("searchbox", { name: "Search Roles" });
    fireEvent.change(box, { target: { value: "Abuja" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByRole("link", { name: "City Editor, Abuja" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "astronaut" } });
    expect(await screen.findByText("No Matching Roles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));
    await waitFor(() => expect(cards()).toHaveLength(9));
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    await waitFor(() => expect(cards()).toHaveLength(9));
    expect(await axe(container)).toHaveNoViolations();
  });
});
