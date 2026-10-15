import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Kbd } from "./Kbd";

describe("Kbd", () => {
  it("draws one key from children", () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    expect(container.querySelectorAll("kbd")).toHaveLength(1);
    expect(screen.getByText("Esc").tagName).toBe("KBD");
  });

  it("draws a combination as keycaps, named for symbols, hidden on a phone", () => {
    const { container } = render(<Kbd keys={["⌘", "K"]} label="Command K" />);
    expect(container.querySelectorAll("kbd kbd")).toHaveLength(2);
    const el = screen.getByRole("img", { name: "Command K" });
    expect(el.className).toContain("phone:hidden");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        Search <Kbd keys={["⌘", "K"]} label="Command K" /> or close <Kbd>Esc</Kbd>
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
