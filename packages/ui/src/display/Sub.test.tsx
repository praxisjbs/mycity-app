import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Sub } from "./Sub";

describe("Sub", () => {
  it("is a span in a line by default", () => {
    render(<Sub>Updated 13/10/2026</Sub>);
    expect(screen.getByText("Updated 13/10/2026").tagName).toBe("SPAN");
  });

  it("can be a paragraph on its own", () => {
    render(<Sub as="p">Updated 13/10/2026</Sub>);
    expect(screen.getByText("Updated 13/10/2026").tagName).toBe("P");
  });

  it("marks a record's own value as content, so the copy gates skip it", () => {
    render(
      <Sub record as="p">
        Financial Controller
      </Sub>,
    );
    expect(screen.getByText("Financial Controller")).toHaveAttribute("data-copy", "content");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Sub as="p">Updated 13/10/2026</Sub>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
