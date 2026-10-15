import { useState, type FormEvent } from "react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { formatCount } from "@/lib/format";
import { BigButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAuth } from "./AuthProvider";

const vEmail = (v: string) => (!v.trim() ? "Enter your work email" : !v.includes("@") ? "Needs an @" : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "Check the spelling" : "");
const vPass = (v: string) => (!v ? "Enter your password" : v.length < 8 ? "At least 8 characters" : "");

/**
 * Sign in. Brand intensity is high here (MILESTONES §5.3): the Deep Green art
 * panel and the yellow button. Fields validate as they are typed once touched.
 */
export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [touched, setTouched] = useState({ email: false, pass: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ tone: "err"; title: string; text: string } | null>(null);
  const [buzz, setBuzz] = useState(0);

  const eErr = vEmail(email);
  const pErr = vPass(pass);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
      setProblem(
        a.code === "ACCOUNT_SUSPENDED"
          ? { tone: "err", title: "Account suspended.", text: a.message }
          : { tone: "err", title: a.status === 0 ? "Offline." : "Not signed in.", text: a.message },
      );
      document.getElementById("pass")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-[60] grid grid-cols-1 bg-background md:grid-cols-[1.05fr_.95fr]">
      <div className="on-dark relative hidden flex-col overflow-hidden bg-deep p-[clamp(28px,4vw,56px)] text-on-deep md:flex">
        <div className="pointer-events-none absolute -right-[200px] -bottom-[200px] size-[560px] rounded-full bg-[radial-gradient(circle,rgba(255,223,85,.16),rgba(255,223,85,0)_66%)]" />
        <span className="relative flex items-center gap-2.5">
          <Icon name="pin" className="size-7 text-primary" />
          <b className="text-[17px] font-bold tracking-[-.015em]">MyCity App</b>
        </span>
        <h1 className="relative mt-auto max-w-[14ch] text-[clamp(26px,3.4vw,42px)] leading-[1.08]">
          Every city.
          <br />
          One <em className="text-primary not-italic">operations</em> platform.
        </h1>
        <p className="relative mt-4 max-w-[40ch] text-[15px] text-on-deep-muted">People, work, finance, partnerships and reporting, connected through configurable workflows.</p>
        <SplashStats />
        <p className="relative mt-[22px] text-[15px] text-on-deep-muted">
          Engineered by{" "}
          <a className="font-semibold text-primary no-underline hover:underline" href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer">
            JBS Praxis
          </a>
        </p>
      </div>

      <div className="flex items-center justify-center overflow-y-auto p-6">
        <form className="w-full max-w-[380px]" noValidate onSubmit={submit}>
          <span className="mb-6 flex items-center gap-2.5 md:hidden">
            <Icon name="pin" className="size-7 text-secondary" />
            <b className="text-[17px] font-bold tracking-[-.015em]">MyCity App</b>
          </span>
          <h2 className="text-[24px]">Sign In</h2>
          <p className="mt-1.5 text-muted-foreground">Welcome back. Use your MyCity work address.</p>

          <LoginField id="email" label="Work Email" type="email" autoComplete="username" value={email} onChange={(v) => (setEmail(v), setProblem(null))} onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={touched.email ? eErr : ""} good={!eErr} buzz={touched.email && eErr ? buzz : 0} />
          <LoginField id="pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={setPass} onBlur={() => setTouched((t) => ({ ...t, pass: true }))} error={touched.pass ? pErr : ""} good={!pErr} buzz={touched.pass && pErr ? buzz : 0} />

          <BigButton type="submit" icon="right" disabled={busy}>
            {busy ? "Signing In" : "Sign In"}
          </BigButton>

          {problem && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-box bg-destructive-soft px-3 py-2.5 text-[12.5px] text-destructive">
              <Icon name="lock" className="mt-px" />
              <span>
                <b>{problem.title}</b> {problem.text}
              </span>
            </div>
          )}
          {import.meta.env.VITE_API_MODE === "mock" && <MockAccounts onPick={(e) => (setEmail(e), setPass("demo1234"), setProblem(null))} />}
        </form>
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
    [data.partnerships, "Active partnerships"],
  ];
  return (
    <div className="relative mt-7 mb-auto flex flex-wrap gap-7">
      {stats.map(([n, l]) => (
        <div key={l}>
          <b className="block text-[22px] font-bold tracking-[-.02em] text-primary">{formatCount(n)}</b>
          <span className="text-[12px] text-on-deep-faint">{l}</span>
        </div>
      ))}
    </div>
  );
}

function LoginField({ id, label, type, autoComplete, value, onChange, onBlur, error, good, buzz }: {
  id: string; label: string; type: string; autoComplete: string; value: string; onChange: (v: string) => void; onBlur: () => void; error: string; good: boolean; buzz: number;
}) {
  return (
    <div className="mt-[18px]">
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
        {label}
      </label>
      <div key={buzz} className={cn("relative flex items-center", buzz > 0 && "animate-buzz")}>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={!!error || undefined}
          aria-describedby={`e-${id}`}
          className={cn(
            "h-[46px] w-full rounded-box border-[1.5px] bg-background pr-[42px] pl-[14px] transition-[border-color,box-shadow] outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
            error ? "border-destructive" : "border-input",
          )}
        />
        {error && <Icon name="alert" className="pointer-events-none absolute right-3 text-destructive" />}
        {!error && good && value && <Icon name="ok" className="pointer-events-none absolute right-3 text-success" />}
      </div>
      <p id={`e-${id}`} role="alert" className={cn("mt-1.5 items-center gap-[5px] text-[12.5px] text-destructive", error ? "flex" : "hidden")}>
        <Icon name="alert" />
        <span>{error}</span>
      </p>
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
    <div className="mt-4 rounded-box border border-border bg-muted px-3 py-2.5 text-[12.5px] text-muted-foreground">
      <span className="mb-1.5 flex items-center gap-2">
        <Icon name="info" className="text-accent-foreground" />
        <b className="text-foreground">Mock API</b>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {accounts.map(([e, l]) => (
          <button key={e} type="button" onClick={() => onPick(e)} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold hover:border-subtle-foreground">
            {l}
          </button>
        ))}
      </span>
    </div>
  );
}
