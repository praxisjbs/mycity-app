import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Pill } from "../display/Pill";
import { ArticleBody, Reader } from "./Reader";
import { ARTICLE_GROUPS } from "./fixtures";

const Reading = () => {
  const [selected, setSelected] = useState("a1");
  const title = ARTICLE_GROUPS.flatMap((g) => g.items).find((i) => i.key === selected)?.title ?? "";
  return (
    <Reader groups={ARTICLE_GROUPS} selected={selected} onSelect={setSelected}>
      <ArticleBody
        title={title}
        meta={
          <>
            <Pill tone="info">People</Pill>
            <span className="text-2xs text-subtle-foreground">Updated 13/10/2026</span>
          </>
        }
      >
        <p>Open the app on your phone and sign in with the address People gave you.</p>
        <h2>Clocking in</h2>
        <p>Tap the yellow button at the bottom right, then Clock In. Your location is read once, for that reading alone.</p>
        <ul>
          <li>On site, at one of the worksites People set up</li>
          <li>Remote, where your work pattern allows it</li>
        </ul>
        <blockquote>Your manager sees the week, not where you were at each moment.</blockquote>
      </ArticleBody>
    </Reader>
  );
};

export default {
  component: "Reader",
  states: { Reading },
} satisfies GalleryEntry;
