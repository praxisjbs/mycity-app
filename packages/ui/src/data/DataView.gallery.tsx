import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Money } from "../display/Money";
import { StatusPill } from "../display/Pill";
import { formatDate } from "../lib/format";
import { ApiError } from "./createApi";
import { DataView, type DataViewColumn, type DataViewList } from "./DataView";
import { SAMPLE_PAGE, SAMPLE_ROWS, type SampleRow } from "./fixtures";

const columns: DataViewColumn<SampleRow>[] = [
  { key: "display_name", label: "Name", sortable: true, render: (r) => r.display_name },
  { key: "department", label: "Department", sortable: true, render: (r) => r.department },
  { key: "job_title", label: "Job Title", desktop: true, render: (r) => r.job_title },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  { key: "owed", label: "Owed", align: "n", sortable: true, render: (r) => <Money value={r.owed} /> },
  { key: "joined_on", label: "Joined", sortable: true, desktop: true, render: (r) => formatDate(r.joined_on) },
  { key: "note", label: "Note", desktop: true, render: (r) => r.note },
];

/** Stands in for a usePaged() result: the gallery has no server. */
function useSample(over: Partial<DataViewList<SampleRow>> = {}): DataViewList<SampleRow> {
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const [number, setNumber] = useState(1);
  return {
    rows: SAMPLE_ROWS,
    page: { ...SAMPLE_PAGE, number, has_next: number < SAMPLE_PAGE.pages },
    loading: false,
    error: null,
    setPage: setNumber,
    q,
    setQ,
    sort,
    setSort,
    reload: () => undefined,
    ...over,
  };
}

const Basic = () => <DataView list={useSample()} columns={columns} rowKey={(r) => r.employee_id} title="Employees" noun="employee" nounPlural="employees" />;

const Everything = () => {
  const [keys, setKeys] = useState<string[]>([]);
  return (
    <DataView
      list={useSample()}
      columns={columns}
      rowKey={(r) => r.employee_id}
      title="Employees"
      help="Everyone with an employee record, including people who have left."
      search="Search People"
      noun="employee"
      onRowClick={() => undefined}
      onExport={() => Promise.resolve({})}
      selection={{ keys, onChange: setKeys, actions: <Button icon="mail">Send Letter</Button> }}
    />
  );
};

export default {
  component: "DataView",
  states: {
    Basic,
    "Everything On": Everything,
    Sorted: () => <DataView list={useSample({ sort: "-owed" })} columns={columns} rowKey={(r) => r.employee_id} title="Employees" noun="employee" />,
    Selected: () => (
      <DataView
        list={useSample()}
        columns={columns}
        rowKey={(r) => r.employee_id}
        title="Employees"
        noun="employee"
        selection={{ keys: ["e1", "e3"], onChange: () => undefined, actions: <Button icon="mail">Send Letter</Button> }}
      />
    ),
    Loading: () => <DataView list={useSample({ rows: [], loading: true, page: undefined })} columns={columns} rowKey={(r) => r.employee_id} title="Employees" />,
    Empty: () => <DataView list={useSample({ rows: [], page: undefined })} columns={columns} rowKey={(r) => r.employee_id} title="Employees" empty={{ title: "No Employees Yet", text: "Import the staff sheet to begin." }} />,
    Failed: () => <DataView list={useSample({ rows: [], page: undefined, error: new ApiError(500, null) })} columns={columns} rowKey={(r) => r.employee_id} title="Employees" />,
    "Without Card": () => <DataView rows={SAMPLE_ROWS.slice(0, 3)} columns={columns.slice(0, 4)} rowKey={(r) => r.employee_id} caption="Approval Steps" bare />,
  },
} satisfies GalleryEntry;
