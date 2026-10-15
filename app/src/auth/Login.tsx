import { useState } from "react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Banner, BigButton, Brand, Button, formatCount, Form, LoginField } from "@mycity/ui";
import { useAuth } from "./AuthProvider";

export const vEmail = (v: string) => (!v.trim() ? "Enter your work email" : !v.includes("@") ? "Needs an @" : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "Check the spelling" : "");
export const vPass = (v: string) => (!v ? "Enter your password" : v.length < 8 ? "At least 8 characters" : "");

/**
 * Sign in. Brand intensity is high here (MILESTONES §5.3): the Deep Green art
 * panel with the pin, and the yellow button. Fields validate as they are typed
 * once touched. On a phone the art panel is left off: the pin, the form, done.
 */
export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [touched, setTouched] = useState({ email: false, pass: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [buzz, setBuzz] = useState(0);

  const eErr = vEmail(email);
  const pErr = vPass(pass);

  const submit = async () => {
    setTouched({ email: true, pass: true });
    if (eErr || pErr) {
      setBuzz((n) => n + 1);
      document.getElementById(eErr ? "email" : "pass")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await signIn(email.trim(), pass);
    } catch (err) {
      const a = err as ApiError;
      setPass("");
      setProblem({ title: a.code === "ACCOUNT_SUSPENDED" ? "Account suspended." : a.status === 0 ? "Offline." : "Not signed in.", text: a.message });
      document.getElementById("pass")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-50 grid grid-cols-1 bg-background desk:grid-cols-2">
      <div className="on-dark relative hidden flex-col overflow-hidden bg-deep p-14 text-on-deep desk:flex">
        <div className="pointer-events-none absolute -right-50 -bottom-50 size-140 rounded-full glow-primary" />
        <Brand tone="on-dark" size="l" name="MyCity App" className="relative" />
        <h1 className="relative mt-auto max-w-sm text-4xl leading-tight">
          Every city.
          <br />
          One <em className="text-primary not-italic">operations</em> platform.
        </h1>
        <p className="relative mt-4 max-w-md text-md text-on-deep-muted">People, work, finance, partnerships and reporting, connected through configurable workflows.</p>
        <SplashStats />
        <p className="relative mt-6 text-md text-on-deep-muted">
          Engineered by{" "}
          <a className="font-semibold text-primary no-underline hover:underline" href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer">
            JBS Praxis
          </a>
        </p>
      </div>

      <div className="flex items-center justify-center overflow-y-auto p-6">
        <Form className="w-full max-w-95" onSubmit={() => void submit()}>
          <Brand size="l" name="MyCity App" className="mb-6 desk:hidden" />
          <h2 className="text-3xl">Sign In</h2>
          <p className="mt-1.5 text-muted-foreground">Use your MyCity work address.</p>

          <LoginField id="email" label="Work Email" type="email" autoComplete="username" value={email} onChange={(v) => (setEmail(v), setProblem(null))} onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={touched.email ? eErr : ""} good={!eErr} buzz={touched.email && eErr ? buzz : 0} />
          <LoginField id="pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={setPass} onBlur={() => setTouched((t) => ({ ...t, pass: true }))} error={touched.pass ? pErr : ""} good={!pErr} buzz={touched.pass && pErr ? buzz : 0} />

          <BigButton type="submit" icon="right" busy={busy}>
            Sign In
          </BigButton>

          {problem && (
            <Banner tone="err" icon="lock" className="mt-4 mb-0">
              <b>{problem.title}</b> {problem.text}
            </Banner>
          )}
          {import.meta.env.VITE_API_MODE === "mock" && <MockAccounts onPick={(e) => (setEmail(e), setPass("demo1234"), setProblem(null))} />}
        </Form>
      </div>
    </div>
  );
}

/** The three figures under the headline. Live numbers, never typed into the page. */
function SplashStats() {
  const { data } = useApi("GET /api/v1/auth/splash");
  if (!data) return <div className="mb-auto" />;
  const stats: Array<[number, string]> = [
    [data.staff, "Staff on the platform"],
    [data.cities, "Cities live"],
    [data.partnerships, "Active Partnerships"],
  ];
  return (
    <div className="relative mt-7 mb-auto flex flex-wrap gap-7">
      {stats.map(([n, l]) => (
        <div key={l}>
          <b className="block text-2xl font-bold tracking-tight text-primary">{formatCount(n)}</b>
          <span className="text-xs text-on-deep-faint">{l}</span>
        </div>
      ))}
    </div>
  );
}

/** Mock mode only: the demonstration accounts, one per Home view. Never in a live build. */
function MockAccounts({ onPick }: { onPick: (email: string) => void }) {
  const accounts: Array<[string, string]> = [
    ["cynthia@mycityapp.io", "Operations"],
    ["ifeoma@mycityapp.io", "CEO"],
    ["ngozi@mycityapp.io", "Partnerships"],
    ["chidera@mycityapp.io", "Staff"],
    ["musa@mycityapp.io", "Suspended"],
  ];
  return (
    <div className="mt-4 rounded-box border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground" data-ui-ignore="mock accounts">
      <b className="mb-1.5 block text-foreground">Mock API</b>
      <span className="flex flex-wrap gap-1.5">
        {accounts.map(([e, l]) => (
          <Button key={e} size="sm" onClick={() => onPick(e)}>
            {l}
          </Button>
        ))}
      </span>
    </div>
  );
}
