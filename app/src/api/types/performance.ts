import type { IsoDateTime, Tone } from "./common";

/** The status words other INTERIM mocks share (recruitment's). Every status is worded by the API. */
export type Status = { tone: Tone; text: string };
export type Step = { label: string; state: "done" | "now" | null };
export type Trail = { title: string; when: IsoDateTime; text: string | null; tone: "hi" | "ok" | null };
