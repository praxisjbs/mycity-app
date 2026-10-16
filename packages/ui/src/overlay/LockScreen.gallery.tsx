import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { LoginField } from "../form/LoginField";
import { LockScreen } from "./LockScreen";
import { useGalleryFrame } from "./gallery-frame";

function Locks({ label, title, reason }: { label: string; title: string; reason: string }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  return (
    <div ref={ref}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <LockScreen
        open={open}
        container={frame}
        name="Cynthia Osakunih"
        email="cynthia@mycityapp.io"
        title={title}
        reason={reason}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Sign Out
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Unlock
            </Button>
          </>
        }
      >
        <LoginField id="gallery-lock-pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={setPass} onBlur={() => undefined} error="" good={pass.length >= 8} buzz={0} />
      </LockScreen>
    </div>
  );
}

export default {
  component: "LockScreen",
  states: {
    Idle: () => <Locks label="Lock After Idle" title="Session Locked" reason="Locked after 30 minutes idle" />,
    "Time Limit": () => <Locks label="Reach Time Limit" title="Session Ended" reason="Two hours is the limit" />,
    "Ended Elsewhere": () => <Locks label="End Elsewhere" title="Signed Out" reason="This session was ended" />,
  },
} satisfies GalleryEntry;
