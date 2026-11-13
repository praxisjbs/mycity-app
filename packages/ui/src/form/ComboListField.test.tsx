import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import type { DataViewList } from "../data/DataView";
import { Field } from "./Field";
import { ComboListField } from "./ComboListField";
import { SAMPLE_IMPACTS, type SampleImpact } from "./fixtures";

const list = (over: Partial<DataViewList<SampleImpact>> = {}): DataViewList<SampleImpact> => ({
  rows: SAMPLE_IMPACTS,
  page: { number: 1, size: 25, total: SAMPLE_IMPACTS.length, pages: 1, has_next: false },
  loading: false,
  error: null,
  q: "",
  setQ: vi.fn(),
  ...over,
});

/** The field as a form holds it: the values live outside, and are handed back on each change. */
function Held({ start = [], onChange, onBlur, max }: { start?: string[]; onChange?: (v: string[]) => void; onBlur?: () => void; max?: number }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <Field label="Impact" optional>
        <ComboListField
          value={value}
          onChange={(v) => {
            setValue(v);
            onChange?.(v);
          }}
          onBlur={onBlur}
          list={list()}
          option={(i) => i.label}
          max={max}
        />
      </Field>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("ComboListField", () => {
  it("adds a suggestion as a chip, and offers it no more", async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Impact" }));
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Brand Visibility" }));
    expect(onChange).toHaveBeenLastCalledWith(["Brand Visibility"]);
    expect(screen.getByRole("button", { name: "Remove Brand Visibility" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
    await userEvent.keyboard("{ArrowDown}");
    const offered = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(offered).toEqual(["App Downloads & Visibility", "Revenue Generation", "User Acquisition", "Vendor Acquisition"]);
  });

  it("adds what is typed with Enter, once whatever its case, as the suggestion that says it", async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "  Content   Collaboration {Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["Content Collaboration"]);
    await userEvent.type(box, "revenue generation{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["Content Collaboration", "Revenue Generation"]);
    await userEvent.type(box, "content collaboration{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps what was typed and not added when the person leaves", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<Held onChange={onChange} onBlur={onBlur} />);
    await userEvent.type(screen.getByRole("combobox"), "Tourism Reach");
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onChange).toHaveBeenLastCalledWith(["Tourism Reach"]);
    expect(onBlur).toHaveBeenCalled();
  });

  it("removes a chip, and the box goes once the most it holds are held", async () => {
    const onChange = vi.fn();
    render(<Held start={["Brand Visibility", "User Acquisition"]} onChange={onChange} max={2} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Brand Visibility" }));
    expect(onChange).toHaveBeenLastCalledWith(["User Acquisition"]);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("has no accessibility violations, open or with chips", async () => {
    const { container } = render(<Held start={["Brand Visibility"]} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
