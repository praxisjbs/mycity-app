import { useEffect, useRef, useState } from "react";
import type { IntegrationGroup, IntegrationRow } from "@mycity/contract/contract.gen.ts";
import { useApi, usePaged } from "@/api/hooks";
import { useViewNews, withNews } from "@/features/notifications/marks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Button, Chips, DataView, formatWhen, PageHeader, Pill, useIsPhone, type DataViewColumn } from "@mycity/ui";
import { useConnection, useTest } from "./Connection";
import { todayOf, Where } from "./Where";
import { GROUP, PLAN, STATE } from "./words";

type GroupFilter = IntegrationGroup | "all";

const GROUPS: Array<[GroupFilter, string]> = [["all", "All"], ...(Object.entries(GROUP) as Array<[IntegrationGroup, string]>)];

/**
 * Settings · Integrations (docs/guides/integrations.md): every connection the ERP runs on,
 * its state, where its settings come from and today's use. A connection opens in a side
 * panel (a full-screen sheet on a phone) where it is tested, edited and removed.
 *
 * Shown to `integrations` viewers only (shell/access.ts visibleTabs).
 */
export function IntegrationsTab({ id = null }: { id?: string | null }) {
  const { can } = useAuth();
  const phone = useIsPhone();
  const [group, setGroup] = useState<GroupFilter>("all");
  const summary = useApi("GET /api/v1/integrations/summary");
  const list = usePaged("GET /api/v1/integrations", { filters: group === "all" ? {} : { group } });
  const news = useViewNews();
  const open = useConnection();
  // A link that names a connection opens it, once the list has it: by its code (AI Control · Models)
  // or by its id (a notice about it).
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const row = id ? list.rows.find((r) => r.code === id || r.integration_connection_id === id) : null;
    if (!row || opened.current === id) return;
    opened.current = id;
    open(row.code, row.display_name);
  }, [id, list.rows, open]);
  const test = useTest();
  const canTest = can("integrations", "edit");
  const s = summary.data;
  const testColumn: DataViewColumn<IntegrationRow> = {
    key: "test",
    label: "",
    desktop: true,
    render: (r) => (
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          return test(r.code);
        }}
      >
        Test
      </Button>
    ),
  };

  return (
    <>
      <PageHeader title="Integrations" sub="Connected services and their keys" />
      {s && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Working", value: String(s.working), tone: "ok" },
            { label: "Failing", value: String(s.failing), tone: s.failing ? "err" : undefined },
            ...(phone ? [] : [{ label: "Not Set Up", value: String(s.not_set), tone: s.not_set ? ("warn" as const) : undefined }]),
          ]}
        />
      )}
      <Chips label="Group" value={group} onChange={setGroup} options={withNews(news, GROUPS, { all: "all" })} />
      <DataView<IntegrationRow>
        list={list}
        title="Connections"
        caption="Connections"
        noun="connection"
        // A connection once it has one, so a notice about it marks its row; else its provider.
        rowKey={(r) => r.integration_connection_id ?? r.code}
        onRowClick={(r) => open(r.code, r.display_name)}
        empty={{ title: "No Connections", icon: "link" }}
        columns={[
          { key: "name", label: "Connection", render: (r) => <span data-copy="content">{r.display_name}</span> },
          {
            key: "state",
            label: "State",
            render: (r) => (
              <span className="inline-flex flex-wrap gap-1">
                <Pill tone={STATE[r.state].tone}>{STATE[r.state].text}</Pill>
                {r.paused_at && <Pill tone="warn">Paused</Pill>}
              </span>
            ),
          },
          { key: "source", label: "Source", render: (r) => <Where row={r} /> },
          { key: "plan", label: "Plan", desktop: true, render: (r) => (r.plan ? <Pill tone={r.plan === "free" ? "neutral" : "info"}>{PLAN[r.plan]}</Pill> : null) },
          { key: "group", label: "Group", desktop: true, render: (r) => GROUP[r.group] },
          { key: "checked", label: "Checked", desktop: true, render: (r) => (r.last_checked_at ? formatWhen(r.last_checked_at) : null) },
          { key: "today", label: "Today", align: "n", desktop: true, render: (r) => todayOf(r) },
          ...(canTest ? [testColumn] : []),
        ]}
      />
    </>
  );
}
