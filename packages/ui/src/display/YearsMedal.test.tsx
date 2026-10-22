import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { YearsMedal } from "./YearsMedal";

describe("YearsMedal", () => {
  it("shows the years inside the laurel and names them once for assistive technology", () => {
    const { container } = render(<YearsMedal years={3} />);
    expect(screen.getByRole("img", { name: "3 years at MyCity" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("years")).toBeInTheDocument();
    // Seven pairs of leaves and a tip on each branch, and both stems.
    expect(container.querySelectorAll("svg path")).toHaveLength(2 * (7 * 2 + 1 + 1));
  });

  it("says year for one", () => {
    render(<YearsMedal years={1} />);
    expect(screen.getByRole("img", { name: "1 year at MyCity" })).toBeInTheDocument();
    expect(screen.getByText("year")).toBeInTheDocument();
  });

  it("holds a star when the years are not known", () => {
    render(<YearsMedal years={null} />);
    expect(screen.getByRole("img", { name: "Another year at MyCity" })).toBeInTheDocument();
    expect(screen.queryByText("years")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div className="bg-secondary">
        <YearsMedal years={5} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
