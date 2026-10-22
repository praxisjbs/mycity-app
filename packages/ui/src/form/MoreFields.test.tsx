import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { MoreFields } from "./MoreFields";

const Baseline = ({ invalid = false, defaultOpen = false }: { invalid?: boolean; defaultOpen?: boolean }) => (
  <MoreFields invalid={invalid} defaultOpen={defaultOpen}>
    <Field label="Baseline" optional>
      <TextField value="38,000 in Q3" onChange={() => undefined} />
    </Field>
  </MoreFields>
);

describe("MoreFields", () => {
  it("is closed until the row is pressed, keeping its fields mounted", () => {
    render(<Baseline />);
    const row = screen.getByRole("button", { name: "More" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByDisplayValue("38,000 in Q3")).not.toBeVisible();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Baseline/)).toBeVisible();
    fireEvent.click(row);
    expect(screen.getByDisplayValue("38,000 in Q3")).not.toBeVisible();
  });

  it("opens itself while a field inside is marked, and on arrival when asked", () => {
    const { rerender } = render(<Baseline />);
    rerender(<Baseline invalid />);
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("38,000 in Q3")).toBeVisible();
    rerender(<Baseline defaultOpen key="again" />);
    expect(screen.getByDisplayValue("38,000 in Q3")).toBeVisible();
  });

  it("names its row as asked", () => {
    render(<MoreFields label="More Details">x</MoreFields>);
    expect(screen.getByRole("button", { name: "More Details" })).toBeInTheDocument();
  });

  it("has no accessibility violations, closed or open", async () => {
    const { container } = render(<Baseline />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
