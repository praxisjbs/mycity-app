import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Chain } from "./Chain";

const STEPS = [
  { label: "Submitted", state: "done" as const },
  { label: "Line Manager", state: "now" as const },
  { label: "Finance" },
];

describe("Chain", () => {
  it("reads as an ordered, named route", () => {
    render(<Chain steps={STEPS} label="Claim Route" />);
    expect(screen.getByRole("list", { name: "Claim Route" }).tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says in words where the route waits and what is done, never colour alone", () => {
    render(<Chain steps={STEPS} />);
    expect(screen.getByText(", waiting here")).toBeInTheDocument();
    expect(screen.getByText(", done")).toBeInTheDocument();
  });

  it("draws the steps still to come plainly", () => {
    render(<Chain steps={STEPS} />);
    expect(screen.getByText("Finance").closest("span")!.className).toContain("text-subtle-foreground");
  });

  it("stacks its steps one under another, an arrow down between each", () => {
    render(<Chain steps={STEPS} stack />);
    expect(screen.getByRole("list").className).toContain("flex-col");
    expect(screen.getAllByRole("listitem")[1].className).toContain("flex-col");
  });

  it("has no accessibility violations, in a row and stacked", async () => {
    const { container } = render(
      <>
        <Chain steps={STEPS} />
        <Chain steps={STEPS} stack label="Run Route" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
