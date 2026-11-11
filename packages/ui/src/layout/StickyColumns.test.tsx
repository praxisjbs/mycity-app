import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { StickyColumns } from "./StickyColumns";

/** jsdom lays nothing out: each column reports the height its test gives it. */
function heights(map: Record<string, number>) {
  return vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return map[this.textContent ?? ""] ?? 0;
  });
}

describe("StickyColumns", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lays each child out as one column, in the order given", () => {
    render(
      <StickyColumns>
        <p>Pane</p>
        <p>Form</p>
      </StickyColumns>,
    );
    const [a, b] = Array.from(document.querySelector("[data-sticky-columns]")!.children);
    expect(a).toHaveTextContent("Pane");
    expect(b).toHaveTextContent("Form");
    expect(a!.className).toContain("lg:sticky-col");
  });

  it("lays the public site's aside and side columns from 1041 px", () => {
    const { container, rerender } = render(
      <StickyColumns layout="aside">
        <aside>Teams</aside>
        <div>Roles</div>
      </StickyColumns>,
    );
    expect(container.firstElementChild!.className).toContain("lg:cols-aside");
    rerender(
      <StickyColumns layout="side" phoneFirst={1}>
        <article>Role Overview</article>
        <aside>The Role</aside>
      </StickyColumns>,
    );
    expect(container.firstElementChild!.className).toContain("lg:cols-side");
    expect(container.firstElementChild!.children[1]!.className).toContain("max-lg:order-first");
  });

  it("sticks a column that fits at the top, and rests a taller one on its foot", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    heights({ Pane: 600, Form: 2000 });
    render(
      <StickyColumns gap={24}>
        <p>Pane</p>
        <p>Form</p>
      </StickyColumns>,
    );
    const [pane, form] = Array.from(document.querySelector("[data-sticky-columns]")!.children) as HTMLElement[];
    expect(pane!.style.getPropertyValue("--stick-top")).toBe("24px");
    expect(form!.style.getPropertyValue("--stick-top")).toBe("-1124px");
  });

  it("measures again when the window changes height", () => {
    const vh = vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    heights({ Pane: 700, Form: 300 });
    render(
      <StickyColumns>
        <p>Pane</p>
        <p>Form</p>
      </StickyColumns>,
    );
    const pane = document.querySelector<HTMLElement>("[data-sticky-columns] > div")!;
    expect(pane.style.getPropertyValue("--stick-top")).toBe("24px");
    vh.mockReturnValue(600);
    window.dispatchEvent(new Event("resize"));
    expect(pane.style.getPropertyValue("--stick-top")).toBe("-124px");
  });

  it("puts the column named phoneFirst first where the columns stack", () => {
    render(
      <StickyColumns layout="main-side" phoneFirst={1}>
        <p>Role Overview</p>
        <p>The Role</p>
      </StickyColumns>,
    );
    expect(screen.getByText("The Role").parentElement!.className).toContain("max-md:order-first");
    expect(screen.getByText("Role Overview").parentElement!.className).not.toContain("order-first");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <StickyColumns>
        <p>Pane</p>
        <p>Form</p>
      </StickyColumns>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
