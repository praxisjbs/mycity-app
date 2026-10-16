/**
 * @component PersonPicker
 * @group Forms
 * @summary Picks people the server searches: their name, job title and department, one page of 25 at a time.
 * @use Any field that names a person: an approver, an interview panel, a task's owner, who a letter is for.
 * @avoid Loading every employee into a dropdown (FRONTEND_GUIDE §4); a free-text name box where a record exists; a picker for the person signed in.
 * @phone Full width, each person a 44 px row with their initials; the picked chips wrap above the search box.
 * @a11y A search box over a listbox whose options say whether they are picked, and each person named by their own words.
 * @status stable
 * @example <PersonPicker list={employees} value={panel} onChange={setPanel} multiple />
 */
import { Avatar } from "../display/Avatar";
import type { DataViewList } from "../data/DataView";
import { RecordPicker } from "./RecordPicker";

/** A person as every list of people answers: the shape the app's PersonRef already has. */
export interface PickedPerson {
  /** The employee's id, which is what a record stores. */
  employee_id: string;
  /** Their name as the organisation holds it. */
  display_name: string;
  /** Their job title, where the list carries it. */
  job_title?: string | null;
  /** Their department, where the list carries it. */
  department?: string | null;
}

export interface PersonPickerProps<P extends PickedPerson> {
  /** The server-paged people to pick from (a `usePaged()` result). */
  list: DataViewList<P>;
  /** Who is picked, held by the form. */
  value: P[];
  /** Called with the new set. */
  onChange: (value: P[]) => void;
  /** Pick several; one only unless set. */
  multiple?: boolean;
  /** A format example of at most 3 words; "Search people" otherwise. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function PersonPicker<P extends PickedPerson>({ list, value, onChange, multiple, placeholder = "Search people", className }: PersonPickerProps<P>) {
  return (
    <RecordPicker
      list={list}
      value={value}
      onChange={onChange}
      multiple={multiple}
      placeholder={placeholder}
      className={className}
      id={(person) => person.employee_id}
      title={(person) => person.display_name}
      chip={(person) => person.display_name}
      sub={(person) => [person.job_title, person.department].filter(Boolean).join(" · ")}
      lead={(person) => <Avatar name={person.display_name} size={30} />}
    />
  );
}
