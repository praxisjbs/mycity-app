/**
 * The one field binding the form hook returns and every field takes, so a
 * form moves from INTERIM rules to the contract schema by changing the hook's
 * second argument, not the fields (FRONTEND_GUIDE §8.3).
 *
 *   const f = useContractForm({ first_name: "" }, schemas.organisation.EmployeeCreate);
 *   <Field label="First Name" {...f.status("first_name")}>
 *     <TextField {...f.field("first_name")} />
 *   </Field>
 */

/** The mark a field shows: bad (an error), good (a formatted value is right), or none yet. */
export type FieldState = "bad" | "good" | undefined;

/** What a field control takes from a form hook. */
export interface FieldBinding<V> {
  /** The current value. */
  value: V;
  /** Called with the new value as the person types or picks. */
  onChange: (value: V) => void;
  /** Called when the person leaves the field: the moment it is first checked. */
  onBlur: () => void;
  /** The mark to show. */
  state: FieldState;
  /** The error, at most 4 words, when the state is bad. */
  message: string | undefined;
  /**
   * Told by the control what only it can see, at most 4 words ("Not a real date", a typed day
   * outside its range), or undefined once it is gone. The form marks the field with it and
   * check() refuses it; `now` marks it at once, for a problem the person cannot be still typing.
   */
  onProblem?: (message: string | undefined, now?: boolean) => void;
}

/** A server error's fields (ApiError.fields): name to messages. */
export type ServerFields = Record<string, string[] | undefined>;
