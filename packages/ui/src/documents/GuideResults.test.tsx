import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { GuideAnswerCard, GuideResults, type GuideAnswerView, type GuideHitView } from "./GuideResults";
import { GUIDE_ANSWER, GUIDE_HITS } from "./fixtures";

const hits = GUIDE_HITS as unknown as GuideHitView[];
const answer = GUIDE_ANSWER as unknown as GuideAnswerView;

describe("GuideResults", () => {
  it("lists each result in order with where it sits, its step and the words found marked", () => {
    const { container } = render(<GuideResults hits={hits} onOpen={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Guide Results" });
    expect(list).toHaveAttribute("data-copy", "content");
    const rows = screen.getAllByRole("button");
    expect(rows.map((b) => b.querySelector("b")?.textContent)).toEqual(["Forgot your password", "Change your password", "Signing In"]);
    expect(screen.getByText("Getting Started › Signing In")).toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Forgot Password", "password"]);
  });

  it("opens the result pressed", async () => {
    const onOpen = vi.fn();
    render(<GuideResults hits={hits} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /Change your password/ }));
    expect(onOpen).toHaveBeenCalledWith(hits[1]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<GuideResults hits={hits} onOpen={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("GuideAnswerCard", () => {
  it("shows the answer's sentences with their source numbers, and only the sources they cite", async () => {
    const onOpen = vi.fn();
    render(<GuideAnswerCard answer={answer} onOpen={onOpen} />);
    expect(screen.getByRole("region", { name: "Answer" })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/press Forgot Password and type your work email/)).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: "Sources" });
    expect(sources.querySelectorAll("li")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /Source 1: Forgot your password/ }));
    expect(onOpen).toHaveBeenCalledWith(hits[0]);
  });

  it("says so while it is written, and when the guide has no answer", () => {
    const { rerender } = render(<GuideAnswerCard answer={null} onOpen={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Answer" })).toHaveAttribute("aria-busy", "true");
    rerender(<GuideAnswerCard answer={{ found: false, sentences: [], sources: hits }} onOpen={vi.fn()} />);
    expect(screen.getByText(/The guide has no answer to that/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<GuideAnswerCard answer={answer} onOpen={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
