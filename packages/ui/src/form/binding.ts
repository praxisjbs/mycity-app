/**
 * The one field binding every form hook returns and every field takes, so a
 * screen moves from the interim useForm to useContractForm by changing the
 * hook, not the fields (FRONTEND_GUIDE §8.3).
 *
 *   const form = useContractForm(schemas.organisation.EmployeeCreate, { first_name: "" });
 *   <Field label="First Name" {...form.status("first_name")}>
 *     <TextField {...form.field("first_name")} />
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
}

/** A server error's fields (ApiError.fields): name to messages. */
export type ServerFields = Record<string, string[] | undefined>;
