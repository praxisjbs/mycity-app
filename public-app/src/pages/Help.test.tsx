// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Help } from "./Help";

/** Help on the in-browser mock: the real chapter, docs/manual/public-site.md, as the API cuts it. */
const draw = () =>
  render(
    <RouterProvider>
      <Help />
    </RouterProvider>,
  );

afterEach(() => window.history.replaceState({}, "", "/"));

describe("Help", () => {
  it("shows every section of the public chapter, with its contents beside it", async () => {
    draw();
    expect(await screen.findByRole("heading", { level: 2, name: "The Front Page" })).toBeTruthy();
    for (const title of ["Open Roles", "A Vacancy", "Apply", "Assessment", "Sign Offer", "Verify a Document"])
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Help Sections" })).getAllByRole("link")).toHaveLength(7);
    expect(within(screen.getByRole("navigation", { name: "Help Contents" })).getByRole("link", { name: "Apply" }).getAttribute("href")).toBe("#public-apply");
  });

  it("opens the site's own pages in place, and another section by scrolling to it", async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    draw();
    await screen.findByRole("heading", { level: 2, name: "The Front Page" });
    const front = screen.getAllByRole("link", { name: "the front page" })[0]!;
    expect(front.getAttribute("href")).toBe("/");
    expect(front.hasAttribute("target")).toBe(false);
    fireEvent.click(screen.getAllByRole("link", { name: "The open roles" })[0]!);
    expect(into).toHaveBeenCalled();
    expect(window.location.hash).toBe("#public-careers");
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    await screen.findByRole("heading", { level: 2, name: "The Front Page" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
