import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Card, CardHeader } from "../layout/Card";
import { ErrorBoundary } from "./ErrorBoundary";

function Roster({ crash }: { crash: boolean }) {
  if (crash) throw new Error("The roster failed to draw");
  return (
    <Card>
      <CardHeader title="Team Roster" />
      <p className="text-sm">12 in, 2 late, 1 on leave</p>
    </Card>
  );
}

/** Crashes only when asked, so the gallery crawl sees no script error. */
function Guarded() {
  const [crash, setCrash] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button className="self-start" onClick={() => setCrash(true)}>
        Crash Screen
      </Button>
      <ErrorBoundary onError={() => setCrash(false)}>
        <Roster crash={crash} />
      </ErrorBoundary>
    </div>
  );
}

export default {
  component: "ErrorBoundary",
  states: {
    "Guarding a Screen": () => <Guarded />,
  },
} satisfies GalleryEntry;
