import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { AnswerBubble, QuestionBubble } from "./AnswerBubble";
import { AssistantShell } from "./AssistantShell";
import { PaneTabs } from "./PaneTabs";
import { SourceChip } from "./SourceChip";
import { SourcesPane } from "./SourcesPane";
import type { PaneRead, PaneTab } from "./pane";

const READS: PaneRead[] = [{ n: 1, name: "Leave Requests", kind: "read", outcome: "read", filters: [["Status", "waiting"]], rows: 2, total: 2, masked: [], opens: true }];

const log = (
  <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
    <QuestionBubble words="Whose leave waits on me?" />
    <AnswerBubble text="Two requests wait on you: Ayo Bello for three days from Monday and Kemi Ade for two." from={<SourceChip label="leave request" count={2} onSelect={() => undefined} />} feedback={null} onFeedback={() => undefined} paneOpen />
  </div>
);

function Screen({ back, aside }: { back?: boolean; aside?: boolean }) {
  const [tab, setTab] = useState<PaneTab>("sources");
  const [recent, setRecent] = useState(aside ?? false);
  return (
    <div className="flex h-120 flex-col">
      <AssistantShell
        title="Praxis AI"
        back={back ? { to: "People · Leave", onBack: () => undefined } : null}
        actions={
          <>
            <Button icon="history" aria-pressed={recent} onClick={() => setRecent((r) => !r)}>
              Recent
            </Button>
            <Button icon="plus">New Conversation</Button>
          </>
        }
        conversation={log}
        pane={<PaneTabs value={tab} onValueChange={setTab} sources={<SourcesPane reads={READS} onOpenTable={() => undefined} />} />}
        aside={<p className="p-3 text-sm text-muted-foreground">Your conversations, newest first.</p>}
        asideOpen={recent}
      />
    </div>
  );
}

export default {
  component: "AssistantShell",
  states: {
    "From a Screen": () => <Screen back />,
    "No Back Target": () => <Screen />,
    "Recent Open": () => <Screen back aside />,
  },
} satisfies GalleryEntry;
