import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@mycity/ui";
import { EmptyState } from "@/components/ui/data";

/**
 * Catches a crash in one screen so the rest of the app keeps working: the
 * rail, the tabs and the browser's back button still respond, and only the
 * screen's own area shows the error. The shell keys it by module and tab, so
 * moving to another screen (or back) starts it fresh.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        icon="alert"
        title="This screen hit a problem"
        text="Nothing was saved or lost. Try again."
        action={<Button icon="right" onClick={() => this.setState({ error: null })}>Try Again</Button>}
      />
    );
  }
}
