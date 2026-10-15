/**
 * @component ErrorBoundary
 * @group Feedback
 * @summary Catches a crash in one screen so the rest of the app keeps working, and shows ErrorState with Try Again in its place.
 * @use Around each screen in the shell, keyed by module and tab so moving to another screen starts it fresh; around a lazily loaded heavy part (a chart, the editor).
 * @avoid Catching a failed request (useApi gives its error to ErrorState); wrapping every small component; hiding a bug that should be fixed.
 * @phone The same ErrorState, its Try Again full width.
 * @a11y The fallback is role="alert"; the rail, the tabs and the back button stay usable. Try Again renders the children again.
 * @status stable
 * @example <ErrorBoundary key={`${module}:${tab}`}><Screen /></ErrorBoundary>
 * @example <ErrorBoundary fallback={(error, reset) => <ErrorState message="The chart did not draw" onRetry={reset} />}>{chart}</ErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./ErrorState";

export interface ErrorBoundaryProps {
  /** What it guards: a screen, or a heavy part of one. */
  children?: ReactNode;
  /** What shows instead; a function gets the error and a reset. Default: ErrorState, "This screen hit a problem", Try Again. */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Told of each crash (to report it); the console always gets it too. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When any of these change while the fallback shows, the children render again (a route, a record id). */
  resetKeys?: readonly unknown[];
}

interface State {
  error: Error | null;
}

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen crashed", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.error && changed(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback(error, this.reset);
    if (fallback !== undefined) return fallback;
    return <ErrorState page message="This screen hit a problem" onRetry={this.reset} />;
  }
}
