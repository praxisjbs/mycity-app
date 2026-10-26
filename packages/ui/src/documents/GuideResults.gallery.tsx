import type { GalleryEntry } from "../testing/gallery";
import { GuideAnswerCard, GuideResults, type GuideAnswerView, type GuideHitView } from "./GuideResults";
import { GUIDE_ANSWER, GUIDE_HITS } from "./fixtures";

const hits = GUIDE_HITS as unknown as GuideHitView[];
const answer = GUIDE_ANSWER as unknown as GuideAnswerView;

export default {
  component: "GuideResults",
  states: {
    Default: () => <GuideResults hits={hits} onOpen={() => undefined} />,
    "With Answer": () => (
      <div className="flex flex-col gap-3">
        <GuideAnswerCard answer={answer} onOpen={() => undefined} />
        <GuideResults hits={hits} onOpen={() => undefined} />
      </div>
    ),
    "Writing Answer": () => <GuideAnswerCard answer={null} onOpen={() => undefined} />,
    "No Answer": () => <GuideAnswerCard answer={{ found: false, sentences: [], sources: hits }} onOpen={() => undefined} />,
  },
} satisfies GalleryEntry;
