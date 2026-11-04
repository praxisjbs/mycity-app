import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { PaneSheet } from "./PaneSheet";

beforeAll(() => installOverlayTestEnv());

describe("PaneSheet", () => {
  it("is a full-height dialog named Figures that holds the views, and Back closes it", async () => {
    setViewport(390);
    const onClose = vi.fn();
    render(
      <PaneSheet open onClose={onClose}>
        <p>The views</p>
      </PaneSheet>,
    );
    const sheet = await screen.findByRole("dialog", { name: "Figures" });
    expect(sheet.textContent).toContain("The views");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    setViewport(1440);
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    render(
      <PaneSheet open onClose={() => undefined}>
        <p>The views</p>
      </PaneSheet>,
    );
    expect(await axe(await screen.findByRole("dialog"))).toHaveNoViolations();
    setViewport(1440);
  });
});
