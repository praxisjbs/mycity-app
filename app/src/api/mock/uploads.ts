import type { DocumentRef } from "@/api/types/common";

/** Files the mock upload engine "stored", so a later request that names one by id can find it. */
export const UPLOADS = new Map<string, DocumentRef>();
