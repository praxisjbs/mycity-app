import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, Signature } from "./Paper";

const letter = (
  <Paper note="This is how the letter will print">
    <PaperLogo reference="OFF/2026/0041" />
    <PaperTitle sub="For Adaeze Okonkwo, from 01/11/2026">Offer of Employment</PaperTitle>
    <PaperTable
      head={["Item", "Amount"]}
      rows={[
        ["Basic", "₦350,000.00"],
        ["Housing", "₦62,500.00"],
      ]}
      totals={[["Gross Monthly", "₦412,500.00"]]}
    />
    <PaperFoot>
      <Signature>Chidi Eze</Signature>
      <span>13/10/2026</span>
    </PaperFoot>
  </Paper>
);

describe("Paper", () => {
  it("draws the sheet in the paper tokens, not the theme's own", () => {
    const { container } = render(letter);
    const sheet = container.querySelector("[data-copy=content]")!;
    expect(sheet.className).toContain("bg-paper");
    expect(sheet.className).toContain("text-paper-ink");
  });

  it("marks the document as content, so the copy gates skip what it says", () => {
    const { container } = render(letter);
    expect(container.querySelector("[data-copy=content]")).not.toBeNull();
  });

  it("carries the letterhead, the document's number and its heading", () => {
    render(letter);
    expect(screen.getByText("MyCity App Ltd")).toBeInTheDocument();
    expect(screen.getByText("OFF/2026/0041")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Offer of Employment" })).toBeInTheDocument();
    expect(screen.getByText("For Adaeze Okonkwo, from 01/11/2026")).toBeInTheDocument();
  });

  it("rules the totals off from the lines", () => {
    render(letter);
    const total = screen.getByText("Gross Monthly");
    expect(total.className).toContain("border-paper-brand");
    expect(screen.getByText("₦412,500.00").className).toContain("tabular-nums");
  });

  it("says what the sheet is above it", () => {
    render(letter);
    expect(screen.getByText("This is how the letter will print")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(letter);
    expect(await axe(container)).toHaveNoViolations();
  });
});
