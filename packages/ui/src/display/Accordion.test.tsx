import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Accordion } from "./Accordion";

const ITEMS = [
  { title: "How do I claim overtime?", body: "Open My Attendance and add the hours to the day." },
  { title: "When is payday?", body: "The 25th, or the working day before it." },
];

describe("Accordion", () => {
  it("is closed on arrival and opens on a press", async () => {
    render(<Accordion items={ITEMS} />);
    const first = screen.getByText("How do I claim overtime?").closest("details")!;
    expect(first.open).toBe(false);
    await userEvent.click(screen.getByText("How do I claim overtime?"));
    expect(first.open).toBe(true);
  });

  it("lets the first item arrive open where the screen is about that one thing", () => {
    render(<Accordion items={[{ ...ITEMS[0]!, open: true }, ITEMS[1]!]} />);
    expect(screen.getByText("How do I claim overtime?").closest("details")!.open).toBe(true);
    expect(screen.getByText("When is payday?").closest("details")!.open).toBe(false);
  });

  it("is marked as content, since questions and answers are written, not interface copy", () => {
    render(<Accordion items={ITEMS} />);
    expect(screen.getByText("When is payday?").closest("details")).toHaveAttribute("data-copy", "content");
  });

  it("gives each row a 44 px target on a phone", () => {
    render(<Accordion items={ITEMS} />);
    expect(screen.getByText("When is payday?").className).toContain("phone:min-h-tap");
  });

  it("has no accessibility violations, closed and open", async () => {
    const { container } = render(<Accordion items={ITEMS} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByText("When is payday?"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
