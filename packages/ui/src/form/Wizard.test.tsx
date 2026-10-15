import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Wizard, type WizardStep } from "./Wizard";

const steps = (validate?: () => boolean): WizardStep[] => [
  { title: "The Role", body: <p>Role fields</p>, check: validate },
  { title: "Pay and Hours", body: <p>Pay fields</p> },
  { title: "Review", body: <p>Review</p> },
];

describe("Wizard", () => {
  it("steps forward and back, and the last button names the result", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<Wizard steps={steps()} finish="Publish Vacancy" onFinish={onFinish} />);
    expect(screen.getByRole("heading", { name: "The Role" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Pay and Hours" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "The Role" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Publish Vacancy" }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("does not advance until the step's fields are right", async () => {
    const user = userEvent.setup();
    render(<Wizard steps={steps(() => false)} finish="Publish Vacancy" onFinish={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "The Role" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Wizard steps={steps()} finish="Publish Vacancy" onFinish={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
