import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ShareBar } from "./ShareBar";

const share = (r: ReturnType<typeof render>) => (r.container.firstElementChild as HTMLElement).style.getPropertyValue("--share");

describe("ShareBar", () => {
  it("fills the row's left edge to its share, as a variable the class reads", () => {
    const r = render(<ShareBar percent={62} />);
    expect(share(r)).toBe("62%");
    expect(r.container.firstElementChild!.className).toContain("w-(--share)");
  });

  it("holds a share between nothing and full, whatever figure it is given", () => {
    expect(share(render(<ShareBar percent={320} />))).toBe("100%");
    expect(share(render(<ShareBar percent={-8} />))).toBe("0%");
    expect(share(render(<ShareBar percent={Number.NaN} />))).toBe("0%");
  });

  it("is decorative: the figure it shows is in the words over it", () => {
    const { container } = render(<ShareBar percent={62} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <button type="button" className="relative overflow-hidden">
        <ShareBar percent={62} />
        <span className="relative">Yes, 62%</span>
      </button>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
