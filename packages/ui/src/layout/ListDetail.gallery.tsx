import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { DataView } from "../data/DataView";
import { KeyValue } from "../display/KeyValue";
import { Pill } from "../display/Pill";
import { Card, CardHeader } from "./Card";
import { DetailPane, ListDetail, useSideBySide } from "./ListDetail";

interface Request {
  id: string;
  name: string;
  type: string;
  from: string;
  to: string;
  days: number;
}

const ANNUAL: Request = { id: "a", name: "Adaeze Okonkwo", type: "Annual", from: "20/12/2026", to: "31/12/2026", days: 8 };
const SICK: Request = { id: "b", name: "Chidi Eze", type: "Sick", from: "20/10/2026", to: "22/10/2026", days: 3 };
const REQUESTS: Request[] = [ANNUAL, SICK, { id: "c", name: "Ngozi Bello", type: "Compassionate", from: "02/11/2026", to: "04/11/2026", days: 3 }];

const List = ({ picked, onPick }: { picked: string | null; onPick: (r: Request) => void }) => (
  <DataView
    title="Requests"
    rows={REQUESTS}
    rowKey={(r) => r.id}
    selectedKey={picked}
    onRowClick={onPick}
    columns={[
      { key: "n", label: "Employee", render: (r) => r.name },
      { key: "t", label: "Type", render: (r) => r.type },
      { key: "f", label: "From", render: (r) => r.from },
      { key: "o", label: "To", render: (r) => r.to },
    ]}
  />
);

const Record = ({ r }: { r: Request }) => (
  <Card>
    <CardHeader title="Request" right={<Pill tone="warn">Pending</Pill>} />
    <KeyValue items={[["Employee", r.name], ["Type", r.type], ["Dates", `${r.from} to ${r.to}`], ["Days", String(r.days)]]} />
  </Card>
);

function Requests({ first = true }: { first?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const beside = useSideBySide();
  const [picked, setPicked] = useState<Request | null>(null);
  const shown = picked ?? (beside && first ? ANNUAL : null);
  return (
    <div ref={ref}>
      <ListDetail
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Leave Request"
        container={frame}
        list={<List picked={shown?.id ?? null} onPick={setPicked} />}
        detail={shown ? <Record r={shown} /> : <Card><p className="text-xs text-subtle-foreground">Pick a request.</p></Card>}
      />
    </div>
  );
}

function Pane() {
  const [ref, frame] = useGalleryFrame();
  const [picked, setPicked] = useState<Request | null>(null);
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <List picked={picked?.id ?? null} onPick={setPicked} />
      <DetailPane open={picked !== null} onClose={() => setPicked(null)} title="Leave Request" container={frame}>
        <Record r={picked ?? SICK} />
      </DetailPane>
    </div>
  );
}

export default {
  component: "ListDetail",
  states: {
    "Side By Side": () => <Requests />,
    "Nothing Picked": () => <Requests first={false} />,
    "Detail Pane": () => <Pane />,
  },
} satisfies GalleryEntry;
