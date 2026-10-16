import type { ApiError } from "@/api/client";
import { Page } from "@/shell/Page";
import { Button, PageMessage } from "@mycity/ui";
import { useRouter } from "@/lib/router";

/**
 * What a person sees when the link in their email does not open: unknown,
 * expired, already used, or the network. The API's message says which, in
 * plain words; this page only picks the icon and the way forward.
 */
export function LinkProblem({ error, title, retry }: { error: ApiError; title: string; retry?: () => void }) {
  const { navigate } = useRouter();
  const kind = error.status === 0 ? "offline" : error.code === "TOKEN_EXPIRED" || error.status === 410 ? "expired" : error.code === "TOKEN_USED" ? "used" : error.status === 404 ? "invalid" : "other";
  const heading = {
    offline: "You appear to be offline",
    expired: "This link has expired",
    used: "This link has already been used",
    invalid: "This link is not valid",
    other: "Something went wrong",
  }[kind];
  return (
    <Page title={title}>
      <PageMessage
        icon={kind === "used" ? "ok" : kind === "offline" ? "globe" : "alert"}
        tone={kind === "used" ? "ok" : kind === "expired" ? "warn" : "neutral"}
        title={heading}
        action={kind === "offline" || kind === "other" ? retry && <Button variant="primary" onClick={retry}>Try Again</Button> : <Button onClick={() => navigate("/jobs")}>See Open Roles</Button>}
      >
        {error.message}
      </PageMessage>
    </Page>
  );
}
