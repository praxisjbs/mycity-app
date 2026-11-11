import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Match, VerifyCard } from "./VerifyCard";

const rows = [
  { label: "Document", value: "Offer of employment" },
  { label: "Reference", value: "OFF-0016" },
  { label: "Content Hash", value: <Match value="matches" /> },
  { label: "Artifact Hash", value: <Match value="differs" /> },
];

describe("VerifyCard", () => {
  it("waits for a check under its shield", () => {
    const { container } = render(<VerifyCard empty={{ title: "Enter a Reference", text: "The document's record shows here." }} />);
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite");
    expect(container.firstElementChild).not.toHaveAttribute("data-tone");
    expect(screen.getByText("Enter a Reference")).toBeInTheDocument();
    expect(container.querySelector(".ps-shield")).toHaveAttribute("aria-hidden", "true");
  });

  it("says the verdict in words, the record as rows with each hash marked, and a QR check's document", () => {
    const { container } = render(
      <VerifyCard
        tone="warn"
        title="Not This Document"
        text="The stored file was altered."
        items={rows}
        document={{ heading: "The Document", title: "Offer of Employment", paragraphs: ["Dear Obinna,"], action: <Button variant="line">Download PDF</Button> }}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-tone", "warn");
    expect(screen.getByRole("heading", { level: 2, name: "Not This Document" })).toBeInTheDocument();
    expect(screen.getByText("Matches").closest(".ps-match")).toHaveAttribute("data-match", "matches");
    expect(screen.getByText("Differs").closest(".ps-match")).toHaveAttribute("data-match", "differs");
    const doc = screen.getByText("The Document").parentElement!;
    expect(doc).toHaveAttribute("data-copy", "content");
    expect(within(doc).getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <VerifyCard tone="ok" title="Document Verified" text="This document is genuine and unchanged." items={rows} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("draws a QR check's document as blocks where it has them (an agreement's table)", () => {
    const span = (text: string) => ({ text, bold: false, italic: false, href: null });
    render(
      <VerifyCard
        tone="ok"
        title="Document Verified"
        text="This document is genuine and unchanged."
        document={{ heading: "The Document", title: "Deal Merchant Agreement", paragraphs: ["Ignored when there are blocks"], blocks: [{ kind: "heading", level: 2, spans: [span("Financials")] }, { kind: "table", head: [[], [span("Regular")]], rows: [[[span("Deal Price")], [span("₦10,800.00")]]] }] }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Financials" })).toBeInTheDocument();
    expect(screen.getByText("₦10,800.00")).toBeInTheDocument();
    expect(screen.queryByText("Ignored when there are blocks")).toBeNull();
  });
});
