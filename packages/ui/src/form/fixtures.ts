/**
 * Sample people and records for the pickers' gallery pages, and an uploader
 * that pretends to travel so the progress can be watched. Not exported from
 * the package; a screen's records come from the API and its uploads from the
 * app's own client.
 */
import type { DocumentRef, Uploader } from "../lib/upload";
import type { PickedPerson } from "./PersonPicker";

export const SAMPLE_PEOPLE: PickedPerson[] = [
  { employee_id: "e1", display_name: "Adaeze Okonkwo", job_title: "Financial Controller", department: "Finance" },
  { employee_id: "e2", display_name: "Chidi Eze", job_title: "People Partner", department: "People" },
  { employee_id: "e3", display_name: "Ngozi Bello", job_title: "Operations Lead", department: "Operations" },
  { employee_id: "e4", display_name: "Tunde Balogun", job_title: "Platform Engineer", department: "Technology" },
];

export interface SampleSite {
  worksite_id: string;
  name: string;
  area: string;
}

export const SAMPLE_SITES: SampleSite[] = [
  { worksite_id: "w1", name: "Lekki Office", area: "Lagos Island" },
  { worksite_id: "w2", name: "Ikeja Depot", area: "Lagos Mainland" },
  { worksite_id: "w3", name: "Apapa Yard", area: "Lagos Mainland" },
];

export interface SampleUnit {
  unit: string;
  uses: number;
}

/** Units in use, most used first, as a KPI's Unit field is offered them. */
export const SAMPLE_UNITS: SampleUnit[] = [
  { unit: "%", uses: 31 },
  { unit: "users", uses: 9 },
  { unit: "days", uses: 6 },
  { unit: "₦", uses: 4 },
  { unit: "partners", uses: 1 },
];

/** Climbs to 100 over about a second, so the gallery shows a real percentage. */
export const slowUploader: Uploader = ({ file, onProgress }) =>
  new Promise<DocumentRef>((resolve) => {
    let percent = 0;
    const tick = setInterval(() => {
      percent = Math.min(100, percent + 12);
      onProgress?.(percent);
      if (percent === 100) {
        clearInterval(tick);
        resolve({ document_id: `d-${file.name}`, file_name: file.name, size_bytes: file.size, mime_type: file.type || "application/octet-stream" });
      }
    }, 110);
  });
