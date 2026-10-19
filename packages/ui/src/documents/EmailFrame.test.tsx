import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { buildEmailDoc, EmailFrame, parseMailto } from "./EmailFrame";

const ink = { fg: "rgb(1, 2, 3)", link: "rgb(4, 5, 6)", rule: "rgb(7, 8, 9)", font: "Inter" };

describe("EmailFrame", () => {
  it("is a frame named by the subject, that runs nothing", () => {
    render(<EmailFrame title="Client configuration settings" html="<p>Hello</p>" />);
    const frame = screen.getByLabelText("Client configuration settings");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("<p>Hello</p>");
  });

  it("refuses scripts, frames and forms, and web images until they are allowed", () => {
    const sealed = buildEmailDoc("<p>x</p>", { remoteImages: false, ink, scheme: "dark" });
    expect(sealed).toContain("default-src 'none'");
    expect(sealed).toContain("img-src data: blob:;");
    expect(sealed).toContain("frame-src 'none'");
    expect(sealed).toContain("form-action 'none'");
    expect(sealed).not.toMatch(/script-src/);
    expect(buildEmailDoc("<p>x</p>", { remoteImages: true, ink, scheme: "dark" })).toContain("img-src data: blob: https:");
  });

  it("draws a message with no colours of its own in the app's ink, on a transparent page", () => {
    const doc = buildEmailDoc("<p>x</p>", { remoteImages: false, ink, scheme: "light" });
    expect(doc).toContain("color:rgb(1, 2, 3)");
    expect(doc).toContain("a{color:rgb(4, 5, 6)}");
    expect(doc).toContain("background:transparent");
    expect(doc).toContain("color-scheme:light");
  });

  it("reads a mailto link into the composer's parts", () => {
    expect(parseMailto("mailto:a@x.io,b@x.io?cc=c@x.io&subject=Hi%20there&body=Line")).toEqual({ to: ["a@x.io", "b@x.io"], cc: ["c@x.io"], subject: "Hi there", body: "Line" });
    expect(parseMailto("mailto:%E0%A4%A")).toEqual({ to: ["%E0%A4%A"], cc: [], subject: null, body: null });
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<EmailFrame title="Re: Venue confirmations" html="<p>Thanks</p>" />);
    expect(await axe(container, {}, { iframes: false })).toHaveNoViolations();
  });
});
