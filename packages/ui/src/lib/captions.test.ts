import { afterEach, describe, expect, it } from "vitest";
import { captionsSupported, startCaptions } from "./captions";

type Handler = ((e: unknown) => void) | null;

/** A recogniser standing in for the browser's, driven by the test. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = true;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  starts = 0;
  stops = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.starts += 1;
  }
  stop() {
    this.stops += 1;
  }
  say(words: string, isFinal = true) {
    const result = Object.assign([{ transcript: words }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

describe("startCaptions", () => {
  afterEach(() => {
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    FakeRecognition.last = null;
  });

  it("is null where the browser has no recogniser", () => {
    expect(captionsSupported()).toBe(false);
    expect(startCaptions()).toBeNull();
  });

  it("keeps final results only, in the language asked, and answers them on stop", () => {
    w.webkitSpeechRecognition = FakeRecognition;
    const c = startCaptions("en-NG");
    const r = FakeRecognition.last!;
    expect([r.lang, r.continuous, r.interimResults, r.starts]).toEqual(["en-NG", true, false, 1]);
    r.say("All on track");
    r.say("for Fri", false);
    r.say(" for Friday ");
    expect(c!.stop()).toBe("All on track for Friday");
    expect(r.stops).toBe(1);
  });

  it("starts again after a pause until stopped; an error ends it quietly", () => {
    w.SpeechRecognition = FakeRecognition;
    const c = startCaptions();
    const r = FakeRecognition.last!;
    r.onend?.(null);
    expect(r.starts).toBe(2);
    r.onerror?.(null);
    r.onend?.(null);
    expect(r.starts).toBe(2);
    expect(c!.stop()).toBe("");
  });
});
