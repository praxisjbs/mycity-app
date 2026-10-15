import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { IconCard, IconCards } from "./IconCards";

describe("IconCards", () => {
  it("lays cards two to a row, three when asked", () => {
    const { container, rerender } = render(<IconCards>{null}</IconCards>);
    expect(container.firstElementChild?.className).toContain("grid-cols-2");
    rerender(<IconCards cols={3}>{null}</IconCards>);
    expect(container.firstElementChild?.className).toContain("lg:grid-cols-3");
  });
});

describe("IconCard", () => {
  it("is a button named by its title, described by its line, opening on click and keys", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconCards>
        <IconCard icon="shield" title="Password" text="Changed 02/10/2026" onClick={onClick} />
      </IconCards>,
    );
    const card = screen.getByRole("button", { name: /Password/ });
    expect(card).toHaveAccessibleDescription("Changed 02/10/2026");
    expect(screen.getByText("Password")).toHaveAttribute("data-ui", "title");
    await user.click(card);
    card.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("shows a count of things waiting", () => {
    render(<IconCard icon="doc" title="Documents" count={2} onClick={() => {}} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <IconCards>
        <IconCard icon="shield" title="Password" text="Changed 02/10/2026" onClick={() => {}} />
        <IconCard icon="lock" title="Devices" text="2 active" count={1} onClick={() => {}} />
      </IconCards>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
