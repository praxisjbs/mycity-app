// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Vacancy } from "./Vacancy";

/** A vacancy on the in-browser mock: its text as blocks, its facts, and Apply for This Role. */
const draw = (slug: string) =>
  render(
    <RouterProvider>
      <Vacancy slug={slug} />
    </RouterProvider>,
  );

describe("Vacancy", () => {
  it("shows the role's facts and its text under the guide's headings", async () => {
    draw("head-sales-revenue-lagos");
    expect(await screen.findByRole("heading", { level: 1, name: "Head, Sales & Revenue" })).toBeTruthy();
    const chips = screen.getByRole("list", { name: "About the role" });
    for (const fact of ["Lagos, Nigeria", "Hybrid, 2 days in office, 3 from home", "Full Time"]) expect(within(chips).getByText(fact)).toBeTruthy();
    /* The job description gives no band, so none shows. */
    expect(within(chips).queryByText(/₦/)).toBeNull();
    for (const h of ["About MyCityApp", "Role Overview", "Required Experience and Qualifications", "What We Are Looking For", "How We Hire"])
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeTruthy();
    /* The description's own headings sit one level under the section's. */
    expect(screen.getByRole("heading", { level: 3, name: "Key Responsibilities" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "8. Sales Process & Systems" })).toBeTruthy();
    expect(screen.getByText("Chief Executive Officer")).toBeTruthy();
    expect(screen.getByText("Monday to Saturday")).toBeTruthy();
    expect(screen.getByText("At least 8 years")).toBeTruthy();
    const route = screen.getByRole("list", { name: "How We Hire" });
    expect(within(route).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Apply", "Screening", "Assessment", "Interview"].map((s) => expect.stringContaining(s)));
    expect(screen.getAllByText("23 people have applied").length).toBeGreaterThan(0);
  });

  it("Apply for This Role mints a link and opens the form on it", async () => {
    draw("partnerships-associate-lagos");
    const [apply] = await screen.findAllByRole("button", { name: "Apply for This Role" });
    fireEvent.click(apply!);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/apply\/[A-Za-z0-9]{12}$/));
  });

  it("a paused role keeps its page, says so and takes no applications", async () => {
    draw("studio-assistant-lagos");
    expect(await screen.findByText("This role is not taking applications right now. This link works again if it reopens.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply for This Role" })).toBeNull();
    expect(screen.getByRole("button", { name: "See Open Roles" })).toBeTruthy();
  });

  it("a filled role says so; an unknown address is Role Not Found", async () => {
    const { unmount } = draw("customer-support-lead");
    expect(await screen.findByText("This role has been filled. Thank you to everyone who applied.")).toBeTruthy();
    unmount();
    draw("no-such-role");
    expect(await screen.findByRole("heading", { name: "Role Not Found" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("head-sales-revenue-lagos");
    await screen.findByRole("heading", { level: 1, name: "Head, Sales & Revenue" });
    await waitFor(() => expect(container.querySelector('[data-city="lagos"]')).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
