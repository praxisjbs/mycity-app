// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Verify } from "./Verify";

/**
 * Verify a Document on the in-browser mock (INTERIM until M5): OFF-0016 genuine, OFF-0012 its file
 * altered, OFF-0011 its record altered, OFF-0009 both, OFF-0099 not found, and OFF-0016's QR.
 */
const draw = (number: string | null, qr?: string) =>
  render(
    <RouterProvider>
      <Verify number={number} qr={qr} />
    </RouterProvider>,
  );

afterEach(() => window.history.replaceState({}, "", "/"));

const row = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

describe("Verify", () => {
  it("waits for a reference, and a reference opens its own address", async () => {
    draw(null);
    const aside = screen.getByRole("complementary", { name: "Verify a Document" });
    expect(within(aside).getByText("Check any document we issued.")).toBeTruthy();
    expect(screen.getByText("Enter a Reference")).toBeTruthy();
    fireEvent.change(within(aside).getByRole("textbox", { name: "Reference" }), { target: { value: "off-0016" } });
    fireEvent.click(within(aside).getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(window.location.pathname).toBe("/verify/OFF-0016"));
  });

  it("a genuine document: verified, its record, both hashes matching", async () => {
    draw("OFF-0016");
    expect(await screen.findByRole("heading", { level: 2, name: "Document Verified" })).toBeTruthy();
    expect(screen.getByText("This document is genuine and unchanged.")).toBeTruthy();
    expect(row("Signed By")).toBe("Obinna Chukwu");
    expect(row("Signed On")).toBe("21/10/2026, 14:05");
    expect(row("Content Hash")).toBe("Matches");
    expect(row("Artifact Hash")).toBe("Matches");
    expect(screen.queryByText("The Document")).toBeNull();
  });

  it("says which was altered: the file, the record, or both", async () => {
    const a = draw("OFF-0012");
    expect(await screen.findByText("The stored file was altered.")).toBeTruthy();
    expect(row("Artifact Hash")).toBe("Differs");
    a.unmount();
    const b = draw("OFF-0011");
    expect(await screen.findByText("The record was altered.")).toBeTruthy();
    b.unmount();
    draw("OFF-0009");
    expect(await screen.findByText("The record and the stored file were altered.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Not This Document" })).toBeTruthy();
  });

  it("a reference nobody issued is Not Found, with what one looks like", async () => {
    draw("OFF-0099");
    expect(await screen.findByRole("heading", { level: 2, name: "Not Found" })).toBeTruthy();
    expect(row("Reference")).toBe("OFF-0099");
    expect(screen.getByText("Check the reference on the document and try again. It looks like OFF-0018.")).toBeTruthy();
  });

  it("by its QR, the record and the document itself, with its download", async () => {
    draw(null, "Qd5mW8rTx3Kp");
    expect(await screen.findByRole("heading", { level: 2, name: "Document Verified" })).toBeTruthy();
    const doc = screen.getByText("The Document").parentElement!;
    expect(within(doc).getByText("Offer of Employment")).toBeTruthy();
    expect(within(doc).getByText("Dear Obinna,")).toBeTruthy();
    expect(within(doc).getByRole("link", { name: "Download PDF" }).getAttribute("download")).toBe("OFF-0016.pdf");
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("OFF-0012");
    await screen.findByText("The stored file was altered.");
    expect(await axe(container)).toHaveNoViolations();
  });
});
