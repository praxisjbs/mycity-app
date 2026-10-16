import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { ComingSoon } from "./ComingSoon";

describe("ComingSoon", () => {
  it("names itself Coming Soon, with the milestone, a line and what the screen will do", () => {
    render(<ComingSoon milestone="Milestone 2 · 06/11/2026" line="Opens with Milestone 2." features={["Your KPIs for the month", "Your goal chain"]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Coming Soon" })).toBeInTheDocument();
    expect(screen.getByText("Milestone 2 · 06/11/2026")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows no milestone to a stranger, and takes one action", async () => {
    const onClick = vi.fn();
    render(<ComingSoon line="Careers opens here soon." action={<Button onClick={onClick}>See Full Design</Button>} />);
    expect(screen.queryByText(/Milestone/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "See Full Design" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ComingSoon milestone="Milestone 1 · 30/10/2026" line="Opens with Milestone 1." features={["Your record as People sees it"]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
