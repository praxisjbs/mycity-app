import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { CtaCard, CtaCards } from "./CtaCard";

const draw = () =>
  render(
    <main>
      <CtaCards>
        <CtaCard tone="deep" from="left" id="refer" icon="userplus" title="Know Someone Great?" text="Send them our roles. Their application comes straight to our hiring team." action={<Button variant="primary">Copy Careers Link</Button>} />
        <CtaCard from="right" delay={120} icon="shieldok" title="Verify a Document" text="Check an offer letter or certificate MyCityApp issued, by its reference." action={<Button variant="line">Verify a Document</Button>} />
      </CtaCards>
    </main>,
  );

describe("CtaCard", () => {
  it("draws each card named by its title, slides it in from its side, and keeps its id for a link", () => {
    const { container } = draw();
    const refer = container.querySelector("#refer")!;
    expect(refer.tagName).toBe("ARTICLE");
    expect(refer).toHaveAttribute("data-reveal", "left");
    expect(refer).toHaveAttribute("data-lift", "shadow");
    expect(screen.getByRole("group", { name: "Know Someone Great?" })).toHaveAttribute("data-tone", "deep");
    expect(screen.getByRole("group", { name: "Verify a Document" })).toHaveAttribute("data-tone", "card");
    expect(screen.getByRole("button", { name: "Copy Careers Link" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    expect(await axe(container)).toHaveNoViolations();
  });
});
