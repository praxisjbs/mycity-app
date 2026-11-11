// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Proposal } from "./Proposal";

/**
 * Public · Proposal on the in-browser mock: Hn5vR2qLx8Tc is a sent proposal (the kit's sample),
 * Wd3kP9sMb6Ye stands for one declined, expired or withdrawn.
 */
const draw = (token: string) =>
  render(
    <RouterProvider>
      <Proposal token={token} />
    </RouterProvider>,
  );

describe("Proposal", () => {
  it("shows the proposal as designed, its owner's contact and Download PDF", async () => {
    draw("Hn5vR2qLx8Tc");
    expect(await screen.findByRole("heading", { level: 1, name: "Selling Out Harmattan Jazz Weekend, Together" })).toBeTruthy();
    expect(screen.getByText("Prepared for Harmattan Jazz Weekend")).toBeTruthy();
    const frame = screen.getByLabelText("Selling Out Harmattan Jazz Weekend, Together", { selector: "iframe" }) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("PRO-0012");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    const card = screen.getByRole("region", { name: "Your Contact" });
    expect(within(card).getByText("Ngozi Eze")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "ngozi.eze@mycityapp.io" }).getAttribute("href")).toBe("mailto:ngozi.eze@mycityapp.io");
    const pdf = screen.getAllByRole("link", { name: "Download PDF" });
    expect(pdf.length).toBeGreaterThan(0);
    for (const a of pdf) expect(a.getAttribute("href")).toBe("/api/public/v1/proposals/Hn5vR2qLx8Tc/pdf");
    expect(screen.getByRole("link", { name: "Email Ngozi" })).toBeTruthy();
  });

  it("a link that no longer works says so, and offers no way to the job board", async () => {
    draw("Wd3kP9sMb6Ye");
    expect(await screen.findByRole("heading", { name: "This Link Does Not Open" })).toBeTruthy();
    expect(screen.getByText("This proposal is no longer available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See Open Roles" })).toBeNull();
  });

  it("is never indexed", async () => {
    draw("Hn5vR2qLx8Tc");
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe("noindex, nofollow");
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("Hn5vR2qLx8Tc");
    await screen.findByRole("heading", { level: 1 });
    /* The kit's own pages are checked by its visual gate (scripts/check/proposal-kit.js); here, the page around them. */
    expect(await axe(container, {}, { iframes: false })).toHaveNoViolations();
  });
});
