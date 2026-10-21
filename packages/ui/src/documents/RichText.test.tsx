import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { RichText, type RichTextBlock } from "./RichText";

const span = (text: string, marks: Partial<{ bold: boolean; italic: boolean; href: string | null }> = {}) => ({
  text,
  bold: false,
  italic: false,
  href: null,
  ...marks,
});

const BLOCKS: RichTextBlock[] = [
  { kind: "heading", level: 2, spans: [span("Working Hours")] },
  { kind: "paragraph", spans: [span("Staff work "), span("Monday to Friday", { bold: true }), span(", "), span("09:00 to 17:00", { italic: true }), span(".")] },
  { kind: "heading", level: 3, spans: [span("Breaks")] },
  { kind: "bullets", items: [[span("Lunch is an hour.")], [span("Ask People: "), span("people@example.test", { href: "mailto:people@example.test" })]] },
  { kind: "numbered", items: [[span("Clock in.")], [span("Clock out.")]] },
];

describe("RichText", () => {
  it("draws headings, paragraphs, lists and marks as elements", () => {
    render(<RichText blocks={BLOCKS} />);
    expect(screen.getByRole("heading", { level: 2, name: "Working Hours" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Breaks" })).toBeInTheDocument();
    expect(screen.getByText("Monday to Friday").tagName).toBe("STRONG");
    expect(screen.getByText("09:00 to 17:00").tagName).toBe("EM");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "people@example.test" })).toHaveAttribute("href", "mailto:people@example.test");
  });

  it("puts the headings under the page's own with top", () => {
    render(<RichText blocks={BLOCKS} top={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Working Hours" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Breaks" })).toBeInTheDocument();
  });

  it("never makes a link of an unsafe address, and never injects markup", () => {
    const { container } = render(
      <RichText blocks={[{ kind: "paragraph", spans: [span("<b>not bold</b>"), span(" click", { href: "javascript:alert(1)" })] }]} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeInTheDocument();
  });

  it("is content, not interface copy", () => {
    const { container } = render(<RichText blocks={BLOCKS} />);
    expect(container.firstElementChild).toHaveAttribute("data-copy", "content");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RichText blocks={BLOCKS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
