import { useEffect, useState, type ReactNode } from "react";
import identity from "@mycity/contract/schemas/identity.js";
import type { LinkCheck } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { Banner, BigButton, Brand, Button, CityShowcase, Form, Icon, LoadingRows, LoginField, useIsPhone } from "@mycity/ui";
import { useAuth } from "./AuthProvider";

export const vEmail = (v: string) => (!v.trim() ? "Enter your email" : !v.includes("@") ? "Needs an @" : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "Check the spelling" : "");
export const vPass = (v: string) => (v ? "" : "Enter your password");
/** The contract's rule for a new password: the first one it misses. */
const vNew = (v: string) => {
  const r = identity.NewPassword.safeParse(v);
  return r.success ? "" : (r.error.issues[0]?.message ?? "Check the password");
};

/** The paths a credential link opens: a reset, or an invitation to choose a first password. */
export const LINK_PATHS = ["/reset", "/welcome"];

type Mode = { kind: "sign-in"; notice?: string } | { kind: "forgot" } | { kind: "sent"; email: string } | { kind: "link"; token: string };

const greeting = (d = new Date()) => (d.getHours() < 12 ? "Good morning" : d.getHours() < 17 ? "Good afternoon" : "Good evening");

/**
 * Sign in (docs/guides/identity.md §10). Brand intensity is high here
 * (MILESTONES §5.3): on desktop the four cities fill the screen, each drawn at
 * its own local hour with its clock, and the card stands over them; on a phone
 * the cities are a short band and the form fills the rest. The same card
 * holds Forgot Password, and the page a reset or invitation link opens.
 * Fields validate as they are typed once touched.
 */
export function Login() {
  const phone = useIsPhone();
  const { location, navigate } = useRouter();
  const token = LINK_PATHS.includes(location.path) ? (location.params.get("token") ?? "") : "";
  const [mode, setMode] = useState<Mode>(() => (token ? { kind: "link", token } : { kind: "sign-in" }));
  const device = useApi("GET /api/v1/auth/device");
  const known = device.data?.account ?? null;
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (known) setEmail((e) => e || known.email);
  }, [known]);

  const signIn = (notice?: string) => setMode({ kind: "sign-in", notice });
  const body: ReactNode =
    mode.kind === "forgot" ? (
      <ForgotForm email={email} setEmail={setEmail} onSent={(e) => setMode({ kind: "sent", email: e })} onBack={() => signIn()} />
    ) : mode.kind === "sent" ? (
      <Sent email={mode.email} onBack={() => signIn()} />
    ) : mode.kind === "link" ? (
      <LinkForm
        token={mode.token}
        onDone={(e) => {
          setEmail(e);
          navigate("/", { replace: true });
          signIn("Password saved. Sign in with it now.");
        }}
        onExpired={() => {
          navigate("/", { replace: true });
          setMode({ kind: "forgot" });
        }}
      />
    ) : (
      <SignInForm email={email} setEmail={setEmail} firstName={known?.first_name ?? null} notice={mode.notice} onForgot={() => setMode({ kind: "forgot" })} />
    );

  if (phone) {
    return (
      <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-50 flex flex-col overflow-y-auto bg-background">
        <CityShowcase variant="band" className="h-52 flex-none">
          <Brand tone="on-dark" name="MyCity App" />
        </CityShowcase>
        <div className="relative -mt-5 flex-1 rounded-t-sheet bg-background px-4 pt-7 pb-safe-5">{body}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-50 bg-deep">
      <CityShowcase
        className="absolute inset-0"
        aside={
          <div className="w-100 animate-rise rounded-sheet border border-border bg-card p-8 text-card-foreground shadow-3">
            {body}
            <p className="mt-7 border-t border-border pt-4 text-xs text-muted-foreground">
              Engineered by{" "}
              <a className="font-semibold text-foreground no-underline hover:underline" href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer">
                JBS Praxis
              </a>
            </p>
          </div>
        }
      >
        <Brand tone="on-dark" size="l" name="MyCity App" />
        <div className="mt-14 max-w-md">
          <h1 className="text-4xl leading-tight font-strong">
            Every city.
            <br />
            One <em className="text-primary not-italic">team</em>.
          </h1>
          <p className="mt-4 text-md text-on-deep-muted">Events, places and city services in one app. This is where the MyCity team runs it.</p>
        </div>
      </CityShowcase>
    </div>
  );
}

function SignInForm({ email, setEmail, firstName, notice, onForgot }: { email: string; setEmail: (v: string) => void; firstName: string | null; notice?: string; onForgot: () => void }) {
  const { signIn } = useAuth();
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
      const title = a.code === "ACCOUNT_SUSPENDED" ? "Account suspended." : a.code === "LOGIN_THROTTLED" ? "Too many tries." : a.status === 0 ? "Offline." : "Not signed in.";
      setProblem({ title, text: a.message });
      document.getElementById("pass")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <p className="text-sm text-muted-foreground">{firstName ? `${greeting()}, ${firstName}` : greeting()}</p>
      <h2 className="mt-1 text-3xl font-strong">Sign In</h2>
      {notice && (
        <Banner tone="ok" icon="tick" className="mt-4 mb-0">
          {notice}
        </Banner>
      )}
      <LoginField id="email" label="Email" type="email" autoComplete="username" value={email} onChange={(v) => (setEmail(v), setProblem(null))} onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={touched.email ? eErr : ""} good={!eErr} buzz={touched.email && eErr ? buzz : 0} />
      <LoginField id="pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={(v) => (setPass(v), setProblem(null))} onBlur={() => setTouched((t) => ({ ...t, pass: true }))} error={touched.pass ? pErr : ""} good={!pErr} buzz={touched.pass && pErr ? buzz : 0} />
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onForgot}>
          Forgot Password
        </Button>
      </div>
      <BigButton type="submit" icon="right" busy={busy} className="mt-3">
        Sign In
      </BigButton>
      {problem && (
        <Banner tone="err" icon="lock" className="mt-4 mb-0">
          <b>{problem.title}</b> {problem.text}
        </Banner>
      )}
      {import.meta.env.VITE_API_MODE === "mock" && <MockAccounts onPick={(e) => (setEmail(e), setPass("demo1234"), setProblem(null))} />}
    </Form>
  );
}

