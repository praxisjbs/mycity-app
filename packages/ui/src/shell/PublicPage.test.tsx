import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Brand } from "./Brand";
import { PageMessage, PublicPage } from "./PublicPage";

afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("PublicPage", () => {
  it("has a banner, a main and a footer, with the brand, the page and the links", () => {
    render(
      <PublicPage brand={<a href="/jobs"><Brand name="MyCityApp" /></a>} links={<a href="/verify">Verify a Document</a>}>
        <p>Open roles</p>
      </PublicPage>,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("MyCityApp");
    expect(screen.getByRole("main")).toHaveTextContent("Open roles");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("MyCity App Ltd · Lagos, Nigeria");
    expect(screen.getByRole("link", { name: "Verify a Document" })).toBeInTheDocument();
  });

  it("draws the page on its card by default, and open lays the page out wide with no card", () => {
    const { container, rerender } = render(<PublicPage><p>Apply</p></PublicPage>);
    expect(container.firstElementChild).toHaveAttribute("data-layout", "card");
    expect(screen.getByText("Apply").parentElement?.className).toContain("rounded-card");
    expect(screen.getByRole("main").className).toContain("max-w-176");
    rerender(<PublicPage layout="open"><p>Careers</p></PublicPage>);
    expect(container.firstElementChild).toHaveAttribute("data-layout", "open");
    expect(screen.getByText("Careers").parentElement?.className).not.toContain("rounded-card");
    expect(screen.getByRole("main").className).toContain("max-w-280");
    expect(screen.getByRole("banner").className).toContain("max-w-280");
  });

  it("stands a pane beside the card: the pane first, inside the main, both in sticky columns", () => {
    render(
      <PublicPage pane={<section aria-label="Pane"><h1>Partnerships Associate</h1></section>}>
        <h2>About You</h2>
      </PublicPage>,
    );
    const main = screen.getByRole("main");
    expect(main.className).toContain("max-w-280");
    const cols = main.querySelector("[data-sticky-columns]")!;
    expect(cols.children[0]).toHaveTextContent("Partnerships Associate");
    expect(cols.children[1]).toHaveTextContent("About You");
    expect(screen.getByText("About You").parentElement!.className).toContain("rounded-card");
  });

  it("lays the page on the tinted ground, and the footer gives the mark, the links and Lagos's time", () => {
    const { container } = render(<PublicPage links={<a href="/jobs">Careers</a>}><p>Page</p></PublicPage>);
    expect(container.firstElementChild).toHaveAttribute("data-canvas");
    expect(container.firstElementChild!.className).toContain("public-ground");
    const foot = screen.getByRole("contentinfo");
    expect(within(foot).getByText("MyCityApp")).toBeInTheDocument();
    expect(within(foot).getByRole("navigation", { name: "Site" })).toContainElement(screen.getByRole("link", { name: "Careers" }));
    expect(within(foot).getByText("Lagos").nextElementSibling?.tagName).toBe("TIME");
  });

  it("keeps room at a phone's foot for its bar", () => {
    render(<PublicPage bar={<div>Apply for This Role</div>}><p>Role</p></PublicPage>);
    expect(screen.getByRole("contentinfo").querySelector(".bg-deep")!.className).toContain("phone:pb-24");
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Apply for This Role"));
  });

  it("switches the theme from its button", async () => {
    render(<PublicPage><p>Page</p></PublicPage>);
    await userEvent.click(screen.getByRole("button", { name: /Theme/ }));
    expect(document.documentElement).toHaveAttribute("data-theme");
  });
});

describe("PageMessage", () => {
  it("names the outcome as a heading and offers its action", async () => {
    const onClick = vi.fn();
    render(
      <PageMessage icon="ok" tone="ok" title="Application Sent" action={<Button onClick={onClick}>See Other Roles</Button>}>
        We read every application.
      </PageMessage>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Application Sent" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See Other Roles" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <PublicPage brand={<a href="/jobs"><Brand name="MyCityApp" /></a>}>
        <PageMessage title="Offer Expired" tone="warn" icon="clock">Ask People for a new link.</PageMessage>
      </PublicPage>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
