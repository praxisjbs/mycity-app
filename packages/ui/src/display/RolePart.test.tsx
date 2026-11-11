import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { RolePart } from "./RolePart";

describe("RolePart", () => {
  it("heads its content with the part's title, a page title or the role's own words, rising with the scroll", () => {
    const { container } = render(
      <>
        <RolePart title="Role Overview">
          <p>The Head, Sales & Revenue will lead commercial growth.</p>
        </RolePart>
        <RolePart title="Key Performance Indicators (KPIs)" record>
          <p>Revenue generated against target</p>
        </RolePart>
      </>,
    );
    const parts = container.querySelectorAll("section");
    expect(parts[0]).toHaveClass("ps-part");
    expect(parts[0]).toHaveAttribute("data-reveal-scroll");
    expect(screen.getByRole("heading", { level: 2, name: "Role Overview" })).toHaveAttribute("data-ui", "title");
    expect(screen.getByRole("heading", { level: 2, name: "Key Performance Indicators (KPIs)" })).toHaveAttribute("data-copy", "content");
    expect(screen.getByRole("group", { name: "Role Overview" })).toHaveTextContent("lead commercial growth");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <RolePart title="Role Overview">
          <p>The Head, Sales & Revenue will lead commercial growth.</p>
        </RolePart>
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