function ForgotForm({ email, setEmail, onSent, onBack }: { email: string; setEmail: (v: string) => void; onSent: (email: string) => void; onBack: () => void }) {
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [buzz, setBuzz] = useState(0);
  const err = vEmail(email);

  const submit = async () => {
    setTouched(true);
    if (err) {
      setBuzz((n) => n + 1);
      document.getElementById("forgot-email")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.call("POST /api/v1/auth/forgot", { body: { email: email.trim() } });
      onSent(email.trim());
    } catch (e) {
      setProblem((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <h2 className="text-3xl font-strong">Reset Password</h2>
      <p className="mt-1.5 text-muted-foreground">We will email you a link.</p>
      <LoginField id="forgot-email" label="Email" type="email" autoComplete="username" value={email} onChange={(v) => (setEmail(v), setProblem(null))} onBlur={() => setTouched(true)} error={touched ? err : ""} good={!err} buzz={touched && err ? buzz : 0} />
      <BigButton type="submit" icon="mail" busy={busy}>
        Send Link
      </BigButton>
      <Button variant="ghost" icon="left" className="mt-3" onClick={onBack}>
        Back
      </Button>
      {problem && (
        <Banner tone="err" icon="alert" className="mt-4 mb-0">
          {problem}
        </Banner>
      )}
    </Form>
  );
}

function Sent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div>
      <span className="grid size-12 place-items-center rounded-full bg-primary-tint text-primary-foreground">
        <Icon name="mail" />
      </span>
      <h2 className="mt-4 text-3xl font-strong">Check Your Email</h2>
      <p className="mt-2 text-muted-foreground wrap-any">If {email} has an account, a link is on its way.</p>
      <BigButton icon="right" onClick={onBack}>
        Sign In
      </BigButton>
    </div>
  );
}

function LinkForm({ token, onDone, onExpired }: { token: string; onDone: (email: string) => void; onExpired: () => void }) {
  const [check, setCheck] = useState<LinkCheck | "bad" | null>(null);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [touched, setTouched] = useState({ next: false, again: false });
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [buzz, setBuzz] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .call("POST /api/v1/auth/link", { body: { token } })
      .then((c) => live && setCheck(c))
      .catch(() => live && setCheck("bad"));
    return () => {
      live = false;
    };
  }, [token]);

  if (check === null) return <LoadingRows count={3} />;
  if (check === "bad") {
    return (
      <div>
        <h2 className="text-3xl font-strong">Link Expired</h2>
        <p className="mt-2 text-muted-foreground">This link has expired or was already used.</p>
        <BigButton icon="mail" onClick={onExpired}>
          Request New Link
        </BigButton>
      </div>
    );
  }

  const invite = check.purpose === "invite";
  const nErr = serverErr || vNew(next);
  const aErr = again !== next ? "Does not match" : "";
  const submit = async () => {
    setTouched({ next: true, again: true });
    if (nErr || aErr || !again) {
      setBuzz((n) => n + 1);
      document.getElementById(nErr ? "new-pass" : "new-again")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.call("POST /api/v1/auth/reset", { body: { token, new_password: next } });
      onDone(r.email);
    } catch (e) {
      const a = e as ApiError;
      if (a.code === "LINK_INVALID") setCheck("bad");
      else if (a.fields.new_password?.[0]) setServerErr(a.fields.new_password[0]);
      else setProblem(a.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <p className="text-sm text-muted-foreground wrap-any">{invite ? `Welcome, ${check.first_name}` : check.email}</p>
      <h2 className="mt-1 text-3xl font-strong">{invite ? "Set Your Password" : "New Password"}</h2>
      <LoginField id="new-pass" label="New Password" type="password" autoComplete="new-password" value={next} onChange={(v) => (setNext(v), setServerErr(""))} onBlur={() => setTouched((t) => ({ ...t, next: true }))} error={touched.next ? nErr : ""} good={!nErr} buzz={touched.next && nErr ? buzz : 0} />
      <LoginField id="new-again" label="Confirm Password" type="password" autoComplete="new-password" value={again} onChange={setAgain} onBlur={() => setTouched((t) => ({ ...t, again: true }))} error={touched.again ? aErr || (again ? "" : "Enter it again") : ""} good={!!again && !aErr} buzz={touched.again && aErr ? buzz : 0} />
      <BigButton type="submit" icon="tick" busy={busy}>
        {invite ? "Set Password" : "Save Password"}
      </BigButton>
      {problem && (
        <Banner tone="err" icon="alert" className="mt-4 mb-0">
          {problem}
        </Banner>
      )}
    </Form>
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
