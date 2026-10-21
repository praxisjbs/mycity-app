import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { ColorField, hexOf } from "./ColorField";

function Bound({ start = "" }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <Field label="Card">
      <ColorField value={v} onChange={setV} />
    </Field>
  );
}

const swatchOf = (container: HTMLElement) => container.querySelector("[data-swatch]")!;

describe("ColorField", () => {
  it("passes what is typed, as typed, and is named by its Field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Card">
        <ColorField value="" onChange={onChange} />
      </Field>,
    );
    await user.type(screen.getByLabelText("Card"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.getByLabelText("Card")).toHaveAttribute("placeholder", "#RRGGBB");
  });

  it("shows the colour beside it once the value is one, with or without its #", async () => {
    const user = userEvent.setup();
    const { container } = render(<Bound />);
    expect(swatchOf(container)).toHaveAttribute("data-swatch", "none");
    await user.type(screen.getByLabelText("Card"), "1e2023");
    expect(swatchOf(container).getAttribute("data-swatch")).toBe(hexOf("1e2023"));
    expect(hexOf(" 1e20 ")).toBeNull();
  });

  it("takes a pasted value whole", async () => {
    const user = userEvent.setup();
    render(<Bound />);
    const input = screen.getByLabelText("Card");
    await user.click(input);
    await user.paste(`#${"45C8B0"}`);
    expect(input).toHaveValue(`#${"45C8B0"}`);
  });

  it("marks a refused colour on the field, never by colour alone", () => {
    render(
      <Field label="Background" state="bad" message="Too light for dark">
        <ColorField value="F4F4F4" onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByLabelText("Background")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Too light for dark")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Bound start="1E2023" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
