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
    "A Question": () => (
      <div className="flex max-w-2xl flex-col gap-3.5">
        <QuestionBubble words="Assign a task to Bode to send the weekly report." />
        <AnswerBubble text="When is it due?" choices={["Today", "Tomorrow", "Friday", "No Due Day"]} onChoose={() => Promise.resolve()} feedback={null} onFeedback={() => undefined} />
      </div>
    ),
    "A Document": () => (
      <div className="flex max-w-2xl flex-col gap-3.5">
        <QuestionBubble words="Raise an expense request from this invoice" file={{ name: "INV-202611-9525.pdf", onOpen: () => undefined }} />
        <AnswerBubble text="This invoice from JBS Praxis asks for the balance of ₦150,000.00." feedback={null} onFeedback={() => undefined} />
      </div>
    ),
  },
} satisfies GalleryEntry;
