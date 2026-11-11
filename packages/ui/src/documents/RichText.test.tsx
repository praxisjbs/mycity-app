import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("site: a numbered heading's number on its badge, read once, in the site's look", () => {
    const span = (text: string) => ({ text, bold: false, italic: false, href: null });
    const { container } = render(<RichText look="site" top={3} blocks={[{ kind: "heading", level: 3, spans: [span("1. Sales & Revenue Strategy")] }, { kind: "bullets", items: [[span("Set clear sales targets.")]] }]} />);
    expect(container.firstElementChild).toHaveClass("ps-rte");
    const h = screen.getByRole("heading", { level: 4, name: "1. Sales & Revenue Strategy" });
    expect(h.querySelector("[data-n]")).toHaveTextContent("1");
    expect(h.querySelector("[data-n]")).toHaveAttribute("aria-hidden", "true");
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

  describe("a table", () => {
    const OPTIONS: RichTextBlock[] = [
      {
        kind: "table",
        head: [[], [span("Regular")], [span("VIP")]],
        rows: [
          [[span("Original Price")], [span("₦12,000.00")], [span("₦30,000.00")]],
          [[span("Deal Price")], [span("₦10,800.00")], [span("App Download")]],
        ],
      },
    ];
    const asPhone = (phone: boolean) =>
      vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
        matches: phone && /max-width/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
    afterEach(() => vi.restoreAllMocks());

    it("is a table on a computer, each row named by its first cell", async () => {
      asPhone(false);
      const { container } = render(<RichText blocks={OPTIONS} />);
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Regular", "VIP"]);
      expect(screen.getByRole("rowheader", { name: "Deal Price" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it("is a card a row on a phone, each value under its column's name, with no table", () => {
      asPhone(true);
      render(<RichText blocks={OPTIONS} />);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByText("Deal Price").tagName).toBe("P");
      expect(screen.getAllByText("VIP")).toHaveLength(2);
      expect(screen.getByText("App Download")).toBeInTheDocument();
    });
  });
});
