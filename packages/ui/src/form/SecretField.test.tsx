import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { SecretField } from "./SecretField";

function Bound({ saved, hint, noun, onValue }: { saved?: boolean; hint?: string | null; noun?: "password" | "key"; onValue?: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <Field label="API Key">
      <SecretField
        value={v}
        onChange={(next) => {
          setV(next);
          onValue?.(next);
        }}
        saved={saved}
        hint={hint}
        noun={noun}
      />
    </Field>
  );
}

describe("SecretField", () => {
  it("shows a saved key as Saved with its last four, and none of the rest", () => {
    render(<Bound saved hint="1a2b" />);
    const line = screen.getByLabelText("API Key");
    expect(line).toHaveValue("Saved, ends 1a2b");
    expect(line).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("shows a saved password as Saved alone", () => {
    render(<Bound saved />);
    expect(screen.getByLabelText("API Key")).toHaveValue("Saved");
  });

  it("Replace opens an empty field and focuses it; Keep Saved empties it and goes back", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Bound saved hint="1a2b" noun="key" onValue={onValue} />);
    await user.click(screen.getByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("API Key");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    await user.type(input, "new-key-9");
    expect(onValue).toHaveBeenLastCalledWith("new-key-9");
    expect(screen.getByRole("button", { name: "Show key" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep Saved" }));
    expect(onValue).toHaveBeenLastCalledWith("");
    expect(screen.getByLabelText("API Key")).toHaveValue("Saved, ends 1a2b");
    expect(screen.getByRole("button", { name: "Replace" })).toHaveFocus();
  });

  it("is a plain secret field when nothing is saved", async () => {
    const user = userEvent.setup();
    render(<Bound />);
    const input = screen.getByLabelText("API Key");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: "Keep Saved" })).not.toBeInTheDocument();
    await user.type(input, "abc");
    expect(input).toHaveValue("abc");
  });

  it("has no accessibility violations, saved and replacing", async () => {
    const user = userEvent.setup();
    const { container } = render(<Bound saved hint="1a2b" />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
