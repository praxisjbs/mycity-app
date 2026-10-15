import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { HELP_OPEN_MS, HelpTerm } from "./HelpTerm";

beforeAll(installOverlayTestEnv);

const TEXT = "Minutes past the shift start before a punch counts as late.";
const popover = () => document.querySelector("[data-help-popover]");

describe("HelpTerm", () => {
  it("is the word itself, described by hidden text that never joins a label's name", () => {
    render(
      <div>
        <label htmlFor="grace">
          <HelpTerm help={TEXT}>Grace Period</HelpTerm>
        </label>
        <input id="grace" />
      </div>,
    );
    const term = screen.getByRole("button", { name: "Grace Period" });
    expect(term).toHaveAttribute("data-help-term");
    expect(term.className).toContain("decoration-dotted");
    expect(term).toHaveAccessibleDescription(TEXT);
    const hidden = document.getElementById(term.getAttribute("aria-describedby") ?? "");
    expect(hidden).toHaveClass("sr-only");
    expect(hidden).toHaveAttribute("data-ui", "help");
    expect(hidden?.closest("label")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveAccessibleName("Grace Period");
    expect(popover()).toBeNull();
  });

  it("uses the caller's id for the hidden text", () => {
    render(
      <HelpTerm help={TEXT} helpId="grace-help">
        Grace Period
      </HelpTerm>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby", "grace-help");
    expect(document.getElementById("grace-help")).toHaveTextContent(TEXT);
  });

  it("opens after a pause on hover, stays while the pointer is on the popover, and closes after leaving", async () => {
    const user = userEvent.setup();
    render(<HelpTerm help={TEXT}>Grace Period</HelpTerm>);
    const term = screen.getByRole("button", { name: "Grace Period" });
    await user.hover(term);
    expect(popover()).toBeNull();
    await waitFor(() => expect(popover()).not.toBeNull());
    expect(popover()).toHaveTextContent(TEXT);
    await user.unhover(term);
    await user.hover(popover() as Element);
    await act(() => new Promise((r) => setTimeout(r, HELP_OPEN_MS)));
    expect(popover()).not.toBeNull();
    await user.unhover(popover() as Element);
    await waitFor(() => expect(popover()).toBeNull());
  });

  it("opens when reached with Tab and closes on Esc", async () => {
    const user = userEvent.setup();
    render(<HelpTerm help={TEXT}>Grace Period</HelpTerm>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Grace Period" })).toHaveFocus();
    await waitFor(() => expect(popover()).not.toBeNull());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(popover()).toBeNull());
    expect(screen.getByRole("button", { name: "Grace Period" })).toHaveFocus();
  });

  it("stays open after a click until clicked again", async () => {
    const user = userEvent.setup();
    render(<HelpTerm help={TEXT}>Grace Period</HelpTerm>);
    const term = screen.getByRole("button", { name: "Grace Period" });
    await user.click(term);
    expect(popover()).not.toBeNull();
    await user.unhover(term);
    await act(() => new Promise((r) => setTimeout(r, HELP_OPEN_MS)));
    expect(popover()).not.toBeNull();
    await user.click(term);
    await waitFor(() => expect(popover()).toBeNull());
  });

  it("opens a bottom sheet titled by the term on a phone", async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<HelpTerm help={TEXT}>Grace Period</HelpTerm>);
    await user.click(screen.getByRole("button", { name: "Grace Period" }));
    const sheet = screen.getByRole("dialog", { name: "Grace Period" });
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(sheet.querySelector('[data-ui="help"]')).toHaveTextContent(TEXT);
    expect(popover()).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("warns in development when the text passes 35 words", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<HelpTerm help={Array.from({ length: 36 }, () => "word").join(" ")}>Over By</HelpTerm>);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("limit 35"));
  });

  it("has no accessibility violations, closed or open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <h3>
        <HelpTerm help={TEXT}>Grace Period</HelpTerm>
      </h3>,
    );
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole("heading")).toHaveAccessibleName("Grace Period");
    await user.click(screen.getByRole("button"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
