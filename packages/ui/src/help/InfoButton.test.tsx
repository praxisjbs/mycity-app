import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { InfoButton } from "./InfoButton";

beforeAll(installOverlayTestEnv);

const TEXT = "Hours past the rostered shift, by week, for the last 12 weeks.";
const popover = () => document.querySelector("[data-help-popover]");

describe("InfoButton", () => {
  it("is named About its label and described by the hidden text", () => {
    render(<InfoButton label="Overtime Trend" help={TEXT} />);
    const button = screen.getByRole("button", { name: "About Overtime Trend" });
    expect(button).toHaveAccessibleDescription(TEXT);
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("takes the merged label shape without doubling About", () => {
    render(<InfoButton label="About attendance" help={TEXT} />);
    expect(screen.getByRole("button", { name: "About Attendance" })).toBeInTheDocument();
  });

  it("opens on Enter and on hover, and Esc closes it", async () => {
    const user = userEvent.setup();
    render(<InfoButton label="Overtime Trend" help={TEXT} />);
    const button = screen.getByRole("button");
    button.focus();
    await user.keyboard("{Enter}");
    expect(popover()).toHaveTextContent(TEXT);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(popover()).toBeNull());
    await user.hover(button);
    await waitFor(() => expect(popover()).not.toBeNull());
  });

  it("opens a sheet titled by its label on a phone", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<InfoButton label="Overtime Trend" help={TEXT} />);
    const button = screen.getByRole("button", { name: "About Overtime Trend" });
    expect(button.className).toContain("phone:size-tap");
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "Overtime Trend" })).toHaveTextContent(TEXT);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<InfoButton label="Overtime Trend" help={TEXT} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
