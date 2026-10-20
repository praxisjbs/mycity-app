import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { LinkText } from "./LinkText";

describe("LinkText", () => {
  it("makes every link clickable, opening in a new tab with no opener", () => {
    render(<LinkText text="New arrivals at https://nfelia.com/shop, and www.mycityapp.io." />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://nfelia.com/shop", "https://www.mycityapp.io/"]);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByRole("link", { name: /nfelia\.com\/shop/ })).toHaveTextContent("(opens in a new tab)");
  });

  it("keeps the text around the links, and leaves an email address alone", () => {
    const { container } = render(<LinkText text={"Write to ada@nfelia.com\nthen call"} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("Write to ada@nfelia.com\nthen call");
    expect(container.firstElementChild).toHaveAttribute("data-copy", "content");
  });

  it("never links another scheme", () => {
    render(<LinkText text="javascript:alert(1) mailto:a@b.com" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("marks each search match, inside a link as well", () => {
    const { container } = render(<LinkText text="Nfelia opens at nfelia.com" highlight="nfelia" />);
    expect([...container.querySelectorAll("mark.hit")].map((m) => m.textContent)).toEqual(["Nfelia", "nfelia"]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<LinkText text="See https://nfelia.com today" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
