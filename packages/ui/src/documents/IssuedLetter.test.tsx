import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { IssuedLetter } from "./IssuedLetter";

const draw = () =>
  render(
    <main>
      <IssuedLetter
        label="The offer letter"
        meta={["MyCity App Ltd", "Lagos, Nigeria", "06/11/2026"]}
        title="Offer of Employment"
        paragraphs={["Dear Chiamaka,", "We are pleased to offer you the position of Content Producer at MyCity App Ltd."]}
        from="Cynthia Osakunih, Operations and People Lead, for MyCity App Ltd"
      />
    </main>,
  );

describe("IssuedLetter", () => {
  it("draws the letterhead, the title, the paragraphs and the line it is signed from, all as content", () => {
    draw();
    const letter = screen.getByRole("article", { name: "The offer letter" });
    expect(letter).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("MyCityApp").tagName).toBe("B");
    expect(screen.getByText("06/11/2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Offer of Employment" })).toBeInTheDocument();
    expect(screen.getByText("Dear Chiamaka,").tagName).toBe("P");
    expect(screen.getByText(/Cynthia Osakunih/)).toHaveClass("ps-sig-from");
    expect(letter.querySelector("svg")?.closest("[aria-hidden]")).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    expect(await axe(container)).toHaveNoViolations();
  });
});
