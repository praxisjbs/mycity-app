import { useEffect, useState, type ReactNode } from "react";
import identity from "@mycity/contract/schemas/identity.js";
import type { DeviceAccount, LinkCheck } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { Banner, BigButton, Brand, Button, CityShowcase, Field, Form, Icon, Inline, LoadingRows, LoginField, OtpField, useIsPhone } from "@mycity/ui";
import { useAuth } from "./AuthProvider";
import { passkeyProblem, passkeysWork } from "./passkey";

export const vEmail = (v: string) => (!v.trim() ? "Enter your email" : !v.includes("@") ? "Needs an @" : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "Check the spelling" : "");
export const vPass = (v: string) => (v ? "" : "Enter your password");
/** The contract's rule for a new password: the first one it misses. */
const vNew = (v: string) => {
  const r = identity.NewPassword.safeParse(v);
  return r.success ? "" : (r.error.issues[0]?.message ?? "Check the password");
};

/** The paths a credential link opens: a reset, or an invitation to choose a first password. */
export const LINK_PATHS = ["/reset", "/welcome"];

/** The authenticator app's code: six digits. A recovery code is ten letters and numbers, with or without its dash. */
export const vCode = (v: string) => (/^\d{6}$/.test(v) ? "" : "Enter 6 digits");
export const vRecovery = (v: string) => (v.replace(/[^A-Za-z0-9]/g, "").length === 10 ? "" : "Check the code");
export const vPin = (v: string) => (/^\d{4}$/.test(v) ? "" : "Enter 4 digits");

type Mode =
  | { kind: "sign-in"; notice?: string; warning?: string }
  | { kind: "pin" }
  | { kind: "code"; ticket: string; email: string }
  | { kind: "forgot" }
  | { kind: "sent"; email: string }
  | { kind: "link"; token: string };

const greeting = (d = new Date()) => (d.getHours() < 12 ? "Good morning" : d.getHours() < 17 ? "Good afternoon" : "Good evening");

/**
 * Sign in (docs/guides/identity.md §10). Brand intensity is high here
 * (MILESTONES §5.3): on desktop the four cities fill the screen, each drawn at
 * its own local hour with its clock, and the card stands over them; on a phone
 * the cities are a short band and the form fills the rest. The same card
 * holds Forgot Password, the page a reset or invitation link opens, the code
 * step when two-step sign-in asks for one, and the PIN. On a browser the person
 * has signed in on before, Use Passkey and Use PIN sit under Sign In for the ways
 * they have set up. Fields validate as they are typed once touched.
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

  const signIn = (notice?: string, warning?: string) => setMode({ kind: "sign-in", notice, warning });
  const toCode = (ticket: string, who: string) => setMode({ kind: "code", ticket, email: who });
  const body: ReactNode =
    mode.kind === "code" ? (
      <CodeForm ticket={mode.ticket} email={mode.email} onBack={() => signIn()} />
    ) : mode.kind === "pin" && known ? (
      <PinForm account={known} onCode={(t) => toCode(t, known.email)} onPassword={(warning) => signIn(undefined, warning)} />
    ) : mode.kind === "forgot" ? (
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
      <SignInForm
        email={email}
        setEmail={setEmail}
        known={known}
        notice={mode.kind === "sign-in" ? mode.notice : undefined}
        warning={mode.kind === "sign-in" ? mode.warning : undefined}
        onForgot={() => setMode({ kind: "forgot" })}
        onCode={(t) => toCode(t, email.trim())}
        onPin={() => setMode({ kind: "pin" })}
      />
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

type Known = DeviceAccount["account"];

function SignInForm({
  email,
  setEmail,
  known,
  notice,
  warning,
  onForgot,
  onCode,
  onPin,
}: {
  email: string;
  setEmail: (v: string) => void;
  known: Known;
  notice?: string;
  warning?: string;
  onForgot: () => void;
  onCode: (ticket: string) => void;
  onPin: () => void;
}) {
  const { signIn, signInWithPasskey } = useAuth();
  const [pass, setPass] = useState("");
  const [touched, setTouched] = useState({ email: false, pass: false });
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [buzz, setBuzz] = useState(0);
  const eErr = vEmail(email);
  const pErr = vPass(pass);
  // The other ways in are this browser's last person's, and only while their email is the one typed.
  const theirs = known && email.trim().toLowerCase() === known.email.toLowerCase() ? known : null;
  const withPasskey = !!theirs?.has_passkey && passkeysWork();
  const withPin = !!theirs?.has_pin;

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
      const ticket = await signIn(email.trim(), pass);
      if (ticket) onCode(ticket);
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

  const passkey = async () => {
    if (!theirs) return;
    setKeyBusy(true);
    setProblem(null);
    try {
      await signInWithPasskey(theirs.email);
    } catch (err) {
      setProblem({ title: "Not signed in.", text: err instanceof ApiError ? err.message : passkeyProblem(err) });
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <p className="text-sm text-muted-foreground">{known ? `${greeting()}, ${known.first_name}` : greeting()}</p>
      <h2 className="mt-1 text-3xl font-strong">Sign In</h2>
      {notice && (
        <Banner tone="ok" icon="tick" className="mt-4 mb-0">
          {notice}
        </Banner>
      )}
      {warning && (
        <Banner tone="warn" icon="key" className="mt-4 mb-0">
          {warning}
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
      {(withPasskey || withPin) && (
        <Inline className="mt-3" gap={2}>
          {withPasskey && (
            <Button icon="fingerprint" busy={keyBusy} className="flex-1" onClick={() => void passkey()}>
              Use Passkey
            </Button>
          )}
          {withPin && (
            <Button icon="key" className="flex-1" onClick={onPin}>
              Use PIN
            </Button>
          )}
        </Inline>
      )}
      {problem && (
        <Banner tone="err" icon="lock" className="mt-4 mb-0">
          <b>{problem.title}</b> {problem.text}
        </Banner>
      )}
      {import.meta.env.VITE_API_MODE === "mock" && <MockAccounts onPick={(e) => (setEmail(e), setPass("demo1234"), setProblem(null))} />}
    </Form>
  );
}

/**
 * The code step: two-step sign-in asks for the authenticator app's code after the
 * password or the PIN. A full code goes on its own; a recovery code stands in for
 * a lost phone.
 */
