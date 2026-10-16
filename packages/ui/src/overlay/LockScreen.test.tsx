import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { LockScreen } from "./LockScreen";

function Locked({ open = true }: { open?: boolean }) {
  return (
    <LockScreen
      open={open}
      name="Cynthia Osakunih"
      email="cynthia@mycityapp.io"
      title="Session Locked"
      reason="Locked after 30 minutes idle"
      footer={
        <>
          <Button>Sign Out</Button>
          <Button variant="primary">Unlock</Button>
        </>
      }
    >
      <input aria-label="Password" type="password" />
    </LockScreen>
  );
}

describe("LockScreen", () => {
  it("names the person and says why it locked", () => {
    render(<Locked />);
    const dialog = screen.getByRole("dialog", { name: "Session Locked" });
    expect(dialog).toHaveAccessibleDescription("Locked after 30 minutes idle");
    expect(screen.getByText("Cynthia Osakunih")).toBeInTheDocument();
    expect(screen.getByText("cynthia@mycityapp.io")).toBeInTheDocument();
  });

  it("puts focus in the password field and cannot be dismissed", async () => {
    render(<Locked />);
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders nothing while unlocked", () => {
    render(<Locked open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    render(<Locked />);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
