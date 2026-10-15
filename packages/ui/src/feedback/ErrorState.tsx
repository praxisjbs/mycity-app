/**
 * @component ErrorState
 * @group Feedback
 * @summary Something did not load: one line saying so, and Try Again.
 * @use In place of a list, a card's content or a screen whose request failed (pass the ApiError and the reload); the fallback of ErrorBoundary.
 * @avoid A failed save (use toast.error, or the field's own mark); an empty result (use EmptyState); a stack trace, an error code or an apology paragraph.
 * @phone Centred; Try Again is full width within thumb reach.
 * @a11y role="alert", so the line is announced when it replaces the content. Try Again is a real button; it is left out where trying again cannot help (no access, not found). The server's reference, when there is one, is shown for support as data.
 * @status stable
 * @example <ErrorState error={list.error} onRetry={list.reload} />
 * @example <ErrorState page message="This screen hit a problem" onRetry={reset} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { Illustration } from "../illustrations/Illustration";

/** The parts of an API error this reads; the merged ApiError and a plain Error both fit. */
export interface ErrorLike {
  /** HTTP status; 0 when the network failed. */
  status?: number;
  /** The server's message; not shown (the line is chosen from the status), kept for logs. */
  message?: string;
  /** The support reference the server returned, shown as data. */
  reference?: string | null;
}

export interface ErrorStateProps {
  /** The failure: the ApiError of the request (useApi's or usePaged's `error`). */
  error?: ErrorLike | null;
  /** The line, when the status does not say enough (sentence case, at most 8 words). */
  message?: ReactNode;
  /** Reloads what failed; shows Try Again. */
  onRetry?: () => void;
  /** A whole screen failed: the error drawing instead of the glyph, with more room. */
  page?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The one line for a status. */
export function errorLine(error?: ErrorLike | null): string {
  switch (error?.status) {
    case 0:
      return "You are offline";
    case 401:
    case 403:
      return "You do not have access to this";
    case 404:
      return "This was not found";
    default:
      return "This did not load";
  }
}

const HOPELESS = new Set([401, 403, 404]);

export function ErrorState({ error, message, onRetry, page, className }: ErrorStateProps) {
  const retry = onRetry && !HOPELESS.has(error?.status ?? -1);
  return (
    <div role="alert" data-error-state="" className={cn("flex flex-col items-center px-4 text-center", page ? "py-12" : "py-6", className)}>
      {page ? (
        <Illustration name="Error" className="mx-auto mb-3 phone:w-18" />
      ) : (
        <span className="mb-2.5 flex size-11 items-center justify-center rounded-card bg-destructive-soft text-destructive">
          <Icon name="alert" size="m" />
        </span>
      )}
      <p className={cn("font-strong", page ? "text-base" : "text-sm")}>{message ?? errorLine(error)}</p>
      {error?.reference && (
        <p className="mt-1 text-xs text-subtle-foreground">
          Reference <span data-copy="content">{error.reference}</span>
        </p>
      )}
      {retry && (
        <Button className="mt-3 phone:w-full" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}
