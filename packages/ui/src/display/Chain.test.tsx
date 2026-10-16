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

  it("has no accessibility violations", async () => {
    const { container } = render(<Chain steps={STEPS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
