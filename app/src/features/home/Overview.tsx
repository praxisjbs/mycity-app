import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { HomeKpiCard, HomeOverview } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import { useMe } from "@/auth/AuthProvider";
import { useClock } from "@/features/attendance/ClockButton";
import { useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Button, DesktopOnly, ErrorState, formatCount, formatDate, Grid, IconButton, LoadingRows, Menu, PageHeader, PhoneOnly, zoneClock } from "@mycity/ui";
import { CardRow } from "./cards";
import { claimClockPrompt } from "./clockPrompt";
import { reloadsFor } from "./refresh";
import { useCreateActions } from "./createActions";
import { useKpiDetail } from "./KpiDetail";
import { useKpiPicker } from "./KpiPickerDialog";
import { ActivityToday, DayStrip, GoalBars, MainChart, NeedYou, Pipeline, SideDonut, UpcomingLeave, weekdayOf, YourWeek } from "./sections";

/**
 * Home · Overview (#1, docs/guides/home.md §10): the reader's own Overview, resolved by the
 * server for their role (GET /home/overview): a greeting, their KPI cards, their role's main
 * chart and the sections beside it, Need You on every Overview, and New. The server sends
 * data; every word on the screen is written here and in ./sections.
 *
 * Both shells come from one tree (§10.2): on a phone the cards are two to a row and the
 * sections stack in the same order; Choose Cards moves into the page menu, New into the
 * floating button's fan as well as the header, and the date line and chart captions are
 * left off. A card opens its records (./KpiDetail) as a dialog, a bottom sheet on a phone;
 * `?kpi=<key>` (the assistant's route) or `?id=<key>` (a ⌘K result) opens one straight away.
 */

/** Good Morning, Afternoon or Evening by the time in Lagos. */
export function greetingOf(now = new Date()): string {
  const hour = zoneClock(now, "Africa/Lagos").hour;
  return hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
}

/** The line under the greeting, desktop only: the date, and for Operations who is in. */
export function dateLineOf(o: Pick<HomeOverview, "date" | "clocked_in">): string {
  const day = `${weekdayOf(o.date)} ${formatDate(o.date)}`;
  return o.clocked_in ? `${day} · ${formatCount(o.clocked_in.present)} of ${formatCount(o.clocked_in.expected)} clocked in` : day;
}

/**
 * Opens Attendance's clock-in panel once when the server says it is due (`prompt_clock_in`):
 * Home decides when, the panel is Attendance's (decision O12). While a link has a card's
 * records open, the panel waits for them to close rather than taking their place.
 */
function useClockInPrompt(overview: HomeOverview | undefined, waiting: boolean) {
  const me = useMe();
  const { open } = useClock();
  const due = overview?.prompt_clock_in && !waiting ? overview.date : null;
  useEffect(() => {
    if (due && claimClockPrompt(me.user_id, due)) open();
  }, [due, me.user_id, open]);
}

/** At most one read of the Overview in this long for other people's punches (the morning's arrivals). */
const OTHERS_MS = 30_000;

/**
 * Reads the Overview again when attendance moves, so the day strip, the date line and the
 * attendance cards stay equal to My Attendance (docs/guides/home.md §3 step 2). The reader's own
 * punch is seen at once through their clock state, which Attendance's panel refreshes after every
 * punch. Someone else's (`attendance.updated` for a person in the reader's People scope) matters
 * only to an Overview that shows other people's attendance, and reads it again at most once in
 * OTHERS_MS, so a morning of arrivals costs a reload every half minute, not one per punch.
 */
function useAttendanceRefresh(reload: () => void, overview: HomeOverview | undefined, employeeId: string | null) {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
  useRealtime("attendance.updated", (payload) => {
    if (pending.current || !reloadsFor(payload, overview, employeeId)) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      reload();
    }, OTHERS_MS);
  });
  const { today } = useClock();
  const punch = today ? `${today.state}|${today.clock_in_at ?? ""}|${today.clock_out_at ?? ""}` : null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (punch === null) return;
    if (seen.current !== null && seen.current !== punch) reload();
    seen.current = punch;
  }, [punch, reload]);
}

