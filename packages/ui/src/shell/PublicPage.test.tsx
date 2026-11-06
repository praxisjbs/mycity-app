import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { PageMessage, PublicPage, PUBLIC_FOOTER_COLUMNS } from "./PublicPage";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

const nav = [
  { label: "Careers", href: "/jobs", current: true },
  { label: "Verify Document", href: "/verify" },
];

describe("PublicPage", () => {
  it("has one banner with the site's mark, its nav with the current page marked, a main and a footer", () => {
    render(
      <PublicPage layout="full" nav={nav} brandSub="Careers">
        <p>Open roles</p>
      </PublicPage>,
    );
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "MyCityApp Home" })).toHaveAttribute("href", "/");
    expect(within(banner).getByText("Careers", { selector: ".ps-brand-name span" })).toBeInTheDocument();
    const main = within(banner).getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Careers" })).toHaveAttribute("aria-current", "page");
    expect(within(main).getByRole("link", { name: "Verify Document" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("main")).toHaveTextContent("Open roles");
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it("takes the site's own links through its navigate, and leaves other links, and modified clicks, to the browser", async () => {
    const navigate = vi.fn();
    render(
      <PublicPage layout="full" nav={nav} navigate={navigate}>
        <p>Page</p>
      </PublicPage>,
    );
    await userEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Verify Document" }));
    expect(navigate).toHaveBeenLastCalledWith("/verify");
    const foot = screen.getByRole("contentinfo");
    await userEvent.click(within(foot).getByRole("link", { name: "How We Hire" }));
    expect(navigate).toHaveBeenLastCalledWith("/#hire");
    const external = within(foot).getByRole("link", { name: "Visit MyCityApp" });
    expect(external).toHaveAttribute("href", "https://mycityapp.io");
    const before = navigate.mock.calls.length;
    external.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(external);
    expect(navigate.mock.calls.length).toBe(before);
  });

  it("opens the menu with the same links, and closes it on Esc and on a link", async () => {
    render(
      <PublicPage layout="full" nav={nav} navigate={() => undefined}>
        <p>Page</p>
      </PublicPage>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("navigation", { name: "Menu" });
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Careers", "Verify Document"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("link", { name: "Careers" }));
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
  });

  it("draws the footer: the mark, the tagline, Lagos's time, the design's columns, the © line and Back to Top", async () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(
      <PublicPage layout="full">
        <p>Page</p>
      </PublicPage>,
    );
    const foot = screen.getByRole("contentinfo");
    expect(foot).toHaveAttribute("data-theme", "dark");
    expect(within(foot).getByText("The city and lifestyle platform for every Nigerian city.")).toBeInTheDocument();
    expect(within(foot).getByText("Lagos").nextElementSibling?.tagName).toBe("TIME");
    expect(within(foot).getByText("Lagos").nextElementSibling?.textContent).toMatch(/^\d{2}:\d{2}$/);
    const site = within(foot).getByRole("navigation", { name: "Site" });
    expect(within(site).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(PUBLIC_FOOTER_COLUMNS.map((c) => c.title));
    expect(within(site).getAllByRole("link")).toHaveLength(8);
    expect(within(foot).getByText(/^© \d{4} MyCity App Ltd\. Lagos, Nigeria\.$/)).toBeInTheDocument();
    expect(within(foot).getByText("JBS Praxis").tagName).toBe("B");
    await userEvent.click(within(foot).getByRole("button", { name: "Back to Top" }));
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("split: the aside first, named by its h1, in bands (who it is for, the title, text and steps, the credit), the card beside it, no footer", () => {
    render(
      <PublicPage
        layout="split"
        nav={nav}
        name="Head, Sales & Revenue"
        line="Marketing & Sales, Lekki Phase 1, Lagos"
        title="Apply"
        text="Your application, in three steps."
        paragraph="This link works until 08/11/2026."
        steps={{ items: ["About You", "CV and Questions", "Why This Role"], at: 1 }}
        aside={<p>60:00 left</p>}
      >
        <h2>CV and Questions</h2>
      </PublicPage>,
    );
    const aside = screen.getByRole("complementary", { name: "Apply" });
    expect(within(aside).getByText("Head, Sales & Revenue").closest("[data-copy]")).toHaveAttribute("data-copy", "content");
    expect(within(aside).queryByRole("img")).toBeNull();
    const h1 = within(aside).getByRole("heading", { level: 1, name: "Apply" });
    expect(h1).toHaveAttribute("data-ui", "page-title");
    expect(h1).toHaveClass("ps-eyebrow");
    const display = within(aside).getByText("Your application, in three steps.");
    expect(display).toHaveClass("ps-auth-h");
    expect(h1.compareDocumentPosition(display) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(aside).getByText("This link works until 08/11/2026.")).toHaveClass("ps-auth-text");
    expect(within(aside).getByRole("list", { name: "Steps" }).parentElement).toHaveClass("ps-auth-steps");
    expect(within(aside).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(within(aside).getByText("60:00 left").parentElement).toHaveClass("ps-auth-extra");
    expect(within(aside).getByText(/MyCity App Ltd/)).toHaveTextContent(/^© \d{4} MyCity App Ltd$/);
    const card = screen.getByRole("heading", { level: 2, name: "CV and Questions" });
    expect(card.parentElement).toHaveClass("ps-auth-work");
    expect(aside.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("split: the larger display line for a tool page, and focus can move to the title", () => {
    const ref = { current: null as HTMLHeadingElement | null };
    render(
      <PublicPage layout="split" title="Verify a Document" text="Check any document we issued." textSize="l" titleRef={ref}>
        <p>Result</p>
      </PublicPage>,
    );
    expect(screen.getByText("Check any document we issued.")).toHaveClass("ps-auth-h-l");
    const h1 = screen.getByRole("heading", { level: 1, name: "Verify a Document" });
    expect(ref.current).toBe(h1);
    expect(h1).toHaveAttribute("tabindex", "-1");
  });

  it("leaves the footer off a sign-in page, and takes columns of the caller's", () => {
    const { rerender } = render(
      <PublicPage layout="full" footer={false}>
        <p>Apply</p>
      </PublicPage>,
    );
    expect(screen.queryByRole("contentinfo")).toBeNull();
    rerender(
      <PublicPage layout="full" columns={[{ title: "Careers", links: [{ label: "Open Roles", href: "/jobs" }] }]}>
        <p>Apply</p>
      </PublicPage>,
    );
    expect(within(screen.getByRole("navigation", { name: "Site" })).getAllByRole("link")).toHaveLength(1);
  });

  it("lays the page on the tinted ground, full by default", () => {
    const { container } = render(
      <PublicPage>
        <p>Page</p>
      </PublicPage>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-canvas");
    expect(container.firstElementChild).toHaveAttribute("data-layout", "full");
    expect(container.firstElementChild!.className).toContain("public-ground");
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "MyCityApp Home" })).toHaveAttribute("href", "/");
  });

  it("frames a phone's bar at the foot and keeps room for it", () => {
    render(
      <PublicPage bar={<p>12 people have applied.</p>}>
        <p>Role</p>
      </PublicPage>,
    );
    expect(screen.getByRole("contentinfo")).toHaveClass("ps-foot-clear");
    const bar = screen.getByText("12 people have applied.").parentElement!;
    expect(bar).toHaveClass("ps-bar");
    expect(screen.getByRole("main")).toContainElement(bar);
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
    expect(screen.queryByText("Your Reference")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "See Other Roles" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the reference to quote in its box, the tick landing in its tone", () => {
    const { container } = render(
      <PageMessage icon="ok" tone="ok" title="Application Sent" reference={{ label: "Your Reference", value: "APP-0042" }}>
        We emailed a copy to you.
      </PageMessage>,
    );
    expect(screen.getByText("APP-0042")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Your Reference").parentElement).toHaveClass("ps-ref");
    expect(container.querySelector(".ps-outcome-ic")).toHaveAttribute("data-tone", "ok");
    expect(container.querySelector(".ps-outcome-ic")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <PublicPage layout="full" nav={nav}>
        <PageMessage title="Offer Expired" tone="warn" icon="clock">Ask People for a new link.</PageMessage>
      </PublicPage>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations in the split layout", async () => {
    const { container } = render(
      <PublicPage layout="split" nav={nav} name="Content Producer" line="Offer of Employment, OFF-0018" title="Offer of Employment" text="Your offer, ready to sign." steps={{ items: ["Read the Letter", "Sign Below"], at: 0 }}>
        <PageMessage title="Offer Signed" tone="ok" icon="ok">We emailed you a signed copy.</PageMessage>
      </PublicPage>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
