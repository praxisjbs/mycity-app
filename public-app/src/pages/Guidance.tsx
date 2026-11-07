import { Button, PageMessage, Panel, type IconName } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";

/** Each guidance screen: the page it stands for, its one line, its heading and the one way on. */
const GUIDE: Record<"apply" | "assess" | "sign", { page: string; line: string; title: string; icon: IconName; action: string; to: string }> = {
  apply: { page: "Apply", line: "An application starts from the role you want.", title: "Start From a Role", icon: "doc", action: "See Open Roles", to: "/jobs" },
  assess: { page: "Assessment", line: "Your assessment opens from the link we emailed you.", title: "Use Your Email Link", icon: "mail", action: "See Open Roles", to: "/jobs" },
  sign: { page: "Sign Offer", line: "Your offer opens from the link in its email.", title: "Use Your Offer Email", icon: "signature", action: "Verify a Document", to: "/verify" },
};

/**
 * A page a person is sent to by a link of their own, opened from the header without one (`/apply`,
 * `/assess`, `/sign`): the split layout with one heading, one line and one
 * button that leads where the page can start.
 */
export function Guidance({ of }: { of: keyof typeof GUIDE }) {
  const { navigate } = useRouter();
  const g = GUIDE[of];
  return (
    <Page title={g.page} layout="split" text={g.line}>
      <Panel bare>
        <PageMessage
          icon={g.icon}
          title={g.title}
          action={
            <Button variant="primary" size="lg" onClick={() => navigate(g.to)}>
              {g.action}
            </Button>
          }
        />
      </Panel>
    </Page>
  );
}
