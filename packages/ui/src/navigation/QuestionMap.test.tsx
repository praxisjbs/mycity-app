import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { QuestionMap } from "./QuestionMap";

describe("QuestionMap", () => {
  it("marks the question in hand and the answered ones, and moves to the one pressed", async () => {
    const onPick = vi.fn();
    render(<QuestionMap label="Questions" count={3} at={1} answered={[true, false, false]} onPick={onPick} />);
    expect(screen.getByRole("group", { name: "Questions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 1, answered" })).toHaveAttribute("data-answered");
    expect(screen.getByRole("button", { name: "Question 2" })).toHaveAttribute("aria-current", "step");
    await userEvent.click(screen.getByRole("button", { name: "Question 3" }));
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<QuestionMap label="Questions" count={3} at={0} answered={[false, true, false]} onPick={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
