import { useEffect } from "react";
import { Button } from "@mycity/ui";
import { Message, Page } from "@/components/Layout";
import { ComingSoon, ViewBar } from "@/components/Planned";
import { StagingBar } from "@/components/StagingBar";
import { useIsProduction, useScreenState } from "@/lib/plan";
import { parse, RouterProvider, useRouter } from "@/lib/router";
import { Apply } from "@/pages/Apply";
import { Assessment } from "@/pages/Assessment";
import { Careers } from "@/pages/Careers";
import { SignOffer } from "@/pages/SignOffer";
import { Vacancy } from "@/pages/Vacancy";
import { Verify } from "@/pages/Verify";

/** The public site: six pages, no shell, no sign-in (A9). */
export function App() {
  return (
    <RouterProvider>
      <StagingBar />
      <Preview />
      <Routes />
    </RouterProvider>
  );
}

function Routes() {
  const { path, navigate } = useRouter();
  /* The site's front door is the careers list. */
  useEffect(() => {
    if (path === "/") navigate("/jobs", { replace: true });
  }, [path, navigate]);
  const r = parse(path);
  const state = useScreenState(r.page);
  if (r.page !== "not-found" && !state.open)
    return <ComingSoon page={r.page} title={TITLE[r.page]} m={state.plan?.m ?? "M11"} production={state.production} />;
  switch (r.page) {
    case "careers": return <Careers />;
    case "vacancy": return <Vacancy key={r.slug} slug={r.slug} />;
    case "apply": return <Apply key={r.token} token={r.token} />;
    case "assess": return <Assessment key={r.token} token={r.token} />;
    case "sign": return <SignOffer key={r.token} token={r.token} />;
    case "verify": return <Verify key={r.number ?? ""} number={r.number} />;
    default: return <NotFound />;
  }
}

const TITLE: Record<string, string> = { careers: "Careers", vacancy: "Vacancy", apply: "Apply", assess: "Assessment", sign: "Sign Offer", verify: "Verify a Document" };

/** The prototype view switch, everywhere but production (lib/plan.ts). */
function Preview() {
  return useIsProduction() ? null : <ViewBar />;
}

function NotFound() {
  const { navigate } = useRouter();
  return (
    <Page title="Page Not Found">
      <Message title="There is nothing at this address" action={<Button variant="primary" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
        The link may be mistyped. If it came in an email from us, open it again from the email.
      </Message>
    </Page>
  );
}
