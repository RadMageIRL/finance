// Sources for How Banks Create Money and How Money Flows, checked on November 15, 2026
// (local/research/m18/REPORT.md). Each lesson numbers its own list.

import type { Source } from './money';

export const LESSONS_REVIEWED = '2026-11-15';
export const LESSONS_REVIEWED_LABEL = 'November 15, 2026';

const BOE: Source = { id: 'boe-2014', publisher: 'Bank of England, Quarterly Bulletin 2014 Q1 (McLeay, Radia and Thomas)', title: 'Money creation in the modern economy', date: 'March 14, 2014', url: 'https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy' };
const FEDS_2022: Source = { id: 'feds-2022', publisher: 'Board of Governors of the Federal Reserve System, FEDS Notes (Castro, Cavallo and Zarutskie)', title: 'Understanding Bank Deposit Growth during the COVID-19 Pandemic', date: 'June 3, 2022', url: 'https://www.federalreserve.gov/econres/notes/feds-notes/understanding-bank-deposit-growth-during-the-covid-19-pandemic-20220603.html' };
const IORB_FAQ: Source = { id: 'fed-iorb-faq', publisher: 'Board of Governors of the Federal Reserve System', title: 'Interest on Reserve Balances (IORB) Frequently Asked Questions', date: 'last updated December 12, 2025', url: 'https://www.federalreserve.gov/monetarypolicy/iorb-faqs.htm' };
const FEDWIRE: Source = { id: 'fed-fedwire', publisher: 'Board of Governors of the Federal Reserve System', title: 'Fedwire Funds Services', date: 'last updated June 25, 2024', url: 'https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm' };
const LIABILITIES: Source = { id: 'fed-liabilities', publisher: 'Board of Governors of the Federal Reserve System', title: 'Federal Reserve liabilities', date: 'last updated November 15, 2021', url: 'https://www.federalreserve.gov/monetarypolicy/bst_frliabilities.htm' };

export const BANK_SOURCES: readonly Source[] = [
  BOE,
  FEDS_2022,
  IORB_FAQ,
  FEDWIRE,
  { id: 'cfr-217-10', publisher: 'Code of Federal Regulations (govinfo, 2026 edition)', title: '12 CFR 217.10, Minimum capital requirements', date: 'revised as of January 1, 2026', url: 'https://www.govinfo.gov/content/pkg/CFR-2026-title12-vol2/xml/CFR-2026-title12-vol2-sec217-10.xml' },
  { id: 'fed-omo', publisher: 'Board of Governors of the Federal Reserve System', title: 'Open Market Operations', date: 'last updated September 16, 2026', url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm' },
  { id: 'nyfed-effr', publisher: 'Federal Reserve Bank of New York', title: 'Effective Federal Funds Rate', date: 'undated', url: 'https://www.newyorkfed.org/markets/reference-rates/effr' },
  { id: 'fed-discount', publisher: 'Board of Governors of the Federal Reserve System', title: 'Discount Window', date: 'last updated May 20, 2024', url: 'https://www.federalreserve.gov/monetarypolicy/discountrate.htm' },
  { id: 'fed-implementation-2026-10', publisher: 'Board of Governors of the Federal Reserve System', title: 'Implementation Note issued October 28, 2026', date: 'October 28, 2026', url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a1.htm' },
  { id: 'fdic-qbp', publisher: 'Federal Deposit Insurance Corporation', title: 'Quarterly Banking Profile, Second Quarter 2026: Notes to Users', date: '2026', url: 'https://www.fdic.gov/quarterly-banking-profile/qbp-notes-users-second-quarter-2026.pdf' },
  { id: 'ffiec-glossary', publisher: 'Federal Financial Institutions Examination Council, Call Report instructions (FDIC copy)', title: 'Glossary: Allowances for Credit Losses', date: 'December 2025', url: 'https://www.fdic.gov/bank-financial-reports/ffiec-031-and-041-glossary-december-2025.pdf' },
  { id: 'fed-reserve-requirements', publisher: 'Board of Governors of the Federal Reserve System', title: 'Reserve Requirements', date: 'last updated November 26, 2025', url: 'https://www.federalreserve.gov/monetarypolicy/reservereq.htm' },
  { id: 'stlfed-2021', publisher: 'Federal Reserve Bank of St. Louis, Page One Economics (Ihrig, Weinbach and Wolla)', title: 'Teaching the Linkage Between Banks and the Fed: R.I.P. Money Multiplier', date: 'September 17, 2021', url: 'https://www.stlouisfed.org/publications/page-one-economics/2021/09/17/teaching-the-linkage-between-banks-and-the-fed-r-i-p-money-multiplier' },
];

export const FLOW_SOURCES: readonly Source[] = [
  FEDWIRE,
  { id: 'treasury-tga', publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service', title: 'Treasury General Account (TGA), TFX glossary', date: 'undated', url: 'https://tfx.treasury.gov/taxonomy/term/10867' },
  LIABILITIES,
  { id: 'fed-waller-2025', publisher: 'Board of Governors of the Federal Reserve System (speech by Governor Christopher J. Waller)', title: "Demystifying the Federal Reserve's Balance Sheet", date: 'July 10, 2025', url: 'https://www.federalreserve.gov/newsevents/speech/waller20250710a.htm' },
  { id: 'feds-2025-tga', publisher: 'Board of Governors of the Federal Reserve System, FEDS Notes (Vissing-Jorgensen)', title: "Fluctuations in the Treasury General Account and their effect on the Fed's balance sheet", date: 'August 6, 2025', url: 'https://www.federalreserve.gov/econres/notes/feds-notes/fluctuations-in-the-treasury-general-account-and-their-effect-on-the-feds-balance-sheet-20250806.html' },
  IORB_FAQ,
  FEDS_2022,
  { id: 'fed-explained', publisher: 'Board of Governors of the Federal Reserve System', title: 'The Fed Explained: What the Central Bank Does (11th edition)', date: 'August 2021', url: 'https://www.federalreserve.gov/aboutthefed/files/the-fed-explained.pdf' },
  { id: 'nyfed-rrp', publisher: 'Federal Reserve Bank of New York', title: 'FAQs: Reverse Repurchase Agreement Operations', date: 'September 16, 2026', url: 'https://www.newyorkfed.org/markets/rrp_faq' },
];

/** Numbers a lesson's sources in list order. */
export function numberer(sources: readonly Source[]): (id: string) => number {
  const map = new Map(sources.map((s, i) => [s.id, i + 1]));
  return (id: string) => {
    const n = map.get(id);
    if (!n) throw new Error(`lesson sources: unknown source ${id}`);
    return n;
  };
}
