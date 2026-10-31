import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SignatureField, type SignatureFieldHandle } from "./SignatureField";

/** jsdom has no canvas, no pointer capture and no ResizeObserver. */
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    lineCap: "",
    lineJoin: "",
    lineWidth: 0,
    strokeStyle: "",
  })) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,ink") as never;
});

/** One stroke across the pad. */
async function sign(pad: HTMLElement) {
  await userEvent.pointer([
    { target: pad, coords: { clientX: 10, clientY: 10 }, keys: "[MouseLeft>]" },
    { target: pad, coords: { clientX: 60, clientY: 30 } },
    { target: pad, keys: "[/MouseLeft]" },
  ]);
}

describe("SignatureField", () => {
  it("is a named pad, drawn on paper so the PNG suits a white document", () => {
    render(<SignatureField label="Your Signature" onChange={vi.fn()} />);
    const pad = screen.getByRole("img", { name: "Your Signature" });
    expect(pad.className).toContain("bg-paper");
    expect(pad.className).toContain("text-paper-heading");
  });

  it("says the moment the first stroke lands", async () => {
    const onChange = vi.fn();
    render(<SignatureField label="Your Signature" onChange={onChange} />);
    await sign(screen.getByRole("img", { name: "Your Signature" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("hands over a PNG once it has ink, and nothing before", async () => {
    const ref = createRef<SignatureFieldHandle>();
    render(<SignatureField ref={ref} label="Your Signature" onChange={vi.fn()} />);
    expect(ref.current!.toPng()).toBeNull();
    await sign(screen.getByRole("img", { name: "Your Signature" }));
    expect(ref.current!.toPng()).toBe("data:image/png;base64,ink");
  });

  it("clears on the button and on the handle, and says it is empty again", async () => {
    const onChange = vi.fn();
    const ref = createRef<SignatureFieldHandle>();
    render(<SignatureField ref={ref} label="Your Signature" onChange={onChange} />);
    await sign(screen.getByRole("img", { name: "Your Signature" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear Signature" }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(ref.current!.toPng()).toBeNull();

    await sign(screen.getByRole("img", { name: "Your Signature" }));
    ref.current!.clear();
    expect(ref.current!.toPng()).toBeNull();
  });

  it("takes no ink when it is disabled", async () => {
    const onChange = vi.fn();
    render(<SignatureField label="Your Signature" onChange={onChange} disabled />);
    await sign(screen.getByRole("img", { name: "Your Signature" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear Signature" })).toBeDisabled();
  });

  it("hides its own Clear where the screen offers one", () => {
    render(<SignatureField label="Your Signature" onChange={vi.fn()} noClear />);
    expect(screen.queryByRole("button", { name: "Clear Signature" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SignatureField label="Your Signature" onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SignatureField · a saved signature", () => {
  it("opens with the saved signature as its ink, so it can be sent without drawing", async () => {
    // jsdom loads no images: one that loads as soon as its source is set.
    const Real = globalThis.Image;
    globalThis.Image = class {
      width = 240;
      height = 80;
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as never;
    try {
      const ref = createRef<SignatureFieldHandle>();
      const onChange = vi.fn();
      render(<SignatureField ref={ref} label="Your Signature" onChange={onChange} initial="data:image/png;base64,saved" />);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
      expect(ref.current!.toPng()).toBe("data:image/png;base64,ink");
    } finally {
      globalThis.Image = Real;
    }
  });
});
