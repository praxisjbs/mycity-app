import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("draws the progress, the top line with its status, the title, the body and the foot in order", () => {
    const { container } = render(
      <Panel as="section" eyebrow="Step 1 of 3" status={<span>Saved</span>} progress={{ value: 1, max: 3 }} title="About You" foot={<Button>Next</Button>}>
        <p>Full Name</p>
      </Panel>,
    );
    const section = screen.getByRole("region", { name: "About You" });
    expect(section).toHaveClass("ps-panel");
    expect(container.querySelector(".ps-panel-bar")).toHaveAttribute("aria-hidden", "true");
    expect((container.querySelector(".ps-panel-bar > span") as HTMLElement).style.getPropertyValue("--fill")).toBe("33.33333333333333%");
    expect(screen.getByText("Step 1 of 3").tagName).toBe("SMALL");
    expect(screen.getByText("Saved").parentElement).toHaveClass("ps-panel-top");
    expect(screen.getByRole("heading", { level: 2, name: "About You" })).toHaveAttribute("data-ui", "title");
    expect(screen.getByText("Full Name").parentElement).toHaveClass("ps-panel-body");
    expect(screen.getByRole("button", { name: "Next" }).parentElement).toHaveClass("ps-panel-foot");
  });

  it("holds an outcome bare, and moves focus to its title when asked", () => {
    const ref = { current: null as HTMLHeadingElement | null };
    const { rerender, container } = render(
      <Panel bare>
        <p>Application Sent</p>
      </Panel>,
    );
    expect(container.querySelector(".ps-panel-in")).toBeNull();
    rerender(<Panel title="Why This Role" titleRef={ref} />);
    expect(ref.current).toBe(screen.getByRole("heading", { level: 2 }));
    expect(ref.current).toHaveAttribute("tabindex", "-1");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <Panel as="section" eyebrow="Question 1 of 3" progress={{ value: 1, max: 3 }} title="Sign Below" foot={<Button variant="primary">Accept and Sign</Button>}>
          <p>Draw your signature here</p>
        </Panel>
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
