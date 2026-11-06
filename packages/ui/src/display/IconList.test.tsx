import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { IconList } from "./IconList";

describe("IconList", () => {
  it("lists each item on its tile with the glyph before it, as content", () => {
    render(<IconList icon="trend" label="Key Performance Indicators (KPIs)" items={["Revenue against target", "Value of closed deals"]} />);
    const items = within(screen.getByRole("list", { name: "Key Performance Indicators (KPIs)" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Revenue against target", "Value of closed deals"]);
    expect(items[0]).toHaveAttribute("data-copy", "content");
    expect(items[0]!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<IconList icon="trend" label="Key Performance Indicators (KPIs)" items={["Sales pipeline value"]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
