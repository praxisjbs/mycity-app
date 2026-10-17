import { useEffect } from "react";
import { Button, PageMessage } from "@mycity/ui";
import { useScreenState, plan } from "@/lib/plan";
import { parse, RouterProvider, useRouter } from "@/lib/router";
import { Apply } from "@/pages/Apply";
import { Assessment } from "@/pages/Assessment";
import { Careers } from "@/pages/Careers";
import { SignOffer } from "@/pages/SignOffer";
import { Vacancy } from "@/pages/Vacancy";
import { Verify } from "@/pages/Verify";
import { Page } from "@/shell/Page";
import { PlannedPage, ViewBar } from "@/shell/Planned";

/** The public site: six pages, no shell, no sign-in (A9). */
export function App() {
  return (
    <RouterProvider>
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
    return <PlannedPage page={r.page} title={TITLE[r.page]} m={state.screen?.m ?? "M11"} production={state.production} mock={import.meta.env.VITE_API_MODE === "mock" && state.rule === "mock"} />;
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

/** The Prototype View switch, in mock mode only (lib/plan.ts). */
function Preview() {
  const rule = plan.useOpenRule();
  return import.meta.env.VITE_API_MODE === "mock" && rule === "mock" ? <ViewBar /> : null;
}

function NotFound() {
  const { navigate } = useRouter();
  return (
    <Page title="Page Not Found">
      <PageMessage title="There is nothing at this address" action={<Button variant="primary" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
        The link may be mistyped. If it came in an email from us, open it again from the email.
      </PageMessage>
    </Page>
  );
}
