import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Quote } from "./Quote";

describe("Quote", () => {
  it("is a blockquote marked as content, with who said it", () => {
    const { container } = render(<Quote cite="Adaeze Okafor, Line Manager">Approved, enjoy the break.</Quote>);
    expect(container.firstElementChild).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Approved, enjoy the break.").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("Adaeze Okafor, Line Manager").tagName).toBe("FIGCAPTION");
  });

  it("keeps the merged className for spacing", () => {
    const { container } = render(<Quote className="mt-3">Noted.</Quote>);
    expect(container.firstElementChild).toHaveClass("mt-3");
  });

  it("feature: the site's statement, its lead over the smaller words, as content", () => {
    render(
      <Quote look="feature" lead="A commercial leader, not simply a sales administrator.">
        Someone who can find opportunities and close deals.
      </Quote>,
    );
    const quote = screen.getByText(/A commercial leader/).closest("blockquote")!;
    expect(quote).toHaveClass("ps-quote");
    expect(quote.closest("figure")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Someone who can find opportunities and close deals.")).toHaveClass("ps-quote-more");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Quote cite="Adaeze Okafor">Approved, enjoy the break.</Quote>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
