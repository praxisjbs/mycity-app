/**
 * @component OtpField
 * @group Forms
 * @summary A one-time code in separate boxes: each digit moves to the next, a pasted code fills them all.
 * @use An authenticator app's code at sign-in, and a PIN (`secret`, 4 boxes): the lock screen, My Security.
 * @avoid Any other number (use NumberField).
 * @phone Each box is 44 px; the number keyboard opens, and the one-time-code keyboard offers a code from a text message.
 * @a11y A group named by its label; each box says which digit it is; autocomplete one-time-code on the first box; a secret code is never offered to a password manager. Inside a Field, the label names the first box and the error is linked to the group.
 * @status stable
 * @example <OtpField label="Sign-In Code" value={code} onChange={setCode} onComplete={signIn} />
 * @example <OtpField label="PIN" length={4} secret value={pin} onChange={setPin} />
 */
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

export interface OtpFieldProps {
  /** The digits typed so far. */
  value: string;
  /** Called with the digits; a full code has `length` of them. */
  onChange: (value: string) => void;
  /** Names the group: Title Case, at most 4 words. */
  label: string;
  /** How many digits; 6. */
  length?: number;
  /** The mark. */
  state?: FieldState;
  /** Unused here (a Field around it shows it). */
  message?: string;
  /** Dots in place of the digits, for a PIN. */
  secret?: boolean;
  /** Called with the code once every box is filled, to go on without a button press. */
  onComplete?: (value: string) => void;
  /** The first box's id; a Field around it gives one. */
  id?: string;
}

export function OtpField({ value, onChange, label, length = 6, state, secret = false, onComplete, id }: OtpFieldProps) {
  const ctl = useFieldControl({ id, state });
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const set = (code: string) => {
    onChange(code);
    if (code.length === length && /^\d+$/.test(code)) onComplete?.(code);
  };
  const put = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    set(next.join("").slice(0, length));
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      put(i - 1, "");
      focus(i - 1);
    } else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "ArrowRight") focus(i + 1);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const code = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!code) return;
    e.preventDefault();
    set(code);
    focus(code.length);
  };

  return (
    <div role="group" aria-label={label} aria-describedby={ctl["aria-describedby"]} className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          id={i === 0 ? ctl.id : undefined}
          type={secret ? "password" : "text"}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={ctl["aria-invalid"]}
          autoComplete={!secret && i === 0 ? "one-time-code" : "off"}
          data-1p-ignore={secret || undefined}
          data-lpignore={secret ? "true" : undefined}
          inputMode="numeric"
          maxLength={1}
          className={cn(controlClass(ctl.state), "h-control w-11 min-w-tap px-0 text-center text-lg tabular-nums phone:h-tap")}
          value={d}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(-1);
            put(i, v);
            if (v) focus(i + 1);
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
        />
      ))}
    </div>
  );
}
