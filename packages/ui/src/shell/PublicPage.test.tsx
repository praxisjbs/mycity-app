import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
        We reply within five working days.
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
