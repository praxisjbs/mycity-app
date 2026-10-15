import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Grid } from "./Grid";

const cells = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>Cell {i + 1}</div>);

describe("Grid", () => {
  it("collapses to one column and opens up at the desktop widths", () => {
    const { container } = render(<Grid cols={4}>{cells(4)}</Grid>);
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).toContain("grid-cols-1");
    expect(cls).toContain("xl:grid-cols-4");
    expect(cls).toContain("mb-3");
  });

  it("keeps two columns on a phone for KPI tiles, by the new and the merged name", () => {
    const a = render(<Grid cols={4} phoneCols={2}>{cells(4)}</Grid>);
    const b = render(<Grid cols="4m2">{cells(4)}</Grid>);
    for (const r of [a, b]) {
      const cls = r.container.firstElementChild?.className ?? "";
      expect(cls).toContain("grid-cols-2");
      expect(cls).not.toMatch(/(^|\s)grid-cols-1(\s|$)/);
    }
  });

  it("draws the uneven pairs on a 12-column track, without arbitrary values", () => {
    const { container } = render(<Grid cols="1.4/1" flush>{cells(2)}</Grid>);
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).toContain("xl:grid-cols-12");
    expect(cls).toContain("xl:*:odd:col-span-7");
    expect(cls).not.toContain("[");
    expect(cls).not.toContain("mb-3");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Grid cols={2}>{cells(2)}</Grid>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
