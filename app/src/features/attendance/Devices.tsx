import devices from "@mycity/contract/schemas/devices.js";
import type { Device, DeviceStatus } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { useViewNews, withNews } from "@/features/notifications/marks";
import { Button, Chips, DataView, Field, formatDate, formatDateTime, FormFooter, HelpTerm, KeyValue, PageHeader, Pill, TextAreaField, toast, useContractForm, useModal, Who } from "@mycity/ui";
import { DEVICE_STATUS, DEVICE_STATUS_HELP } from "./labels";

const STATUS_CHIPS: Array<[DeviceStatus | "all", string]> = [
  ["all", "All"],
  ["registered", "Registered"],
  ["observed", "New"],
  ["removed", "Removed"],
];

/**
 * People · Devices (#27, docs/guides/attendance.md §10): the devices people clock in from, within
 * the reader's `people` scope. People with edit take one off, saying why; the person registers
 * their own from My Devices, so nothing here approves one.
 */
export function Devices() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const { can } = useAuth();
  const modal = useModal();
  const [status, setStatus] = useState<DeviceStatus | "all">("all");
  const list = usePaged("GET /api/v1/devices", { filters: status === "all" ? {} : { status } });
  const photo = usePhotos(list.rows.map((d) => d.employee.photo_url));
  const open = (d: Device) => modal.open({ title: d.label, body: (close) => <DeviceView d={d} close={close} canRemove={can("people", "edit")} /> });

  const link = useApi("GET /api/v1/devices/:id", { params: { id: id ?? "" }, enabled: !!id });
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (link.data && opened.current !== link.data.attendance_device_id) {
      opened.current = link.data.attendance_device_id;
      open(link.data);
    }
  });

  const news = useViewNews();
  return (
    <>
      <PageHeader title="Devices" sub="Devices used to clock in" />
      <Chips
        label="Status"
        value={status}
        onChange={setStatus}
        options={withNews(news, STATUS_CHIPS, { all: "all" })}
      />
      <DataView
        title="Devices"
        list={list}
        search="Device or Person"
        rowKey={(d) => d.attendance_device_id}
        onRowClick={open}
        noun="device"
        empty={{ icon: "lock", title: "No Devices", text: "Devices appear after their first punch." }}
        columns={[
          { key: "e", label: "Employee", render: (d) => <Who name={d.employee.display_name} sub={d.employee.department} src={photo(d.employee.photo_url)} /> },
          { key: "n", label: "Device", render: (d) => d.label },
          { key: "s", label: <HelpTerm help={DEVICE_STATUS_HELP}>Status</HelpTerm>, render: (d) => <Pill tone={DEVICE_STATUS[d.status].tone}>{DEVICE_STATUS[d.status].text}</Pill> },
          { key: "f", label: "First Seen", desktop: true, render: (d) => formatDate(d.first_seen_at) },
          { key: "l", label: "Last Punch", desktop: true, render: (d) => (d.last_punch_at ? formatDateTime(d.last_punch_at) : null) },
        ]}
      />
    </>
  );
}

function DeviceView({ d, close, canRemove }: { d: Device; close: () => void; canRemove: boolean }) {
  const f = useContractForm({ removal_reason: "" }, devices.DeviceRemove);
  const remove = useMutation("POST /api/v1/devices/:id/remove");
  const [asking, setAsking] = useState(false);
  const submit = async () => {
    if (!f.check()) return;
    try {
      await remove.run({ params: { id: d.attendance_device_id }, body: { removal_reason: f.values.removal_reason.trim() } });
      invalidate("/api/v1/devices");
      close();
      toast("Device removed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Device not removed");
    }
  };
  return (
    <>
      <KeyValue
        items={[
          ["Employee", d.employee.display_name],
          ["Status", <Pill key="s" tone={DEVICE_STATUS[d.status].tone}>{DEVICE_STATUS[d.status].text}</Pill>],
          ["First Seen", formatDateTime(d.first_seen_at)],
          ["Last Punch", d.last_punch_at ? formatDateTime(d.last_punch_at) : null],
          ["Registered", d.registered_at ? formatDate(d.registered_at) : null],
          ...(d.status === "removed"
            ? ([
                ["Removed", d.removed_at ? formatDate(d.removed_at) : null],
                ["Removed By", d.removed_by_name],
                ["Reason", d.removal_reason],
              ] as Array<[string, string | null]>)
            : []),
        ]}
      />
      {asking && (
        <Field label="Reason" className="mt-3" {...f.status("removal_reason")}>
          <TextAreaField {...f.field("removal_reason")} placeholder="Phone lost" rows={3} />
        </Field>
      )}
      <FormFooter>
        {asking ? (
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="danger" icon="trash" busy={remove.pending} onClick={() => submit()}>Remove Device</Button>
          </>
        ) : (
          <>
            {canRemove && d.status !== "removed" && <Button variant="danger" icon="trash" onClick={() => setAsking(true)}>Remove Device</Button>}
            <Button variant="primary" onClick={close}>Close</Button>
          </>
        )}
      </FormFooter>
    </>
  );
}
