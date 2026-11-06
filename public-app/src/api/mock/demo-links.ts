/**
 * Sample addresses for the demo strip at the foot of every page, shown in mock
 * mode only. Each opens a fixture in ./public.ts. Plain data, so importing it
 * does not pull the mock API into a build.
 */
export const DEMO_LINKS: Array<[string, string]> = [
  ["Home", "/"],
  ["Open roles", "/jobs"],
  ["Open roles, a search", "/jobs?q=Lagos"],
  ["Vacancy", "/jobs/head-sales-revenue-lagos"],
  ["Vacancy, short", "/jobs/operations-intern-lagos"],
  ["Open roles, one team", "/jobs?department=MKT"],
  ["Paused role", "/jobs/video-editor-lagos"],
  ["Filled role", "/jobs/studio-assistant-lagos"],
  ["Closing day passed", "/jobs/copywriter-lagos"],
  ["Apply", "/apply/k7Qm2TxV9pLa"],
  ["Apply, no link", "/apply"],
  ["Apply, portfolio question", "/apply/Bv3nQ8sLp2Wd"],
  ["Expired apply link", "/apply/Wn4cR8yHj2Zs"],
  ["Assessment, no link", "/assess"],
  ["Assessment, not started", "/assess/Px2mL9vQe4Ty"],
  ["Assessment, in progress", "/assess/Hb6tZ3qNw8Rk"],
  ["Take-home brief", "/assess/Tk8wD3fRm6Qa"],
  ["Assessment, finished", "/assess/Jd5sF7aWc3Xe"],
  ["Assessment, time up", "/assess/Mz4pK7tYb2Vn"],
  ["Sign offer, no link", "/sign"],
  ["Sign offer", "/sign/Rt8wN2kPz5Gb"],
  ["Offer already signed", "/sign/Yc3vB6mQh9Ls"],
  ["Offer expired", "/sign/Gz7kT4pXw2Nd"],
  ["Verify", "/verify"],
  ["Verify, matches", "/verify/OFF-0016"],
  ["Verify, file altered", "/verify/OFF-0012"],
  ["Verify, record altered", "/verify/OFF-0011"],
  ["Verify, not this document", "/verify/OFF-0009"],
  ["Verify, not found", "/verify/OFF-0099"],
  ["Verify, QR on OFF-0016", "/verify/t/Qd5mW8rTx3Kp"],
];
