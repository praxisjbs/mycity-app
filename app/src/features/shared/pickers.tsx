import { usePaged } from "@/api/hooks";
import "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { PersonPicker } from "@mycity/ui";

/**
 * The pickers bound to this app's endpoints. `PersonPicker` and `RecordPicker`
 * in @mycity/ui are data-free (FRONTEND_FOUNDATION PR 2 question 1): they take
 * the list and drive its search, so the endpoint stays the app's.
 *
 * Everyone with an employee record, paged at 25 by the server and narrowed by
 * what the person types (FRONTEND_GUIDE §4: never a dropdown of everyone).
 */
export function EmployeePicker({
  value,
  onChange,
  multiple,
  placeholder,
}: {
  value: PersonRef[];
  onChange: (value: PersonRef[]) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const list = usePaged("GET /api/v1/employees");
  return (
    <PersonPicker
      list={{
        rows: list.rows.map((row) => ({
          employee_id: row.employee_id,
          display_name: row.display_name,
          job_title: row.job_title,
          department: row.department,
        })),
        page: list.page,
        loading: list.loading,
        error: list.error,
        q: list.q,
        setQ: list.setQ,
      }}
      value={value}
      onChange={onChange}
      multiple={multiple}
      placeholder={placeholder}
    />
  );
}
