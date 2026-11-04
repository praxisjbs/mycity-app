import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { AnswerBubble, QuestionBubble } from "./AnswerBubble";
import { SourceChip } from "./SourceChip";

describe("AnswerBubble", () => {
  it("shows the words as content, the paging, Show Next 25 and the screen button", async () => {
    const onNext = vi.fn(async () => undefined);
    const onOpen = vi.fn();
    render(<AnswerBubble text="Two requests wait on you." paging="Showing 25 of 312" onNext={onNext} link={{ label: "Open Leave", onOpen }} />);
    const bubble = screen.getByRole("article", { name: "Answer" });
    expect(bubble.querySelector('[data-copy="content"]')!.textContent).toBe("Two requests wait on you.");
    expect(screen.getByText("Showing 25 of 312")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show Next 25" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Open Leave" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a question's answers are taps: one is asked, the others wait until it lands, and none show without onChoose", async () => {
    let land: () => void = () => undefined;
    const onChoose = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
    const { rerender } = render(<AnswerBubble text="When is it due?" choices={["Today", "Tomorrow", "Friday", "No Due Day"]} onChoose={onChoose} />);
    const group = screen.getByRole("group", { name: "Answers" });
    expect(group).toHaveAttribute("data-copy", "content");
    await userEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(onChoose).toHaveBeenCalledWith("Friday");
    // One press, one request (F26): while it runs, a second tap on any choice is refused.
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    land();
    await waitFor(() => expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-busy", "true"));
    rerender(<AnswerBubble text="When is it due?" choices={["Today"]} />);
    expect(screen.queryByRole("group", { name: "Answers" })).toBeNull();
  });

  it("Open Figures opens the pane, and goes away once this answer's pane is the one shown", async () => {
    const onPane = vi.fn();
    const { rerender } = render(<AnswerBubble text="Seven late arrivals." onPane={onPane} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Figures" }));
    expect(onPane).toHaveBeenCalledTimes(1);
    rerender(<AnswerBubble text="Seven late arrivals." onPane={onPane} paneOpen />);
    expect(screen.queryByRole("button", { name: "Open Figures" })).toBeNull();
    expect(screen.getByRole("article", { name: "Answer" })).toHaveAttribute("aria-current", "true");
  });

  it("Helpful is pressed and taken back; Not Helpful waits while it runs", async () => {
    const onFeedback = vi.fn(async () => undefined);
    const { rerender } = render(<AnswerBubble text="Nobody is late." feedback={null} onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole("button", { name: "Helpful" }));
    expect(onFeedback).toHaveBeenCalledWith("up");
    rerender(<AnswerBubble text="Nobody is late." feedback="up" onFeedback={onFeedback} />);
    expect(screen.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(onFeedback).toHaveBeenLastCalledWith(null));
  });

  it("From carries the chips, and the question is the person's own bubble", () => {
    render(
      <>
        <QuestionBubble words="Who is late?" />
        <AnswerBubble text="Four people." from={<SourceChip label="employee" count={4} />} />
      </>,
    );
    expect(screen.getByText("Who is late?")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("employee ×4")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <AnswerBubble text="Two requests wait on you." paging="Showing 2 of 2" link={{ label: "Open Leave", onOpen: () => undefined }} from={<SourceChip label="leave request" count={2} />} feedback={null} onFeedback={() => undefined} onPane={() => undefined} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
