import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { AssistantShell } from "./AssistantShell";

const frame = (onBack = vi.fn(), over = {}) => render(<AssistantShell title="Praxis AI" back={{ to: "People · Leave", onBack }} conversation={<p>The log</p>} pane={<p>The pane</p>} aside={<p>Recent list</p>} {...over} />);

describe("AssistantShell", () => {
  it("has the title, Back naming the screen it returns to, the conversation and the pane", async () => {
    const onBack = vi.fn();
    frame(onBack);
    expect(screen.getByRole("heading", { level: 1, name: "Praxis AI" })).toBeInTheDocument();
    expect(screen.getByText("From People · Leave")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Conversation" }).textContent).toBe("The log");
    expect(screen.getByRole("region", { name: "Pane" }).textContent).toBe("The pane");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Escape goes Back too, unless an open overlay took it", () => {
    const onBack = vi.fn();
    frame(onBack);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
    const taken = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows Recent only while the toggle is on, and no Back without a screen to return to", () => {
    const { rerender } = render(<AssistantShell title="Praxis AI" conversation={<p>The log</p>} aside={<p>Recent list</p>} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByText("Recent list")).toBeNull();
    rerender(<AssistantShell title="Praxis AI" conversation={<p>The log</p>} aside={<p>Recent list</p>} asideOpen />);
    expect(screen.getByRole("complementary", { name: "Recent" }).textContent).toBe("Recent list");
  });

  it("has no accessibility violations", async () => {
    const { container } = frame();
    expect(await axe(container)).toHaveNoViolations();
  });
});
