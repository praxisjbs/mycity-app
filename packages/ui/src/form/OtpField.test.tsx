import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { OtpField } from "./OtpField";

function Bound() {
  const [code, setCode] = useState("");
  return (
    <>
      <OtpField label="Sign-In Code" value={code} onChange={setCode} />
      <output>{code}</output>
    </>
  );
}

describe("OtpField", () => {
  it("moves to the next box after each digit", async () => {
    const user = userEvent.setup();
    render(<Bound />);
    await user.click(screen.getByLabelText("Digit 1 of 6"));
    await user.keyboard("123");
    expect(screen.getByRole("status")).toHaveTextContent("123");
    expect(screen.getByLabelText("Digit 4 of 6")).toHaveFocus();
  });

  it("fills every box from a pasted code", async () => {
    const user = userEvent.setup();
    render(<Bound />);
    await user.click(screen.getByLabelText("Digit 1 of 6"));
    await user.paste("482 913");
    expect(screen.getByRole("status")).toHaveTextContent("482913");
  });

  it("calls onComplete once the last box is filled", async () => {
    const user = userEvent.setup();
    const done: string[] = [];
    function Done() {
      const [code, setCode] = useState("");
      return <OtpField label="Sign-In Code" value={code} onChange={setCode} onComplete={(c) => done.push(c)} />;
    }
    render(<Done />);
    await user.click(screen.getByLabelText("Digit 1 of 6"));
    await user.keyboard("48291");
    expect(done).toEqual([]);
    await user.keyboard("3");
    expect(done).toEqual(["482913"]);
  });

  it("shows a secret code as dots, never offered to a password manager, and takes its Field's label", async () => {
    const user = userEvent.setup();
    function Pin() {
      const [pin, setPin] = useState("");
      return (
        <Field label="PIN" state="bad" message="Not the right PIN">
          <OtpField label="PIN" length={4} secret value={pin} onChange={setPin} />
        </Field>
      );
    }
    const { container } = render(<Pin />);
    const first = screen.getByLabelText("Digit 1 of 4");
    expect(first).toHaveAttribute("type", "password");
    expect(first).toHaveAttribute("autocomplete", "off");
    expect(first).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByText("PIN"));
    expect(first).toHaveFocus();
    expect(screen.getByRole("group", { name: "PIN" })).toHaveAccessibleDescription(/Not the right PIN/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Bound />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
