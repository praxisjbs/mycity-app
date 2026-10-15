import { useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import { Message, Page } from "@/components/Layout";
import { Button, Loading, Notice, Pill, Sub } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { Link, useRouter } from "@/lib/router";
import { PATTERN } from "./Careers";

/**
 * Vacancy (#81): one role at a readable, shareable slug. Indexable. A paused
 * role keeps its link and takes no applications; a filled role says so rather
 * than a 404. Apply mints a one-time token and opens the write-only form.
 */
export function Vacancy({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const v = useApi("GET /api/public/v1/jobs/:slug", { params: { slug } });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (v.error)
    return (
      <Page title="Role Not Found">
        <Message icon="brief" title={v.error.status === 404 ? "There is no open role at this address" : "This role could not load"} action={<Button variant="primary" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
          {v.error.status === 404 ? "The link may be mistyped, or the role was never published." : v.error.message}
        </Message>
      </Page>
    );
  const d = v.data;
  if (!d)
    return (
      <Page title="Careers" index>
        <Loading lines={8} />
      </Page>
    );

  const pay = d.salary_min && d.salary_max ? `${formatMoney(d.salary_min, { kobo: false })} to ${formatMoney(d.salary_max, { kobo: false })}` : null;
  const where = [d.department, d.location, `${PATTERN[d.work_pattern]}${d.work_pattern_note ? `, ${d.work_pattern_note}` : ""}`, pay].filter(Boolean).join(" · ");
  const apply = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { token } = await api.call("POST /api/public/v1/jobs/:slug/apply", { params: { slug }, body: {} });
      navigate(`/apply/${token}`);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not start an application. Try again.");
      setBusy(false);
    }
  };

  return (
    <Page title={d.title} index={d.state === "open"}>
      <Link to="/jobs" className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground no-underline hover:text-foreground">
        ← All Roles
      </Link>
      <h1 className="text-[21px]">{d.title}</h1>
      <Sub className="mt-[5px]">{where}</Sub>
      <div className="my-4 flex flex-wrap gap-1.5">
        <Pill>{d.employment_type}</Pill>
        {d.probation_months && <Pill>{d.probation_months} month probation</Pill>}
        {d.reports_to && <Pill>Reports to {d.reports_to}</Pill>}
      </div>
      {d.state !== "open" && (
        <div className="mb-4">
          <Notice tone={d.state === "filled" ? "info" : "warn"}>
            {d.state === "filled" ? "This role has been filled. Thank you to everyone who applied." : "This role is not taking applications right now. The link will keep working if it reopens."}
          </Notice>
        </div>
      )}
      <p className="text-[13.5px] leading-[1.6] text-muted-foreground">{d.summary}</p>
      <h2 className="mt-4 text-[13.5px]">Must Have</h2>
      <p className="mt-[5px] text-[13px] leading-[1.6] text-muted-foreground">{d.must_have}</p>
      {d.nice_to_have && (
        <>
          <h2 className="mt-4 text-[13.5px]">Nice to Have</h2>
          <p className="mt-[5px] text-[13px] leading-[1.6] text-muted-foreground">{d.nice_to_have}</p>
        </>
      )}
      <h2 className="mt-4 text-[13.5px]">How We Hire</h2>
      <p className="mt-[5px] text-[13px] leading-[1.6] text-muted-foreground">{d.how_we_hire}</p>
      {problem && (
        <div className="mt-4">
          <Notice tone="err">{problem}</Notice>
        </div>
      )}
      {d.state === "open" ? (
        <>
          <Button variant="primary" block className="mt-5" disabled={busy} onClick={apply}>
            {busy ? "Opening the Form" : "Apply for This Role"}
          </Button>
          <Sub className="mt-3 text-center">
            {d.applicants === 1 ? "1 person has applied." : `${d.applicants} people have applied.`} Closes when filled.
          </Sub>
        </>
      ) : (
        <Button block className="mt-5" onClick={() => navigate("/jobs")}>
          See Open Roles
        </Button>
      )}
    </Page>
  );
}
