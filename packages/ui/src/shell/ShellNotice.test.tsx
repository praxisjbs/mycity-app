import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { ShellNotice } from "./ShellNotice";

describe("ShellNotice", () => {
  it("is a status region with its line and actions, taking no focus", async () => {
    const reload = vi.fn();
    render(
      <ShellNotice icon="refresh" actions={<Button variant="primary" size="sm" onClick={reload}>Reload</Button>}>
        A new version is ready
      </ShellNotice>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("A new version is ready");
    expect(document.activeElement).toBe(document.body);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ShellNotice icon="download" actions={<><Button size="sm">Not Now</Button><Button size="sm" variant="primary">Install App</Button></>}>
        Install MyCity App
      </ShellNotice>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
