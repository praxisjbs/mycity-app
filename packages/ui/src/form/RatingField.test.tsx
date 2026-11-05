import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { RatingField } from "./RatingField";

/** The field as a form holds it: the value in state, every rating also reported to the spy. */
function Held({ initial, onChange }: { initial: number | null; onChange: (value: number) => void }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <RatingField
      label="Level of Confidence"
      value={v}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

const checked = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");
const lit = (container: HTMLElement) => container.querySelectorAll("svg.fill-primary").length;

describe("RatingField", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws a named group of ten stars, each named by its place on the scale", () => {
    render(<RatingField label="Level of Confidence" value={7} onChange={() => undefined} />);
    const group = screen.getByRole("radiogroup", { name: "Level of Confidence" });
    expect(group).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "7 of 10" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "1 of 10" })).toHaveAttribute("data-ui", "button");
  });

  it("fills every star up to the rating and shows it beside them, hidden from assistive technology", () => {
    const { container } = render(<RatingField label="Job Knowledge and Experience" value={4} onChange={() => undefined} />);
    expect(lit(container)).toBe(4);
    const shown = screen.getByText("4/10");
    expect(shown).toHaveAttribute("aria-hidden", "true");
  });

  it("rates with a tap on a star", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RatingField label="Oral Communication Skills" value={null} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "10 of 10" }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("with onClear, a tap on the chosen star or Delete takes the rating back; without it the star stays", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(<RatingField label="Level of Confidence" value={7} onChange={onChange} onClear={onClear} />);
    await user.click(screen.getByRole("radio", { name: "7 of 10" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "4 of 10" }));
    expect(onChange).toHaveBeenCalledWith(4);
    screen.getByRole("radio", { name: "7 of 10" }).focus();
    await user.keyboard("{Delete}");
    expect(onClear).toHaveBeenCalledTimes(2);
    rerender(<RatingField label="Level of Confidence" value={7} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "7 of 10" }));
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it("moves and rates with the arrow keys, and stops at the top", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held initial={9} onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "9 of 10" })).toHaveFocus();
    await user.keyboard("{ArrowRight>}");
    expect(screen.getByRole("radio", { name: "10 of 10" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(10);
    await user.keyboard("{/ArrowRight}{ArrowRight>}");
    expect(screen.getByRole("radio", { name: "10 of 10" })).toHaveFocus();
    await user.keyboard("{/ArrowRight}{ArrowLeft>}");
    expect(screen.getByRole("radio", { name: "9 of 10" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(9);
    await user.keyboard("{/ArrowLeft}");
  });

  it("stops at the bottom too", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held initial={1} onChange={onChange} />);
    await user.tab();
    await user.keyboard("{ArrowLeft>}");
    expect(screen.getByRole("radio", { name: "1 of 10" })).toHaveFocus();
    await user.keyboard("{/ArrowLeft}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews a rating under the mouse without choosing it, the readout still the chosen one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<RatingField label="Future Growth Potential" value={2} onChange={onChange} />);
    await user.hover(screen.getByRole("radio", { name: "6 of 10" }));
    expect(lit(container)).toBe(6);
    expect(screen.getByText("2/10")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.unhover(screen.getByRole("radiogroup"));
    expect(lit(container)).toBe(2);
  });

  it("shows the chosen rating at once after a click, with the mouse still resting on it", async () => {
    const user = userEvent.setup();
    render(<Held initial={2} onChange={() => undefined} />);
    await user.click(screen.getByRole("radio", { name: "7 of 10" }));
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(document.querySelectorAll("svg.fill-primary")).toHaveLength(7);
    await user.keyboard("{ArrowLeft>}");
    await user.keyboard("{/ArrowLeft}");
    expect(document.querySelectorAll("svg.fill-primary")).toHaveLength(6);
  });

  it("gives no preview to a touch or a pen, only the tap", () => {
    const { container } = render(<RatingField label="Level of Confidence" value={3} onChange={() => undefined} />);
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "9 of 10" }), { pointerType: "touch" });
    expect(lit(container)).toBe(3);
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "9 of 10" }), { pointerType: "pen" });
    expect(lit(container)).toBe(3);
  });

  it("chooses with Home, End, Up and Down as well as Left and Right", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held initial={3} onChange={onChange} />);
    await user.tab();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(screen.getByRole("radio", { name: "10 of 10" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(9);
    expect(screen.getByRole("radio", { name: "9 of 10" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole("radio", { name: "2 of 10" })).toHaveFocus();
  });

  it("disabled, it shows the rating in place and takes no change from a tap or a key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<RatingField label="Level of Confidence" value={8} onChange={onChange} disabled />);
    expect(screen.getByRole("radio", { name: "8 of 10" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3 of 10" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "3 of 10" }));
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "Home" });
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "10 of 10" }), { pointerType: "mouse" });
    expect(onChange).not.toHaveBeenCalled();
    expect(lit(container)).toBe(8);
  });

  it("shows a value off the scale as not rated, never a star count that contradicts the readout", () => {
    const { container, rerender } = render(<RatingField label="Level of Confidence" value={12} onChange={() => undefined} />);
    expect(lit(container)).toBe(0);
    expect(checked()).toHaveLength(0);
    expect(screen.queryByText(/\/10/)).toBeNull();
    rerender(<RatingField label="Level of Confidence" value={0} onChange={() => undefined} />);
    expect(screen.queryByText(/\/10/)).toBeNull();
    rerender(<RatingField label="Level of Confidence" value={7.5} onChange={() => undefined} />);
    expect(checked()).toHaveLength(0);
    expect(lit(container)).toBe(0);
  });

  it("keeps a top of 10 when the scale it is given is not a number", () => {
    render(<RatingField label="Overall Rating" max={Number.NaN} value={null} onChange={() => undefined} />);
    expect(screen.getAllByRole("radio")).toHaveLength(10);
  });

  it("has nothing checked and no readout while no rating is given", () => {
    const { container } = render(<RatingField label="Accuracy in Language" value={null} onChange={() => undefined} />);
    expect(checked()).toHaveLength(0);
    expect(lit(container)).toBe(0);
    expect(screen.queryByText(/\/10/)).toBeNull();
  });

  it("takes another top for its scale, from 3 to 10", () => {
    render(<RatingField label="Overall Rating" max={5} value={3} onChange={() => undefined} />);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "3 of 5" })).toBeChecked();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("calls onBlur only when focus leaves the stars", async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    render(
      <div>
        <RatingField label="Level of Confidence" value={5} onChange={() => undefined} onBlur={onBlur} />
        <button type="button">Submit Card</button>
      </div>,
    );
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onBlur).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "Submit Card" })).toHaveFocus();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("is named by the Field label and takes the bad state and its error from the Field", () => {
    render(
      <Field label="Stability Level in Career" state="bad" message="Rate this trait">
        <RatingField value={null} onChange={() => undefined} />
      </Field>,
    );
    const group = screen.getByRole("radiogroup", { name: "Stability Level in Career" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.className).toContain("border-destructive");
    const error = screen.getByText("Rate this trait").closest("p")!;
    expect(group.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("read only, it is one image named by its rating, a mean shown to one decimal", () => {
    const { container } = render(<RatingField label="Appearance and Grooming" value={7.4} readOnly />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("img", { name: "Appearance and Grooming: 7.4 of 10" })).toBeInTheDocument();
    expect(lit(container)).toBe(7);
    expect(screen.getByText("7.4")).toBeInTheDocument();
  });

  it("read only inside a Field, it is named by the Field's label and its rating", () => {
    render(
      <Field label="Level of Confidence">
        <RatingField value={7} readOnly />
      </Field>,
    );
    expect(screen.getByRole("img", { name: "Level of Confidence 7 of 10" })).toBeInTheDocument();
  });

  it("read only, decimals make a column of means read alike, and a value off the scale is held to it", () => {
    const { rerender } = render(<RatingField label="Accuracy in Language" value={7} readOnly decimals={1} />);
    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Accuracy in Language: 7.0 of 10" })).toBeInTheDocument();
    rerender(<RatingField label="Accuracy in Language" value={12} readOnly />);
    expect(screen.getByRole("img", { name: "Accuracy in Language: 10 of 10" })).toBeInTheDocument();
    rerender(<RatingField label="Accuracy in Language" value={Number.NaN} readOnly />);
    expect(screen.getByRole("img", { name: "Accuracy in Language: Not rated, out of 10" })).toBeInTheDocument();
  });

  it("read only and not rated, it says so", () => {
    render(<RatingField value={null} readOnly />);
    expect(screen.getByRole("img", { name: "Not rated, out of 10" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <RatingField label="Level of Confidence" value={8} onChange={() => undefined} />
        <RatingField label="Oral Communication Skills" value={null} onChange={() => undefined} />
        <Field label="Job Knowledge and Experience" state="bad" message="Rate this trait">
          <RatingField value={null} onChange={() => undefined} />
        </Field>
        <RatingField label="Appearance and Grooming" value={6.5} readOnly />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
