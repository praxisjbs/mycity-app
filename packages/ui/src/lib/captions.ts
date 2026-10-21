/**
 * The browser's own captions while someone records (docs/guides/integrations.md §1.2 decision 8):
 * the Web Speech API writes what it hears beside the recording, and the words go with the voice
 * note as the transcript's last resort, used only when Groq and Gemini both fail.
 *
 *   const captions = startCaptions();     // null where the browser has no recogniser (Firefox)
 *   ... recording ...
 *   const words = captions?.stop() ?? ""; // what it heard, final results only
 *
 * Chrome, Edge and Safari have one. It stops itself after a pause, so it is started again until
 * stop() is called; an error (no permission, a device that lets only one thing use the microphone,
 * no network for a recogniser that needs one) ends the captions quietly and the recording goes on.
 */

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

/** The part of SpeechRecognition used here. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

/** The browser's recogniser, or null. */
function recogniser(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can caption a recording. */
export const captionsSupported = (): boolean => recogniser() !== null;

/** A running caption: stop() ends it and answers what it heard. */
export interface Captions {
  stop(): string;
}

/**
 * Start captioning the microphone, in the person's language (Nigerian English when the browser
 * names none). Null where the browser cannot.
 * @param lang  a BCP 47 language tag; the browser's own language unless given
 */
export function startCaptions(lang?: string): Captions | null {
  const Ctor = recogniser();
  if (!Ctor) return null;
  const heard: string[] = [];
  let running = true;
  let r: Recognition;
  try {
    r = new Ctor();
  } catch {
    return null;
  }
  r.lang = lang || (typeof navigator !== "undefined" && navigator.language) || "en-NG";
  r.continuous = true;
  r.interimResults = false;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const res = e.results[i];
      const words = res && res.isFinal ? res[0].transcript.trim() : "";
      if (words) heard.push(words);
    }
  };
  r.onerror = () => {
    running = false;
  };
  // A recogniser stops itself after a pause; while the recording goes on it starts again.
  r.onend = () => {
    if (!running) return;
    try {
      r.start();
    } catch {
      running = false;
    }
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop() {
      running = false;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
      return heard.join(" ").replace(/\s+/g, " ").trim();
    },
  };
}
