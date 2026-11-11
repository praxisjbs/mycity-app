import type { GalleryEntry } from "../testing/gallery";
import { QuestionCard } from "./QuestionCard";

const wait = () => new Promise((resolve) => setTimeout(resolve, 600));

export default {
  component: "QuestionCard",
  states: {
    "With a Suggestion": () => (
      <QuestionCard
        group="Audience and Reach"
        position="2 of 9"
        question="How many guests do they expect each night?"
        why="Sizes the promotion and the check-in team."
        kind="number"
        suggested={1500}
        suggestedFrom="From the transcript, 00:21:51"
        required
        state="open"
        onAnswer={wait}
        onReshuffle={wait}
      />
    ),
    "A Pick": () => (
      <QuestionCard group="The Offer" position="5 of 9" question="Which packages should go on sale?" kind="multi_pick" options={["Regular", "VIP", "VVIP"]} suggested={["Regular", "VIP"]} suggestedFrom="From the deal" state="open" onAnswer={wait} onSkip={wait} onReshuffle={wait} />
    ),
    Answered: () => (
      <QuestionCard group="Money" position="3 of 9" question="What is the early bird price?" kind="money" answer="12000.00" state="answered" onAnswer={wait} onSkip={wait} />
    ),
  },
} satisfies GalleryEntry;
