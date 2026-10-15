import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
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

  it("has no accessibility violations", async () => {
    const { container } = render(<Bound />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
