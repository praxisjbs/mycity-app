import { lazy, Suspense, useEffect } from "react";
import { Button, PageMessage, Panel, Skeleton } from "@mycity/ui";
import { useScreenState } from "@/lib/plan";
import { parse, RouterProvider, useRouter } from "@/lib/router";
import { Careers } from "@/pages/Careers";
import { Guidance } from "@/pages/Guidance";
import { Help } from "@/pages/Help";
import { Home } from "@/pages/Home";
import { Proposal } from "@/pages/Proposal";
import { Vacancy } from "@/pages/Vacancy";
import { Verify } from "@/pages/Verify";
import { Page } from "@/shell/Page";
import { PlannedPage } from "@/shell/Planned";

/*
 * The pages reached by a token load on their own: Apply and Sign Offer check their forms with the
 * contract's schemas, which bring Zod, and a stranger opening Careers or a vacancy should not wait for it.
 */
const Apply = lazy(() => import("@/pages/Apply").then((m) => ({ default: m.Apply })));
const Assessment = lazy(() => import("@/pages/Assessment").then((m) => ({ default: m.Assessment })));
const SignOffer = lazy(() => import("@/pages/SignOffer").then((m) => ({ default: m.SignOffer })));

function Loading({ title }: { title: string }) {
  return (
    <Page title={title} layout="split">
      <Panel>
        <Skeleton lines={7} />
      </Panel>
    </Page>
  );
}

/** The public site: the index, its pages and Help under one header, no sign-in (A9). */
export function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}

/** Which page's PROGRESS row decides whether a route opens yet (F14). */
const ROW: Record<string, string> = { home: "home", careers: "careers", vacancy: "vacancy", apply: "apply", assess: "assess", sign: "sign", verify: "verify", "verify-qr": "verify", proposal: "proposal", help: "help" };

function Routes() {
  const { path, search, navigate } = useRouter();
  const r = parse(path);
  /* /vacancy and /jobs/ are the open roles too: the address is put back to the one people share. */
  const moved = r.page === "careers" && path !== "/jobs";
  useEffect(() => {
    if (moved) navigate(`/jobs${search}`, { replace: true });
  }, [moved, search, navigate]);
  const row = r.page === "guide" ? r.of : ROW[r.page];
  const state = useScreenState(row ?? "");
  if (row && !state.open)
    return <PlannedPage page={row} title={TITLE[row] ?? "MyCity App"} m={state.screen?.m ?? "M11"} production={state.production} mock={import.meta.env.VITE_API_MODE === "mock" && state.rule === "mock"} />;
  switch (r.page) {
    case "home": return <Home />;
    case "careers": return <Careers />;
    case "vacancy": return <Vacancy key={r.slug} slug={r.slug} />;
    case "guide": return <Guidance key={r.of} of={r.of} />;
    case "apply": return <Suspense fallback={<Loading title="Apply" />}><Apply key={r.token} token={r.token} /></Suspense>;
    case "assess": return <Suspense fallback={<Loading title="Assessment" />}><Assessment key={r.token} token={r.token} /></Suspense>;
    case "sign": return <Suspense fallback={<Loading title="Offer of Employment" />}><SignOffer key={r.token} token={r.token} /></Suspense>;
    case "verify": return <Verify key={r.number ?? ""} number={r.number} />;
    case "verify-qr": return <Verify key={`t-${r.token}`} number={null} qr={r.token} />;
    case "proposal": return <Proposal key={r.token} token={r.token} />;
    case "help": return <Help />;
    default: return <NotFound />;
  }
}

const TITLE: Record<string, string> = { home: "Work With Us", careers: "Vacancy", vacancy: "Vacancy", apply: "Apply", assess: "Assessment", sign: "Sign Offer", verify: "Verify a Document", proposal: "Proposal", help: "Help" };

function NotFound() {
  const { navigate } = useRouter();
  return (
    <Page title="Page Not Found" layout="split">
      <Panel bare>
        <PageMessage
          title="Nothing at This Address"
          action={
            <Button variant="primary" size="lg" onClick={() => navigate("/jobs")}>
              See Open Roles
            </Button>
          }
        >
          The link may be mistyped. If it came in an email from us, open it again from the email.
        </PageMessage>
      </Panel>
    </Page>
  );
}
