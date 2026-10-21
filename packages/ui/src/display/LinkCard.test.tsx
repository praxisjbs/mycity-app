import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { LinkCard } from "./LinkCard";

const CARD = { href: "https://nfelia.com/shop", title: "Nfelia: Fashion in Lagos", site: "Nfelia", description: "Shop the latest." };

describe("LinkCard", () => {
  it("is one link to the page, named by its title, with the site, description and host", () => {
    render(<LinkCard {...CARD} />);
    const link = screen.getByRole("link", { name: /Nfelia: Fashion in Lagos/ });
    expect(link).toHaveAttribute("href", "https://nfelia.com/shop");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Shop the latest.")).toBeInTheDocument();
    expect(screen.getByText("nfelia.com")).toBeInTheDocument();
  });

  it("runs a wide picture across the top and keeps a square one small at the side", () => {
    const { container, rerender } = render(<LinkCard {...CARD} image="blob:wide" hasImage imageWidth={1200} imageHeight={630} />);
    expect(container.querySelector("[style]")?.getAttribute("style")).toContain("--ratio");
    rerender(<LinkCard {...CARD} image="blob:square" hasImage imageWidth={300} imageHeight={300} />);
    expect(container.querySelector("img")?.parentElement?.className).toContain("size-16");
  });

  it("keeps the picture's place while it loads, and asks for it once it is near the screen", () => {
    const seen = vi.fn();
    const { container } = render(<LinkCard {...CARD} hasImage onSeen={seen} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("in the composer: does not open, says it is loading, and Remove Preview takes it away", async () => {
    const remove = vi.fn();
    const { rerender } = render(<LinkCard href={CARD.href} loading onRemove={remove} tone="plain" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading the link's card" })).toBeInTheDocument();
    rerender(<LinkCard {...CARD} onRemove={remove} tone="plain" />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Preview" }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<LinkCard {...CARD} image="blob:x" hasImage imageWidth={1200} imageHeight={630} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
