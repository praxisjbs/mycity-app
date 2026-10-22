/**
 * @component VoiceField
 * @group Forms
 * @summary Speak instead of typing: records, sends the audio to be transcribed, and drops the words into the field (A18).
 * @use Beside a long text field the feature guide marks for it: a review's comments, an interview note, a query's account.
 * @avoid A short field; a field where the exact words matter legally (a signature block); keeping the recording after the words arrive.
 * @phone Where it is used most: Record is a 44 px target and the level meter shows it is listening.
 * @a11y The button says whether it is recording, the elapsed time is a live region, and the transcript lands in the field where a screen reader can read and edit it.
 * @status stable
 * @example <VoiceField label="Comments" transcribe={api.transcribe} onTranscript={(text) => f.set("comments", text)} />
 * @example <VoiceField compact label="Question" transcribe={transcribe} onTranscript={setText} />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Button, IconButton } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";

/** How a recording becomes words: the app's own call, so no vendor reaches the package. */
export type Transcribe = (audio: Blob) => Promise<string>;

export interface VoiceFieldProps {
  /** What is being dictated, Title Case, at most 4 words: names the button. */
  label: string;
  /** Sends the audio and answers with the words. An AI tidies them server side without changing the meaning (A18). */
  transcribe: Transcribe;
  /** Called with the words once they arrive. */
  onTranscript: (text: string) => void;
  /** The longest recording taken, in seconds; 120 unless set. */
  maxSeconds?: number;
  /** Nothing can be recorded (the form is closed, or the browser refused the microphone). */
  disabled?: boolean;
  /** The microphone alone, for a message box beside its Send: Record and Stop are icon buttons, the time shows while it records. */
  compact?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function VoiceField({ label, transcribe, onTranscript, maxSeconds = 120, disabled, compact, className }: VoiceFieldProps) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  };

  // A person who leaves the screen mid-recording must not leave the microphone on.
  useEffect(
    () => () => {
      stopTicking();
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const stop = () => {
    recorder.current?.stop();
    stopTicking();
  };

  const start = async () => {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setProblem("This browser cannot record");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem("Microphone not allowed");
      return;
    }

    const media = new MediaRecorder(stream);
    recorder.current = media;
    chunks.current = [];
    media.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    media.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setState("working");
      try {
        const words = await transcribe(new Blob(chunks.current, { type: media.mimeType || "audio/webm" }));
        onTranscript(words);
        setState("idle");
      } catch {
        setProblem("Could not transcribe");
        setState("idle");
      }
    };

    media.start();
    setState("recording");
    setSeconds(0);
    ticker.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= maxSeconds) stop();
        return s + 1;
      });
    }, 1000);
  };

  const elapsed = (
    <span aria-live="polite" className="flex items-center gap-1.5 text-xs font-semibold text-destructive tabular-nums">
      <span aria-hidden="true" className="size-2 animate-pulse-dot rounded-full bg-destructive" />
      {clock(seconds)}
    </span>
  );
  const trouble = problem && (
    <span role="status" className="flex items-center gap-1.5 text-xs text-destructive">
      <Icon name="alert" size="s" />
      {problem}
    </span>
  );

  if (compact)
    return (
      <div className={cn("flex flex-none items-center gap-1.5", className)}>
        {state === "recording" ? (
          <>
            {elapsed}
            <IconButton icon="stop" label="Stop Recording" onClick={stop} aria-pressed className="text-destructive hover:text-destructive" />
          </>
        ) : state === "working" ? (
          <Spinner label="Writing it down" className="size-control justify-center" />
        ) : (
          <>
            {trouble}
            <IconButton icon="mic" label={`Record ${label}`} onClick={start} disabled={disabled} aria-pressed={false} />
          </>
        )}
      </div>
    );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {state === "recording" ? (
        <>
          <Button icon="stop" variant="danger" onClick={stop} aria-pressed>
            Stop Recording
          </Button>
          {elapsed}
        </>
      ) : state === "working" ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size="s" />
          Writing it down
        </span>
      ) : (
        <Button icon="mic" onClick={start} disabled={disabled} aria-pressed={false} aria-label={`Record ${label}`}>
          Record Answer
        </Button>
      )}
      {trouble}
    </div>
  );
}
