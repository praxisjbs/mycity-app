import type { GalleryEntry } from "../testing/gallery";
import { AnswerBubble, QuestionBubble } from "./AnswerBubble";
import { SourceChip } from "./SourceChip";

const chips = (
  <>
    <SourceChip label="leave request" count={2} onSelect={() => undefined} />
    <SourceChip label="employee" count={8} onSelect={() => undefined} />
  </>
);

const Turn = ({ paneOpen }: { paneOpen?: boolean }) => (
  <div className="flex max-w-2xl flex-col gap-3.5">
    <QuestionBubble words="Whose leave waits on me?" />
    <AnswerBubble
      text="Two requests wait on you: Ayo Bello for three days from Monday and Kemi Ade for two."
      paging="Showing 2 of 2"
      link={{ label: "Open Leave", onOpen: () => undefined }}
      from={chips}
      feedback={null}
      onFeedback={() => undefined}
      onPane={() => undefined}
      paneOpen={paneOpen}
    />
  </div>
);

export default {
  component: "AnswerBubble",
  states: {
    "A Turn": () => <Turn />,
    "Pane Shown": () => <Turn paneOpen />,
    "More Rows": () => (
      <AnswerBubble text="There are 312 people in all. Here are the first 25." paging="Showing 25 of 312" onNext={() => Promise.resolve()} feedback="up" onFeedback={() => undefined} from={<SourceChip label="employee" count={25} />} />
    ),
    "One Record": () => <AnswerBubble text="Ayo Bello has 14 of 20 annual leave days left." from={<SourceChip kind="record" label="Ayo Bello" onSelect={() => undefined} />} feedback={null} onFeedback={() => undefined} />,
  },
} satisfies GalleryEntry;
