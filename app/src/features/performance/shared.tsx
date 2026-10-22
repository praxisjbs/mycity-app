/** What the Performance tabs share. */
import type { PersonRef } from "@/api/types/common";
import { Who } from "@mycity/ui";

/** A person in a table cell: their name, and their department beneath it. */
export const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;