function CodeForm({ ticket, email, onBack }: { ticket: string; email: string; onBack: () => void }) {
  const { finishTwoStep } = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [buzz, setBuzz] = useState(0);
  const err = recovery ? vRecovery(code) : vCode(code);
  const first = () => document.getElementById(recovery ? "recovery" : "code")?.focus();
  useEffect(() => {
    document.getElementById(recovery ? "recovery" : "code")?.focus();
  }, [recovery]);

  const submit = async (value = code) => {
    setTouched(true);
    const bad = recovery ? vRecovery(value) : vCode(value);
    if (bad) {
      setBuzz((n) => n + 1);
      first();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await finishTwoStep(ticket, value);
    } catch (e) {
      setCode("");
      setTouched(false);
      setProblem((e as ApiError).message);
      first();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <p className="text-sm text-muted-foreground wrap-any">{email}</p>
      <h2 className="mt-1 text-3xl font-strong">Enter Code</h2>
      <p className="mt-1.5 mb-4 text-muted-foreground">{recovery ? "One of your recovery codes" : "From your authenticator app"}</p>
      {recovery ? (
        <LoginField id="recovery" label="Recovery Code" type="text" autoComplete="off" value={code} onChange={(v) => (setCode(v), setProblem(null))} onBlur={() => code && setTouched(true)} error={touched ? err : ""} good={!err} buzz={touched && err ? buzz : 0} />
      ) : (
        <Field label="Sign-In Code" htmlFor="code" state={touched && err ? "bad" : undefined} message={err}>
          <OtpField id="code" label="Sign-In Code" value={code} onChange={(v) => (setCode(v), setProblem(null))} onComplete={(v) => void submit(v)} />
        </Field>
      )}
      <BigButton type="submit" icon="right" busy={busy} className="mt-3">
        Sign In
      </BigButton>
      <Inline className="mt-3" gap={2} justify="between">
        <Button variant="ghost" icon="left" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => (setRecovery((r) => !r), setCode(""), setTouched(false), setProblem(null))}>
          {recovery ? "Use App Code" : "Use Recovery Code"}
        </Button>
      </Inline>
      {problem && (
        <Banner tone="err" icon="lock" className="mt-4 mb-0">
          {problem}
        </Banner>
      )}
    </Form>
  );
}

/** The PIN, on a browser the person has signed in on before. Four digits go on their own. */
function PinForm({ account, onCode, onPassword }: { account: NonNullable<Known>; onCode: (ticket: string) => void; onPassword: (warning?: string) => void }) {
  const { signInWithPin } = useAuth();
  const [pin, setPin] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const err = vPin(pin);
  useEffect(() => {
    document.getElementById("pin")?.focus();
  }, []);

  const submit = async (value = pin) => {
    setTouched(true);
    if (vPin(value)) {
      document.getElementById("pin")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const ticket = await signInWithPin(account.email, value);
      if (ticket) onCode(ticket);
    } catch (e) {
      const a = e as ApiError;
      setPin("");
      setTouched(false);
      // No PIN to use any more: back to the password, saying why.
      if (a.code === "PIN_SWITCHED_OFF" || a.code === "PIN_UNAVAILABLE") onPassword(a.message);
      else {
        setProblem(a.message);
        document.getElementById("pin")?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={() => void submit()}>
      <p className="text-sm text-muted-foreground">{`${greeting()}, ${account.first_name}`}</p>
      <h2 className="mt-1 mb-4 text-3xl font-strong">Enter PIN</h2>
      <Field label="PIN" htmlFor="pin" state={touched && err ? "bad" : undefined} message={err}>
        <OtpField id="pin" label="PIN" length={4} secret value={pin} onChange={(v) => (setPin(v), setProblem(null))} onComplete={(v) => void submit(v)} />
      </Field>
      <BigButton type="submit" icon="right" busy={busy} className="mt-3">
        Sign In
      </BigButton>
      <Button variant="ghost" icon="left" className="mt-3" onClick={() => onPassword()}>
        Use Password
      </Button>
      {problem && (
        <Banner tone="err" icon="lock" className="mt-4 mb-0">
          {problem}
        </Banner>
      )}
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
