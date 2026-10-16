import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Card, CardHeader } from "./Card";

describe("Card", () => {
  it("pads by default and runs to the edges without", () => {
    const { container, rerender } = render(<Card>Body</Card>);
    expect(container.firstElementChild?.className).toContain("p-3.5");
    rerender(<Card pad={false}>Body</Card>);
    expect(container.firstElementChild?.className).toContain("overflow-hidden");
    expect(container.firstElementChild?.className).not.toContain("p-3.5");
  });

  it("renders as a section and carries its Details row at the foot", () => {
    const { container } = render(
      <Card as="section" aria-label="Leave balance" details={<p>Carry over up to 5 days</p>}>
        <p>Body</p>
      </Card>,
    );
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section?.lastElementChild?.textContent).toBe("Carry over up to 5 days");
  });

  it("passes props through, so a clickable card keeps its handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Card role="button" tabIndex={0} aria-label="Open Request" onClick={onClick}>
        Body
      </Card>,
    );
    await user.click(screen.getByRole("button", { name: "Open Request" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("CardHeader", () => {
  it("marks the title slot as a heading and puts actions at the end", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Card>
        <CardHeader title="Leave Requests" actions={<Button size="sm" onClick={onClick}>View All</Button>} />
      </Card>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Leave Requests" });
    expect(heading).toHaveAttribute("data-ui", "title");
    await user.tab();
    expect(screen.getByRole("button", { name: "View All" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("accepts the merged `right` prop and a heading level", () => {
    render(<CardHeader title="Devices" level={3} right={<span>3 active</span>} />);
    expect(screen.getByRole("heading", { level: 3, name: "Devices" })).toBeInTheDocument();
    expect(screen.getByText("3 active")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Card details={<p>Carry over up to 5 days</p>}>
        <CardHeader title="Leave Balance" actions={<Button size="sm">Request Leave</Button>} />
        <p>18 days left</p>
      </Card>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
