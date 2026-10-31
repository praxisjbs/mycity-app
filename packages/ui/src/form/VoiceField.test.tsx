import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { VoiceField } from "./VoiceField";
import { ApiError } from "../data/createApi";

/** A MediaRecorder double: jsdom has none, and no microphone either. */
class FakeRecorder {
  static made: FakeRecorder[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  constructor(public stream: MediaStream) {
    FakeRecorder.made.push(this);
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(["sound"]) });
    this.onstop?.();
  }
}

const tracks = { stop: vi.fn() };

beforeEach(() => {
  FakeRecorder.made = [];
  tracks.stop.mockClear();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [tracks] } as unknown as MediaStream) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoiceField", () => {
  it("offers to record, named for what is being dictated", () => {
    render(<VoiceField label="Comments" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Record Comments" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("says the action in its own words when given, still named for what is dictated", () => {
    render(<VoiceField label="What To Say" action="Dictate" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Record What To Say" })).toHaveTextContent("Dictate");
  });

  it("records, then hands the words to the field", async () => {
    const transcribe = vi.fn().mockResolvedValue("He met every goal this quarter.");
    const onTranscript = vi.fn();
    render(<VoiceField label="Comments" transcribe={transcribe} onTranscript={onTranscript} />);

    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    const stop = await screen.findByRole("button", { name: "Stop Recording" });
    expect(stop).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("0:00")).toHaveAttribute("aria-live", "polite");

    await userEvent.click(stop);
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("He met every goal this quarter."));
    expect(transcribe.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it("says it is writing the words down while it waits", async () => {
    let finish: (text: string) => void = () => undefined;
    render(<VoiceField label="Comments" transcribe={() => new Promise((r) => (finish = r))} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop Recording" }));
    expect(await screen.findByText("Writing it down")).toBeInTheDocument();
    finish("done");
    await waitFor(() => expect(screen.getByRole("button", { name: "Record Comments" })).toBeInTheDocument());
  });

  it("turns the microphone off once it has stopped", async () => {
    render(<VoiceField label="Comments" transcribe={vi.fn().mockResolvedValue("x")} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop Recording" }));
    await waitFor(() => expect(tracks.stop).toHaveBeenCalled());
  });

  it("says so in words when the microphone is refused", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("no")) },
    });
    render(<VoiceField label="Comments" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    expect(await screen.findByText("Microphone not allowed")).toBeInTheDocument();
  });

  it("says so when the browser cannot record at all", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VoiceField label="Comments" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    expect(await screen.findByText("This browser cannot record")).toBeInTheDocument();
  });

  it("says so when the words do not come back, and offers to record again", async () => {
    render(<VoiceField label="Comments" transcribe={vi.fn().mockRejectedValue(new Error("no"))} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop Recording" }));
    expect(await screen.findByText("Could not transcribe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Comments" })).toBeInTheDocument();
  });

  it("gives the server's own reason when it refuses", async () => {
    const refused = new ApiError(503, { error: { code: "AI_DISABLED", message: "AI is switched off." } } as never);
    render(<VoiceField label="Comments" transcribe={vi.fn().mockRejectedValue(refused)} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop Recording" }));
    expect(await screen.findByText("AI is switched off.")).toBeInTheDocument();
  });

  it("turns the microphone off when the person leaves mid-recording", async () => {
    const { unmount } = render(<VoiceField label="Comments" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Record Comments" }));
    await screen.findByRole("button", { name: "Stop Recording" });
    unmount();
    expect(tracks.stop).toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<VoiceField label="Comments" transcribe={vi.fn()} onTranscript={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("compact, in a message box", () => {
    it("is the microphone alone, named for what is dictated, with the time and Stop while it records", async () => {
      const onTranscript = vi.fn();
      render(<VoiceField compact label="Question" transcribe={vi.fn().mockResolvedValue("Who is late today?")} onTranscript={onTranscript} />);
      const record = screen.getByRole("button", { name: "Record Question" });
      expect(record).toHaveTextContent("");
      await userEvent.click(record);
      const stop = await screen.findByRole("button", { name: "Stop Recording" });
      expect(stop).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("0:00")).toHaveAttribute("aria-live", "polite");
      await userEvent.click(stop);
      await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Who is late today?"));
      expect(screen.getByRole("button", { name: "Record Question" })).toBeInTheDocument();
    });

    it("says it is writing the words down while it waits, to a screen reader", async () => {
      let finish: (text: string) => void = () => undefined;
      render(<VoiceField compact label="Question" transcribe={() => new Promise((r) => (finish = r))} onTranscript={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: "Record Question" }));
      await userEvent.click(await screen.findByRole("button", { name: "Stop Recording" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Writing it down");
      finish("done");
      await waitFor(() => expect(screen.getByRole("button", { name: "Record Question" })).toBeInTheDocument());
    });

    it("has no accessibility violations", async () => {
      const { container } = render(<VoiceField compact label="Question" transcribe={vi.fn()} onTranscript={vi.fn()} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
