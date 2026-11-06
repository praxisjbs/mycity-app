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

  it("rows and tiles: the public site's pairs, the value as content", () => {
    const { container, rerender } = render(<KeyValue layout="rows" items={[{ label: "Employment", value: "Full Time" }, { label: "Probation", value: null }]} />);
    expect(container.firstElementChild).toHaveClass("ps-kv");
    expect(screen.getByText("Full Time")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Probation").nextElementSibling?.textContent).not.toBe("");
    rerender(<KeyValue layout="tiles" items={[["Type", "Case Study"], ["Time", "60 minutes"], ["Questions", 3]]} />);
    expect(container.firstElementChild).toHaveClass("ps-kv-tiles");
    expect(screen.getByText("60 minutes").tagName).toBe("DD");
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
