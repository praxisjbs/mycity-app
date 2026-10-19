import type { DocumentRef } from "@/api/types/common";

/** Files the mock upload engine "stored", so a later request that names one by id can find it. */
export const UPLOADS = new Map<string, DocumentRef>();

/** What a route does with a file once it has "arrived" (the settings mock puts a brand file on the profile). */
export const ON_UPLOAD: Array<(endpoint: string, doc: DocumentRef) => void> = [];
