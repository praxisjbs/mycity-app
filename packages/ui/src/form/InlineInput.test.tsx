import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { InlineInput, InlineLabel, InlineSelect, InlineTextArea } from "./InlineInput";

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

  it("InlineTextArea keeps line breaks and grows a row per line, up to maxRows", () => {
    const { rerender } = render(<InlineTextArea aria-label="Message" value="one" onChange={() => undefined} />);
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(box.rows).toBe(1);
    rerender(<InlineTextArea aria-label="Message" value={"one\ntwo\nthree"} onChange={() => undefined} />);
    expect(box.rows).toBe(3);
    expect(box.value).toBe("one\ntwo\nthree");
    rerender(<InlineTextArea aria-label="Message" value={"a\nb\nc\nd\ne"} maxRows={4} onChange={() => undefined} />);
    expect(box.rows).toBe(4);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<InlineInput aria-label="Message" value="" onChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
