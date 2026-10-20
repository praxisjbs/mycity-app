import type { MyPolicyVersion, PolicyRule, PolicySettings } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useSearchParams } from "@/lib/router";
import { Button, Card, CardHeader, DataView, ErrorState, formatDate, FormFooter, Grid, KeyValue, LoadingRows, PageHeader, Pill, toast, useModal } from "@mycity/ui";
import { policySentences, VERSION_STATE } from "./policy-text";

/**
 * ESS · Policy Updates (#89, docs/guides/attendance.md §6.15, §10): the newest version of the
 * attendance policy in plain sentences, with what it changed and People's note, and Acknowledge;
 * the earlier versions. Acknowledging is a record, never a gate on the clock. A notice links a
 * version by `?version=`; one that is not the newest opens in a sheet.
 */
export function PolicyUpdatesPage() {
  const modal = useModal();
  const [params] = useSearchParams();
  const { data: p, error, reload } = useApi("GET /api/v1/attendance/me/policy");
  const versions = usePaged("GET /api/v1/attendance/me/policy/versions");
  const ack = useMutation("POST /api/v1/attendance/me/policy/versions/:id/acknowledge");
  const openVersion = (v: MyPolicyVersion) =>
    modal.open({ title: `Version ${v.version}`, wide: true, body: (close) => <VersionView v={v} close={close} /> });

  // A notice opens its version (`?version=`), once: the newest is the page itself.
  const linked = params.get("version");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || !p || opened.current === linked) return;
    opened.current = linked;
    if (p.latest?.attendance_policy_id === linked) return;
    api
      .call("GET /api/v1/attendance/me/policy/versions/:id", { params: { id: linked } })
      .then(openVersion)
      .catch((e) => toast(e instanceof ApiError ? e.message : "Version not found"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked version
  }, [linked, p]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={6} />;
  const latest = p.latest;
  const acknowledge = async (v: MyPolicyVersion) => {
    try {
      await ack.run({ params: { id: v.attendance_policy_id }, body: {} });
      invalidate("/api/v1/attendance/me/policy");
      toast(`Version ${v.version} acknowledged`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not acknowledged, try again");
    }
  };

  return (
    <>
      <PageHeader title="Policy Updates" sub={latest ? `Attendance policy, version ${latest.version}` : "Attendance policy, default rules"} />
      {latest && (
        <Card className="mb-3">
          <CardHeader title={`Version ${latest.version}`} record right={<StatePill v={latest} />} />
          <p data-copy="content" className="text-sm leading-normal text-muted-foreground">
            {latest.note}
          </p>
          <KeyValue
            className="mt-2"
            items={[
              ["First Day", formatDate(latest.effective_from)],
              ["Published", formatDate(latest.published_at)],
            ]}
          />
          <div className="mt-3 flex justify-end">
            {latest.acknowledged_at ? (
              <Pill tone="ok">{`Acknowledged ${formatDate(latest.acknowledged_at)}`}</Pill>
            ) : (
              <Button variant="primary" icon="ok" className="phone:w-full" onClick={() => acknowledge(latest)}>
                Acknowledge
              </Button>
            )}
          </div>
        </Card>
      )}
      <PolicyText settings={latest ?? p.current} changed={latest?.changed ?? []} />
      <DataView
        className="mt-3"
        title="All Versions"
        list={versions}
        rowKey={(v) => v.attendance_policy_id}
        onRowClick={openVersion}
        noun="version"
        empty={{ icon: "doc", title: "No Versions Yet", text: "The default rules apply." }}
        columns={[
          { key: "v", label: "Version", render: (v) => `Version ${v.version}` },
          { key: "f", label: "First Day", render: (v) => formatDate(v.effective_from) },
          { key: "s", label: "State", render: (v) => <StatePill v={v} /> },
          { key: "a", label: "Acknowledged", desktop: true, render: (v) => (v.acknowledged_at ? formatDate(v.acknowledged_at) : null) },
        ]}
      />
    </>
  );
}

/** A version's state: waiting ones say when they start. */
function StatePill({ v }: { v: MyPolicyVersion }) {
  const s = VERSION_STATE[v.state];
  return <Pill tone={s.tone}>{v.state === "waiting" ? `Starts ${formatDate(v.effective_from)}` : s.text}</Pill>;
}

/** The policy as sentences, a card a section; a section the version changed is tagged. */
export function PolicyText({ settings, changed, stacked = false }: { settings: PolicySettings; changed: readonly PolicyRule[]; stacked?: boolean }) {
  const cards = policySentences(settings, changed).map((sec) => (
    <Card key={sec.title} className={stacked ? "mb-3" : undefined}>
      <CardHeader title={sec.title} level={stacked ? 3 : 2} right={sec.changed ? <Pill tone="info">Changed</Pill> : undefined} />
      <div data-copy="content" className="space-y-1.5 text-sm leading-normal">
        {sec.sentences.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </div>
    </Card>
  ));
  return stacked ? <>{cards}</> : <Grid cols={2}>{cards}</Grid>;
}

/** An earlier version, read only: its state, note and sentences. */
function VersionView({ v, close }: { v: MyPolicyVersion; close: () => void }) {
  return (
    <>
      <KeyValue
        items={[
          ["State", <StatePill key="s" v={v} />],
          ["First Day", formatDate(v.effective_from)],
          ["Acknowledged", v.acknowledged_at ? formatDate(v.acknowledged_at) : null],
        ]}
      />
      <p data-copy="content" className="my-3 text-sm leading-normal text-muted-foreground">
        {v.note}
      </p>
      <PolicyText settings={v} changed={v.changed} stacked />
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}
