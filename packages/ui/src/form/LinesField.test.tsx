import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { LinesField, lineAmount, linesTotal, type LineValue } from "./LinesField";

/** JBS Praxis's sample invoice as a request's lines: four items, the discount, the payment already made. */
const INVOICE: LineValue[] = [
  { description: "Payment gateway integration", quantity: "1", unit_price: "250000.00" },
  { description: "Ticket checkout pages", quantity: "1", unit_price: "150000.00" },
  { description: "Refunds and reconciliation", quantity: "1", unit_price: "100000.00" },
  { description: "Testing and go-live support", quantity: "1", unit_price: "50000.00" },
  { description: "Discount", quantity: "1", unit_price: "-100000.00" },
  { description: "Paid to date on INV-202611-9525", quantity: "1", unit_price: "-300000.00" },
];

function Lines({ start }: { start: LineValue[] }) {
  const [lines, setLines] = useState(start);
  return (
    <Field label="Lines">
      <LinesField value={lines} onChange={setLines} />
    </Field>
  );
}

describe("LinesField", () => {
  it("counts each line and the total in kobo, a negative line taking away, as the server counts them", () => {
    expect(lineAmount({ quantity: "2", unit_price: "4,500" })).toBe("9000.00");
    expect(lineAmount({ quantity: "1.5", unit_price: "1000.01" })).toBe("1500.02");
    expect(lineAmount({ quantity: "1", unit_price: "-100,000" })).toBe("-100000.00");
    expect(lineAmount({ quantity: "", unit_price: "" })).toBe("0.00");
    expect(linesTotal(INVOICE)).toBe("150000.00");
  });

  it("shows every line with its amount and the total, takes a minus on a unit price, adds and removes lines", async () => {
    const user = userEvent.setup();
    render(<Lines start={INVOICE.slice(0, 1)} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Line" }));
    expect(screen.getByLabelText("Item 2")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Item 2"), "Discount");
    const price = screen.getAllByLabelText("Unit Price")[1]!;
    await user.type(price, "-50000");
    expect(price).toHaveValue("-50000");
    expect(screen.getAllByText("₦200,000.00").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Remove Item 2" }));
    expect(screen.queryByLabelText("Item 2")).not.toBeInTheDocument();
  });

  it("offers no Add Line past the most a request holds", () => {
    render(<Lines start={Array.from({ length: 25 }, () => ({ description: "Water", quantity: "1", unit_price: "100" }))} />);
    expect(screen.queryByRole("button", { name: "Add Line" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Lines start={INVOICE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
