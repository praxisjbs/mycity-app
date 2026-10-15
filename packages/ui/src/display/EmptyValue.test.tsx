import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { EmptyValue, isEmptyValue } from "./EmptyValue";

describe("EmptyValue", () => {
  it("draws the one dash, muted, named Not set", () => {
    render(<EmptyValue />);
    const mark = screen.getByRole("img", { name: "Not set" });
    expect(mark.textContent).toBe("\u2014");
    expect(mark.className).toContain("text-subtle-foreground");
  });

  it("takes a plainer label", () => {
    render(<EmptyValue label="No end date" />);
    expect(screen.getByRole("img", { name: "No end date" })).toBeInTheDocument();
  });

  it("knows what is not set, and that zero is a value", () => {
    expect([null, undefined, "", "  ", false].every(isEmptyValue)).toBe(true);
    expect([0, "0", "0.00", "Lagos"].some(isEmptyValue)).toBe(false);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        Manager <EmptyValue />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
