import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Pill } from "./Pill";
import { Tile } from "./Tile";

describe("Tile", () => {
  it("draws its heading, its line and what sits under them", () => {
    render(
      <Tile title="Attendance Month" text="Every clocking for one month.">
        <Pill>Excel</Pill>
      </Tile>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Attendance Month" })).toBeInTheDocument();
    expect(screen.getByText("Every clocking for one month.")).toBeInTheDocument();
    expect(screen.getByText("Excel")).toBeInTheDocument();
  });

  it("drops to h3 inside a section that has its own heading", () => {
    render(<Tile title="Attendance Month" level={3} />);
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });

  it("marks its title as a title for the copy gates", () => {
    render(<Tile title="Attendance Month" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("data-ui", "title");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Tile title="Attendance Month" text="Every clocking for one month.">
        <Pill>Excel</Pill>
      </Tile>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
