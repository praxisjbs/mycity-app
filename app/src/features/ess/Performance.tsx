import { useApi } from "@/api/hooks";
import type { MyPerformance } from "@/api/types/ess";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { Bars, Card, CardHeader, cn, DataView, DesktopOnly, ErrorState, Grid, KeyValue, LoadingRows, PageHeader, Pill, StatStrip, TapList, useModal } from "@mycity/ui";
import { toBars } from "@/features/shared/wire";

export function MyPerformancePage() {
  const { data: p, error, reload } = useApi("GET /api/v1/ess/performance");
  const modal = useModal();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={6} />;
  const open = (r: MyPerformance["reviews"][number]) =>
    modal.open({
      title: `Review, ${r.cycle}`,
      body: (
        <>
          <Card>
            <CardHeader title={r.cycle} />
            <KeyValue items={[["Your rating", r.self ?? "Not yet"], ["Manager", r.manager ?? "Not yet"], ["Second level", r.second ?? "Not yet"], ["Status", <Pill tone={r.status.tone}>{r.status.text}</Pill>]]} />
          </Card>
          {r.manager_comment && (
            <Card className="mt-3">
              <CardHeader title="Manager Comment" />
              <p className="text-[11.5px] text-subtle-foreground">{r.manager_comment}</p>
            </Card>
          )}
        </>
      ),
    });
  const kpis = <Card><CardHeader title="My KPIs This Month" /><Bars rows={toBars(p.kpis)} note="Weighted by KPI" /></Card>;
  const chain = (
    <Card>
      <CardHeader title="Rolls Up To" />
      <div className="tl">
        {p.chain.map((c) => (
          <div key={c.title} className={cn("tl-dot relative pb-[14px] last:pb-0", c.top && "hi", c.mine && "ok")}>
            <b className="block text-[12.5px] font-semibold">{c.title}</b>
            <span className="text-[11.5px] text-subtle-foreground">{c.level}</span>
          </div>
        ))}
      </div>
    </Card>
  );
  return (
    <>
      <PageHeader title="My Performance" sub={`${p.period} · set by ${p.set_by}`} />
      <StatStrip items={p.stats} />
      <PhoneCards
        items={[
          { icon: "target", title: "My KPIs This Month", sub: `${p.stats[0].value} · ${p.stats[1].value} on track`, body: kpis },
          { icon: "up", title: "Rolls Up To", sub: `${p.chain.length} levels, up to the CEO`, body: chain },
          {
            icon: "check",
            title: "My Reviews",
            sub: p.reviews[0].self ? `${p.reviews[0].cycle}: self ${p.reviews[0].self}, manager ${p.reviews[0].manager}` : "None yet",
            body: <TapList items={p.reviews.map((r) => ({ key: r.review_id, title: r.cycle, sub: `Self ${r.self ?? "not yet"} · Manager ${r.manager ?? "not yet"}`, right: <Pill tone={r.status.tone}>{r.status.text}</Pill>, onClick: () => open(r) }))} />,
          },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>{kpis}{chain}</Grid>
        <DataView
          title="My Reviews"
          rows={p.reviews}
          rowKey={(r) => r.review_id}
          onRowClick={open}
          columns={[
            { key: "c", label: "Cycle", render: (r) => r.cycle },
            { key: "s", label: "Self Rating", render: (r) => r.self ?? "Not yet" },
            { key: "m", label: "Manager", render: (r) => r.manager ?? "Not yet" },
            { key: "x", label: "Second Level", render: (r) => r.second ?? "Not yet" },
            { key: "t", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
          ]}
        />
      </DesktopOnly>
    </>
  );
}
