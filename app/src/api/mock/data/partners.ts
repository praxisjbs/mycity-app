import { isoDaysAgo, sid } from "../core";

/** Demonstration partners. Stages are MyCity's own tracker stages (MILESTONES §12). */
export const STAGES = [
  "Prospect identified", "Initial contact", "Intro meeting scheduled", "Intro meeting held", "Proposal sent", "Follow up",
  "Ongoing negotiation", "Verbal approval", "Contract review", "Partnership signed", "Active partnership", "On hold",
] as const;
export type Stage = (typeof STAGES)[number];

export interface MockPartner {
  partner_id: string;
  name: string;
  legal_name: string;
  industry: string;
  type: string;
  owner: string; // user_key
  stage: Stage;
  value: string;
  quiet_days: number;
  days_at_stage: number;
  since: string | null;
  renewal: string | null;
  hq: string;
  website: string;
}

type R = [string, string, string, string, string, Stage, string, number, number, string | null, string | null, string, string];
const ROWS: R[] = [
  ["MTN Nigeria", "MTN Nigeria Communications Plc", "Telecoms", "Strategic", "cynthia", "Active partnership", "18400000.00", 2, 210, "2025-03-13", "2027-03-13", "Ikoyi, Lagos", "mtn.ng"],
  ["ProvidusBank", "Providus Bank Limited", "Banking", "Sponsorship", "ngozi", "Active partnership", "9200000.00", 1, 22, "2026-09-22", "2026-12-31", "Victoria Island, Lagos", "providusbank.com"],
  ["Lagos State Government", "Lagos State Ministry of Tourism, Arts and Culture", "Government", "Government", "cynthia", "Contract review", "7500000.00", 6, 6, null, null, "Alausa, Ikeja", "lagosstate.gov.ng"],
  ["Lonart-DS", "Greenlife Pharmaceuticals Limited", "Healthcare", "Sponsorship", "bashir", "Proposal sent", "4100000.00", 12, 12, null, null, "Ilupeju, Lagos", "greenlife.ng"],
  ["Eko Hotels", "Eko Hotels and Suites Limited", "Hospitality", "Hospitality", "bashir", "Follow up", "2800000.00", 34, 34, null, null, "Victoria Island, Lagos", "ekohotels.com"],
  ["Filmhouse Cinemas", "Filmhouse Cinemas Limited", "Entertainment", "Media", "ngozi", "Ongoing negotiation", "3600000.00", 4, 9, null, null, "Lekki, Lagos", "filmhouseng.com"],
  ["Kano Trade Council", "Kano State Chamber of Commerce, Industry, Mines and Agriculture", "Government", "Community", "ngozi", "Initial contact", "1900000.00", 52, 52, null, null, "Kano", "kanocc.org.ng"],
  ["Ikeja City Mall", "Ikeja City Mall Limited", "Retail", "Sponsorship", "grace", "Active partnership", "1350000.00", 8, 120, "2026-01-19", "2027-01-19", "Ikeja, Lagos", "ikejacitymall.com"],
  ["Access Bank", "Access Bank Plc", "Banking", "Sponsorship", "ngozi", "Active partnership", "1100000.00", 11, 95, "2026-02-28", "2027-02-28", "Victoria Island, Lagos", "accessbankplc.com"],
  ["GTCO Foundation", "Guaranty Trust Holding Company Plc", "Banking", "Community", "ngozi", "Active partnership", "750000.00", 15, 300, "2025-07-11", "2026-11-11", "Victoria Island, Lagos", "gtcoplc.com"],
  ["Landmark Beach", "Landmark Leisure Limited", "Hospitality", "Hospitality", "bashir", "Proposal sent", "2200000.00", 41, 41, null, null, "Oniru, Lagos", "landmarkbeach.com"],
  ["Enugu Tourism Board", "Enugu State Tourism Board", "Government", "Government", "ngozi", "Intro meeting held", "1500000.00", 38, 38, null, null, "Enugu", "enugustate.gov.ng"],
  ["Enugu City Council", "Enugu North Local Government", "Government", "Community", "adedotun", "Ongoing negotiation", "1200000.00", 9, 14, null, null, "Enugu", "enugustate.gov.ng"],
  ["Abuja Chamber of Commerce", "Abuja Chamber of Commerce and Industry", "Government", "Community", "adedotun", "Intro meeting scheduled", "900000.00", 31, 10, null, null, "Abuja", "acci.com.ng"],
  ["Oyo Tourism Board", "Oyo State Tourism Board", "Government", "Government", "ngozi", "Prospect identified", "800000.00", 30, 30, null, null, "Ibadan", "oyostate.gov.ng"],
];

const EXTRA_NAMES = [
  "Shoprite Nigeria", "Dangote Foundation", "Nestle Nigeria", "Jumia", "Paystack", "Flutterwave", "Interswitch", "Air Peace", "Arik Air",
  "Transcorp Hilton", "Radisson Blu Ikeja", "Wema Bank", "Stanbic IBTC", "Nigerian Breweries", "Glo Mobile", "Airtel Nigeria",
];

export const PARTNERS: MockPartner[] = [
  ...ROWS.map((r) => ({
    partner_id: sid(`partner:${r[0]}`), name: r[0], legal_name: r[1], industry: r[2], type: r[3], owner: r[4], stage: r[5], value: r[6],
    quiet_days: r[7], days_at_stage: r[8], since: r[9], renewal: r[10], hq: r[11], website: r[12],
  })),
  ...EXTRA_NAMES.map((name, i) => {
    const stage = i < 13 ? "Active partnership" : (["Prospect identified", "On hold", "Intro meeting scheduled"] as const)[i - 13];
    return {
      partner_id: sid(`partner:${name}`), name, legal_name: `${name} Limited`, industry: ["Retail", "Banking", "Fintech", "Aviation", "Hospitality", "FMCG", "Telecoms"][i % 7],
      type: ["Sponsorship", "Strategic", "Media", "Community"][i % 4], owner: ["ngozi", "bashir", "grace", "adedotun"][i % 4], stage: stage as Stage,
      value: `${(400 + ((i * 137) % 1600)) * 1000}.00`, quiet_days: 3 + ((i * 7) % 24), days_at_stage: 20 + i * 9,
      since: stage === "Active partnership" ? isoDaysAgo(60 + i * 20) : null, renewal: null, hq: "Lagos", website: `${name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
    };
  }),
];

export const stageTone = (s: Stage, quiet: number): "ok" | "warn" | "err" | "info" | "neutral" =>
  quiet > 30 ? "err" : s === "Active partnership" || s === "Partnership signed" ? "ok" : s === "Proposal sent" || s === "Follow up" ? "warn" : s === "On hold" || s === "Prospect identified" ? "neutral" : "info";
