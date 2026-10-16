import type { GalleryEntry } from "../testing/gallery";
import { Pager } from "./Pager";

export default {
  component: "Pager",
  states: {
    "Many Pages": () => <Pager page={{ number: 4, size: 25, total: 312, pages: 13, has_next: true }} onPage={() => undefined} noun="employee" />,
    "First Page": () => <Pager page={{ number: 1, size: 25, total: 312, pages: 13, has_next: true }} onPage={() => undefined} noun="employee" />,
    "Last Page": () => <Pager page={{ number: 13, size: 25, total: 312, pages: 13, has_next: false }} onPage={() => undefined} noun="employee" />,
    "One Page": () => <Pager page={{ number: 1, size: 25, total: 7, pages: 1, has_next: false }} onPage={() => undefined} noun="request" />,
    "One Row": () => <Pager page={{ number: 1, size: 25, total: 1, pages: 1, has_next: false }} onPage={() => undefined} noun="query" nounPlural="queries" />,
    Empty: () => <Pager page={{ number: 1, size: 25, total: 0, pages: 0, has_next: false }} onPage={() => undefined} noun="expense" />,
  },
} satisfies GalleryEntry;
