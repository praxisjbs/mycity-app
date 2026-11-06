import type { ApiError } from "@/api/client";
import { Page } from "@/shell/Page";
import { Button, PageMessage, Panel } from "@mycity/ui";
import { useRouter } from "@/lib/router";

/**
 * What a person sees when the link in their email does not open: unknown,
 * expired, already used, or the network. The API's message says which, in
 * plain words; this page only picks the icon and the way forward. The careers
 * links (Apply, Assessment) answer every bad, lapsed or spent token with the
 * same 404, so their page says only that the link does not open.
 */
export function LinkProblem({ error, title, retry }: { error: ApiError; title: string; retry?: () => unknown }) {
  const { navigate } = useRouter();
  const kind = error.status === 0 ? "offline" : error.code === "TOKEN_EXPIRED" || error.status === 410 ? "expired" : error.code === "TOKEN_USED" ? "used" : error.status === 404 ? "invalid" : "other";
  const heading = {
    offline: "You Are Offline",
    expired: "This Link Has Expired",
    used: "Link Already Used",
    invalid: "This Link Does Not Open",
    other: "Something Went Wrong",
  }[kind];
  return (
    <Page title={title} layout="split">
      <Panel bare>
        <PageMessage
          icon={kind === "used" ? "ok" : kind === "offline" ? "globe" : "alert"}
          tone={kind === "used" ? "ok" : kind === "expired" ? "warn" : "neutral"}
          title={heading}
          action={
            kind === "offline" || kind === "other" ? (
              retry && (
                <Button variant="primary" size="lg" onClick={retry}>
                  Try Again
                </Button>
              )
            ) : (
              <Button variant="primary" size="lg" onClick={() => navigate("/jobs")}>
                See Open Roles
              </Button>
            )
          }
        >
          {error.message}
        </PageMessage>
      </Panel>
    </Page>
  );
}
