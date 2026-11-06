import { createContext } from "react";

/**
 * The height of a header that sticks above the page (the public site's, 64 px), so a column that
 * sticks (StickyColumns) stops under it rather than behind it. PublicPage provides it; 0 elsewhere.
 */
export const StickyTop = createContext(0);
