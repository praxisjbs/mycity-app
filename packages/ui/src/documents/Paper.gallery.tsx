import type { GalleryEntry } from "../testing/gallery";
import { Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, Signature } from "./Paper";

const Offer = () => (
  <Paper note="This is how the offer will print">
    <PaperLogo reference="OFF/2026/0041" />
    <PaperTitle sub="For Adaeze Okonkwo, from 01/11/2026">Offer of Employment</PaperTitle>
    <p>We are pleased to offer you the role of Financial Controller, reporting to the Chief Executive.</p>
    <PaperTable
      head={["Item", "Amount"]}
      rows={[
        ["Basic", "₦350,000.00"],
        ["Housing", "₦62,500.00"],
        ["Transport", "₦40,000.00"],
      ]}
      totals={[["Gross Monthly", "₦452,500.00"]]}
    />
    <p>This offer stands until 25/10/2026.</p>
    <PaperFoot>
      <Signature>Chidi Eze</Signature>
      <span>Chief Executive, 13/10/2026</span>
      <span className="ml-auto">Verify at go.mycityapp.io/verify/OFF-2026-0041</span>
    </PaperFoot>
  </Paper>
);

const Payslip = () => (
  <Paper>
    <PaperLogo reference="PS/2026/09/0184" />
    <PaperTitle sub="Adaeze Okonkwo, September 2026">Payslip</PaperTitle>
    <PaperTable
      head={["Earnings", "Amount"]}
      rows={[
        ["Basic", "₦350,000.00"],
        ["Housing", "₦62,500.00"],
        ["Pension", "-₦28,000.00"],
        ["PAYE", "-₦52,400.00"],
      ]}
      totals={[["Net Pay", "₦332,100.00"]]}
    />
    <PaperFoot>
      <span>Paid 25/09/2026</span>
    </PaperFoot>
  </Paper>
);

export default {
  component: "Paper",
  states: { "An Offer": Offer, "A Payslip": Payslip },
} satisfies GalleryEntry;
