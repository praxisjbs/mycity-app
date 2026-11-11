import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SectionNav } from "./SectionNav";

const ITEMS = [
  { id: "public-home", label: "The Front Page", icon: "home" as const },
  { id: "public-apply", label: "Apply", icon: "doc" as const },
  { id: "public-verify", label: "Verify a Document", icon: "shield" as const },
];

function Page({ variant }: { variant?: "column" | "bar" }) {
  return (
    <>
      <SectionNav label="Help Contents" title="On This Page" items={ITEMS} variant={variant} />
      {ITEMS.map((i) => (
        <h2 key={i.id} id={i.id}>
          {i.label}
        </h2>
      ))}
    </>
  );
}

describe("SectionNav", () => {
  it("links every section and marks the first as the one in view at the top of the page", () => {
    render(<Page />);
    const nav = screen.getByRole("navigation", { name: "Help Contents" });
    expect(nav).toHaveAttribute("data-variant", "column");
    expect(screen.getByRole("link", { name: "Apply" })).toHaveAttribute("href", "#public-apply");
    expect(screen.getByRole("link", { name: "The Front Page" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("heading", { name: "On This Page" })).toBeInTheDocument();
  });

  it("scrolls to the section pressed and marks it, without leaving the page", async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    render(<Page />);
    await userEvent.click(screen.getByRole("link", { name: "Verify a Document" }));
    expect(into).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByRole("link", { name: "Verify a Document" })).toHaveAttribute("aria-current", "location");
    expect(window.location.hash).toBe("#public-verify");
  });

  it("draws the bar with no heading", () => {
    render(<Page variant="bar" />);
    expect(screen.getByRole("navigation")).toHaveAttribute("data-variant", "bar");
    expect(screen.queryByRole("heading", { name: "On This Page" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Page />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
