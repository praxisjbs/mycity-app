import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { KeyValue } from "./KeyValue";

describe("KeyValue", () => {
  it("draws a description list from the merged tuples", () => {
    const { container } = render(
      <KeyValue
        items={[
          ["Department", "Field Sales"],
          ["Worksite", "Lekki"],
        ]}
      />,
    );
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    const dd = screen.getByText("Field Sales");
    expect(dd.tagName).toBe("DD");
    expect(dd).toHaveAttribute("data-copy", "content");
  });

  it("takes objects and shows EmptyValue for a value that is not set, but keeps zero", () => {
    render(
      <KeyValue
        items={[
          { label: "Line Manager", value: null },
          { label: "Phone", value: "" },
          { label: "Days Carried", value: 0, key: "carried" },
        ]}
      />,
    );
    expect(screen.getAllByRole("img", { name: "Not set" })).toHaveLength(2);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("stacks labels over values when asked", () => {
    const { container } = render(<KeyValue layout="stacked" items={[["Start Date", "13/10/2026"]]} />);
    expect(container.querySelector("dl")?.className).not.toContain("desk:grid-cols-5");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <KeyValue
        items={[
          ["Department", "Field Sales"],
          ["Line Manager", null],
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
