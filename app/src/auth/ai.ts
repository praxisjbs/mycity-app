import { useAuth } from "./AuthProvider";

/**
 * Whether AI may answer now (`Me.ai_available`): false while AI is switched off on AI Control or
 * the month's cap on all AI is reached. Every AI button in the hub is hidden while it is false, and
 * the form beside it is how the job is done (docs/guides/ai-control.md §6.7). The shell reads /me
 * again at its refresh and on a move to another module, so the answer follows without a poll.
 */
export function useAiAvailable(): boolean {
  const { me } = useAuth();
  return me?.ai_available !== false;
}
