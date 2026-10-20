import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ICON_NAMES, Icon } from "./Icon";

describe("Icon", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Icon name="clock" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg?.getAttribute("class")).toContain("size-4");
  });

  it("is a named image with a label", () => {
    render(<Icon name="alert" size="m" label="Late" />);
    const img = screen.getByRole("img", { name: "Late" });
    expect(img.getAttribute("class")).toContain("size-5");
  });

  it("draws every name the screens use, in currentColor", () => {
    const { container } = render(
      <div>
        {ICON_NAMES.map((n) => (
          <Icon key={n} name={n} size="l" />
        ))}
      </div>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(ICON_NAMES.length);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("stroke", "currentColor"));
    // The whole set, so a glyph is never added without a screen that needs it.
    expect(ICON_NAMES).toHaveLength(90);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("lets a class override the size box", () => {
    const { container } = render(<Icon name="pin" className="size-7 text-primary" />);
    const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(cls).toContain("size-7");
    expect(cls).not.toContain("size-4");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        <Icon name="ok" label="Approved" /> Leave Request
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
