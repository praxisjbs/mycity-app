import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { DocumentFrame, sealDocument } from "./DocumentFrame";

const HTML = '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>.page{width:1280px;height:720px}</style></head><body><section class="page" data-section="cover" aria-label="Cover"><h1>Selling Out the Weekend</h1></section></body></html>';

describe("DocumentFrame", () => {
  it("draws the document in a frame named for a screen reader, with no browser tooltip", () => {
    render(<DocumentFrame title="Proposal PRO-0012" html={HTML} />);
    const frame = screen.getByLabelText("Proposal PRO-0012");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).not.toHaveAttribute("title");
    expect(frame.getAttribute("srcdoc")).toContain("Selling Out the Weekend");
  });

  it("seals the document: nothing in it runs or reaches out, and scripts are not allowed in the frame", () => {
    render(<DocumentFrame title="Proposal" html={HTML} />);
    const frame = screen.getByLabelText("Proposal");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'; img-src data:");
    expect(sealDocument("<p>Plain</p>")).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(sealDocument(HTML).indexOf("Content-Security-Policy")).toBeLessThan(sealDocument(HTML).indexOf("<style>"));
  });

  it("keeps pull to refresh off the document", () => {
    const { container } = render(<DocumentFrame title="Proposal" html={HTML} />);
    expect(container.firstElementChild).toHaveAttribute("data-pull", "off");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<DocumentFrame title="Proposal" html={HTML} />);
    expect(await axe(container, {}, { iframes: false })).toHaveNoViolations();
  });
});
