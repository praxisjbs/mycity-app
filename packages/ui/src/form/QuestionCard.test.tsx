import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { QuestionCard, moneyOf } from "./QuestionCard";

describe("QuestionCard", () => {
  it("asks the question, offers Claude's suggestion with where it came from, and keeps it", async () => {
    const onAnswer = vi.fn(async () => undefined);
    render(
      <QuestionCard group="Audience and Reach" question="How many guests do they expect each night?" kind="number" suggested={1500} suggestedFrom="From the transcript, 00:21:51" required state="open" onAnswer={onAnswer} />,
    );
    expect(screen.getByText("How many guests do they expect each night?")).toBeInTheDocument();
    expect(screen.getByText("From the transcript, 00:21:51")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Use Suggestion" }));
    expect(onAnswer).toHaveBeenCalledWith(1500);
  });

  it("refuses an empty answer on the field, and sends money as the API reads it", async () => {
    const onAnswer = vi.fn(async () => undefined);
    render(<QuestionCard group="Money" question="What is the early bird price?" kind="money" state="open" onAnswer={onAnswer} onSkip={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save Answer" }));
    expect(screen.getByText("Give an answer")).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("textbox"), "12,000");
    await userEvent.click(screen.getByRole("button", { name: "Save Answer" }));
    expect(onAnswer).toHaveBeenCalledWith("12000.00");
    expect(moneyOf("250,000.5")).toBe("250000.50");
    expect(moneyOf("twelve")).toBeNull();
  });

  it("skips and reshuffles when offered", async () => {
    const onSkip = vi.fn(async () => undefined);
    const onReshuffle = vi.fn(async () => undefined);
    render(<QuestionCard group="The Partner" question="What did last year teach them?" kind="long_text" state="open" onAnswer={vi.fn()} onSkip={onSkip} onReshuffle={onReshuffle} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await userEvent.click(screen.getByRole("button", { name: "Reshuffle" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onReshuffle).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <QuestionCard group="The Offer" question="Which packages should go on sale?" why="Sets the packages page" kind="multi_pick" options={["Regular", "VIP", "VVIP"]} suggested={["Regular"]} suggestedFrom="From the deal" state="open" onAnswer={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
