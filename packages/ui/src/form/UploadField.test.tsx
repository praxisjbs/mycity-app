import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import type { DocumentRef, Uploader } from "../lib/upload";
import { UploadField } from "./UploadField";

const doc = (name: string): DocumentRef => ({ document_id: `d-${name}`, file_name: name, size_bytes: 10, mime_type: "application/pdf" });
const file = (name = "receipt.pdf", size = 10) => {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

/** An uploader that reports progress and then answers, like the real engine. */
const fine: Uploader = ({ file: f, onProgress }) => {
  onProgress?.(50);
  onProgress?.(100);
  return Promise.resolve(doc(f.name));
};

describe("UploadField", () => {
  it("is the only file input, and it is labelled", () => {
    const { container } = render(<UploadField purpose="receipt" upload={fine} />);
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(1);
    expect(screen.getByLabelText("Drop files here, or browse")).toBe(inputs[0]);
  });

  it("sends the file, shows its percentage, then says it is done", async () => {
    const onUploaded = vi.fn();
    const { container } = render(<UploadField purpose="receipt" upload={fine} onUploaded={onUploaded} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file());
    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
    expect(screen.getByRole("meter", { name: "receipt.pdf upload" })).toHaveAttribute("aria-valuenow", "100");
    expect(onUploaded).toHaveBeenCalledWith([doc("receipt.pdf")]);
  });

  it("gives the route its purpose, so the server decides which types it takes", async () => {
    const upload = vi.fn(fine);
    const { container } = render(<UploadField purpose="cv" endpoint="/api/public/v1/apply/t/cv" upload={upload} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file("cv.pdf"));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0]![0]).toMatchObject({ endpoint: "/api/public/v1/apply/t/cv", fields: { purpose: "cv" } });
  });

  it("refuses a file over the limit without sending it", async () => {
    const upload = vi.fn(fine);
    const { container } = render(<UploadField purpose="receipt" upload={upload} maxBytes={1024} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file("huge.pdf", 99999));
    expect(await screen.findByText("Larger than 1 KB")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("says in words when one file fails, and keeps the others", async () => {
    const upload: Uploader = ({ file: f }) => (f.name === "bad.pdf" ? Promise.reject(new Error("Upload failed. Try again.")) : Promise.resolve(doc(f.name)));
    const { container } = render(<UploadField purpose="receipt" upload={upload} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file("good.pdf"), file("bad.pdf")]);
    await waitFor(() => expect(screen.getByText("Upload failed. Try again.")).toBeInTheDocument());
    expect(screen.getByText("good.pdf")).toBeInTheDocument();
  });

  it("lets a person clear a file that failed", async () => {
    const upload: Uploader = () => Promise.reject(new Error("Check the highlighted fields"));
    const { container } = render(<UploadField purpose="attachment" upload={upload} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file("bad.pdf"));
    await userEvent.click(await screen.findByRole("button", { name: "Remove bad.pdf" }));
    expect(screen.queryByText("bad.pdf")).toBeNull();
  });

  it("sends a failed file again on Retry and hands it over when it arrives", async () => {
    const onUploaded = vi.fn();
    let tries = 0;
    const flaky: Uploader = ({ file: f }) => (tries++ === 0 ? Promise.reject(new Error("Too many requests. Wait a moment and try again.")) : Promise.resolve(doc(f.name)));
    const { container } = render(<UploadField purpose="attachment" upload={flaky} handOff onUploaded={onUploaded} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file("photo.pdf"));
    expect(await screen.findByText("Too many requests. Wait a moment and try again.")).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry photo.pdf" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith([doc("photo.pdf")]));
    await waitFor(() => expect(screen.queryByText("photo.pdf")).toBeNull());
    expect(tries).toBe(2);
  });

  it("offers no Retry for a file too large to send", async () => {
    const { container } = render(<UploadField purpose="receipt" upload={fine} maxBytes={1024} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file("huge.pdf", 99999));
    await screen.findByText("Larger than 1 KB");
    expect(screen.queryByRole("button", { name: "Retry huge.pdf" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove huge.pdf" })).toBeInTheDocument();
  });

  it("hands finished files to the caller and keeps only the failed ones", async () => {
    const onUploaded = vi.fn();
    const upload: Uploader = ({ file: f }) => (f.name === "bad.pdf" ? Promise.reject(new Error("Upload failed. Try again.")) : Promise.resolve(doc(f.name)));
    const { container } = render(<UploadField purpose="attachment" upload={upload} handOff onUploaded={onUploaded} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file("good.pdf"), file("bad.pdf")]);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith([doc("good.pdf")]));
    await waitFor(() => expect(screen.queryByText("good.pdf")).toBeNull());
    expect(screen.getByText("bad.pdf")).toBeInTheDocument();
  });

  it("hands files over in the order they were picked, whichever arrives first", async () => {
    const onUploaded = vi.fn();
    const slowFirst: Uploader = ({ file: f }) => new Promise((resolve) => setTimeout(() => resolve(doc(f.name)), f.name === "one.pdf" ? 30 : 1));
    const { container } = render(<UploadField purpose="attachment" upload={slowFirst} onUploaded={onUploaded} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file("one.pdf"), file("two.pdf"), file("three.pdf")]);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith([doc("one.pdf"), doc("two.pdf"), doc("three.pdf")]));
  });

  it("keeps only the newest file when exactly one is allowed", async () => {
    const { container } = render(<UploadField purpose="cv" upload={fine} multiple={false} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, file("first.pdf"));
    await waitFor(() => expect(screen.getByText("first.pdf")).toBeInTheDocument());
    await userEvent.upload(input, file("second.pdf"));
    await waitFor(() => expect(screen.getByText("second.pdf")).toBeInTheDocument());
    expect(screen.queryByText("first.pdf")).toBeNull();
  });

  it("takes a control of the caller's instead of the drop zone", async () => {
    const { container } = render(<UploadField purpose="attachment" upload={fine} trigger={(open) => <Button icon="clip" onClick={open}>Attach File</Button>} />);
    expect(screen.getByRole("button", { name: "Attach File" })).toBeInTheDocument();
    expect(screen.queryByText("Drop files here, or browse")).toBeNull();
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file());
    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
  });

  it("opens the picker once as it shows when asked, and not otherwise", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const { rerender } = render(<UploadField purpose="attachment" upload={fine} />);
    expect(click).not.toHaveBeenCalled();
    rerender(<UploadField key="sheet" purpose="attachment" upload={fine} autoOpen />);
    rerender(<UploadField key="sheet" purpose="attachment" upload={fine} autoOpen kinds="Photos" />);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("says what kinds of file are wanted and how big they may be", () => {
    render(<UploadField purpose="cv" upload={fine} kinds="PDF or Word" maxBytes={5 * 1024 * 1024} />);
    expect(screen.getByText("PDF or Word, up to 5 MB")).toBeInTheDocument();
  });

  it("has no accessibility violations, empty and with files", async () => {
    const { container } = render(<UploadField purpose="receipt" upload={fine} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file());
    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
