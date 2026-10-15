import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { InlineInput, InlineLabel, InlineSelect } from "./InlineInput";

describe("Inline controls", () => {
  it("InlineInput passes text and forwards its ref", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    let el: HTMLInputElement | null = null;
    render(<InlineInput ref={(r) => (el = r)} aria-label="Message" value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "H");
    expect(onChange).toHaveBeenCalledWith("H");
    expect(el).toBeInstanceOf(HTMLInputElement);
  });

  it("InlineSelect takes strings or pairs, and InlineLabel labels it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <InlineLabel htmlFor="who">To</InlineLabel>
        <InlineSelect id="who" value="a" onChange={onChange} options={["a", ["b", "Bola"]]} />
      </div>,
    );
    await user.selectOptions(screen.getByLabelText("To"), "Bola");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<InlineInput aria-label="Message" value="" onChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