/** A section of the Overview, laid out two to a row on desktop. */
interface Section {
  key: string;
  node: ReactNode;
  /** A wide chart, which takes the wider column beside its neighbour. */
  wide?: boolean;
}

/** The sections in reading order, which is also the order they stack in on a phone. */
function sectionsOf(o: HomeOverview): Section[] {
  const all: Array<Section | null> = [
    o.chart && { key: "chart", node: <MainChart chart={o.chart} />, wide: true },
    o.donut && { key: "donut", node: <SideDonut donut={o.donut} /> },
    o.my_goals && { key: "my_goals", node: <GoalBars title="My Goals This Quarter" goals={o.my_goals} /> },
    o.upcoming_leave && { key: "upcoming_leave", node: <UpcomingLeave leave={o.upcoming_leave} /> },
    o.pipeline && { key: "pipeline", node: <Pipeline pipeline={o.pipeline} /> },
    { key: "need_you", node: <NeedYou alertsToClear={o.alerts_to_clear} /> },
    o.goals && { key: "goals", node: <GoalBars title="Goals This Quarter" goals={o.goals} /> },
    o.activity && { key: "activity", node: <ActivityToday items={o.activity} /> },
    o.week && { key: "week", node: <YourWeek week={o.week} /> },
  ];
  return all.filter((s): s is Section => s !== null);
}

function SectionRows({ sections }: { sections: Section[] }) {
  const rows: Section[][] = [];
  for (let i = 0; i < sections.length; i += 2) rows.push(sections.slice(i, i + 2));
  return (
    <>
      {rows.map((row) => (
        <Grid key={row.map((s) => s.key).join("+")} cols={row.length === 1 ? 1 : row[0].wide ? "1.4/1" : 2}>
          {row.map((s) => (
            <Fragment key={s.key}>{s.node}</Fragment>
          ))}
        </Grid>
      ))}
    </>
  );
}

export function Overview({ linked }: { linked: string | null }) {
  const me = useMe();
  const { navigate } = useRouter();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useApi("GET /api/v1/home/overview");
  useAttendanceRefresh(reload, data, me.employee_id ?? null);
  const openDetail = useKpiDetail();
  const openPicker = useKpiPicker();
  const create = useCreateActions(me);

  const first = create[0];
  // search:none the Overview's New runs another screen's own create action, which ⌘K lists with that screen
  useScreenAction(first ? { label: first.label, onSelect: () => navigate(first.href) } : null);

  /* A link straight to a card's records opens them once the Overview is in; closing them takes the link out of the address. */
  const asked = params.get("kpi") ?? linked;
  useClockInPrompt(data, asked !== null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!asked || !data || shown.current === asked) return;
    shown.current = asked;
    openDetail(asked, data.cards.find((c) => c.key === asked)?.title, () => {
      shown.current = null;
      setParams({ kpi: null, id: null }, { replace: true });
    });
  }, [asked, data, openDetail, setParams]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;

  const open = (card: HomeKpiCard) => openDetail(card.key, card.title);

  return (
    <>
      <PageHeader
        title={`${greetingOf()}, ${data.greeting_name}`}
        subtitle={dateLineOf(data)}
        actions={
          <>
            {create.length > 0 && (
              <Menu
                label="New"
                trigger={(p) => (
                  <Button {...p} variant="primary" icon="plus">
                    New
                  </Button>
                )}
                items={create.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => navigate(a.href) }))}
              />
            )}
            <PhoneOnly as="span">
              <Menu label="Overview Actions" trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={[{ label: "Choose Cards", icon: "grid", onSelect: openPicker }]} />
            </PhoneOnly>
          </>
        }
      />
      {data.day_strip && <DayStrip day={data.day_strip} />}
      <DesktopOnly className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" icon="grid" onClick={openPicker}>
          Choose Cards
        </Button>
      </DesktopOnly>
      {data.cards.length > 0 && <CardRow cards={data.cards} onOpen={open} />}
      <SectionRows sections={sectionsOf(data)} />
    </>
  );
}
