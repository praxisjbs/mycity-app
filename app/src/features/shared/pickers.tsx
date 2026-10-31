import type { Department, Project } from "@mycity/contract/contract.gen.ts";
import { usePhotos } from "@/api/download";
import { usePaged } from "@/api/hooks";
import "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { PersonPicker, RecordPicker } from "@mycity/ui";

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
  const photos = usePhotos(list.rows.map((row) => row.photo_url));
  return (
    <PersonPicker
      photo={(person) => photos(person.photo_url)}
      list={{
        rows: list.rows.map((row) => ({
          employee_id: row.employee_id,
          display_name: row.display_name,
          job_title: row.job_title,
          department: row.department,
          photo_url: row.photo_url,
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

/**
 * The people a task may be set for, or with `shared` shared with (My Workspace, GET /tasks/people):
 * the caller's own reach, never themselves, searched by the server. With `department`, who in that
 * department may lead a task shared with it, the caller included when they work there.
 */
export function TaskPeoplePicker({ shared, department, value, onChange, multiple }: { shared?: boolean; department?: string; value: PersonRef[]; onChange: (value: PersonRef[]) => void; multiple?: boolean }) {
  const list = usePaged("GET /api/v1/tasks/people", { filters: { ...(shared ? { shared: "true" } : {}), ...(department ? { department_id: department } : {}) } });
  const photos = usePhotos(list.rows.map((row) => row.photo_url));
  return (
    <PersonPicker
      photo={(person) => photos(person.photo_url)}
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value}
      onChange={onChange}
      multiple={multiple}
    />
  );
}

/**
 * Colleagues to message or recognise (Staff Community): anyone with a login, open to
 * every member of staff, where the employee register above needs the People grant.
 */
export function ColleaguePicker({ value, onChange, multiple, placeholder, withSelf }: { value: PersonRef[]; onChange: (value: PersonRef[]) => void; multiple?: boolean; placeholder?: string; withSelf?: boolean }) {
  const list = usePaged("GET /api/v1/community/people", { filters: withSelf ? { with_self: true } : {} });
  const photos = usePhotos(list.rows.map((row) => row.photo_url));
  return (
    <PersonPicker
      photo={(person) => photos(person.photo_url)}
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value}
      onChange={onChange}
      multiple={multiple}
      placeholder={placeholder}
    />
  );
}

/** Employees who have no login yet (Settings · Users, Invite User), searched by the server. */
export function LoginCandidatePicker({ value, onChange }: { value: PersonRef[]; onChange: (value: PersonRef[]) => void }) {
  const list = usePaged("GET /api/v1/users/candidates");
  return (
    <PersonPicker
      list={{
        rows: list.rows.map((row) => ({ employee_id: row.employee_id, display_name: row.display_name, job_title: row.job_title, department: row.department, photo_url: null })),
        page: list.page,
        loading: list.loading,
        error: list.error,
        q: list.q,
        setQ: list.setQ,
      }}
      value={value}
      onChange={onChange}
      placeholder="Search staff"
    />
  );
}

/** The organisation's active departments, searched by name on the server (one, unless `multiple`). */
export function DepartmentPicker({ value, onChange, multiple }: { value: Department[]; onChange: (value: Department[]) => void; multiple?: boolean }) {
  const list = usePaged("GET /api/v1/departments", { filters: { active: "true" } });
  return (
    <RecordPicker
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value}
      onChange={onChange}
      id={(d) => d.department_id}
      title={(d) => d.name}
      multiple={multiple}
      placeholder="Search departments"
    />
  );
}

export type ProjectChoice = Pick<Project, "project_id" | "number" | "name">;

/** The active projects, searched by number or name on the server (one): a task's Project. */
export function ProjectPicker({ value, onChange }: { value: ProjectChoice[]; onChange: (value: ProjectChoice[]) => void }) {
  const list = usePaged("GET /api/v1/projects", { filters: { status: "active" } });
  return (
    <RecordPicker
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value as Project[]}
      onChange={(rows) => onChange(rows.map((r) => ({ project_id: r.project_id, number: r.number, name: r.name })))}
      id={(p) => p.project_id}
      title={(p) => p.name}
      sub={(p) => p.number}
      placeholder="Search projects"
    />
  );
}

export type RoleRef = { code: string; name: string };

/** Roles, most senior first, from the server (seeds/reference/0101). Several may be picked. */
export function RolePicker({ value, onChange }: { value: RoleRef[]; onChange: (value: RoleRef[]) => void }) {
  const list = usePaged("GET /api/v1/access/roles");
  return (
    <RecordPicker
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={list.rows.filter((r) => value.some((v) => v.code === r.code))}
      onChange={(rows) => onChange(rows.map((r) => ({ code: r.code, name: r.name })))}
      id={(r) => r.code}
      title={(r) => r.name}
      sub={(r) => r.description ?? ""}
      multiple
      placeholder="Search roles"
    />
  );
}
