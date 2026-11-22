// The four dashboard pages and the existing lessons and calculators each links back to (brief Q;
// design P28 11.1). Decision D14: the calculators never link to or prefill from the federal
// funds rate; a dashboard may link to the calculators, and the rates page says plainly that no
// calculator uses that rate, so the overnight interbank rate is not read as a savings APY.
import type { DashboardId } from '../../lib/data/ui';

export interface Dashboard {
  id: DashboardId;
  label: string;
  path: string;
  /** What the page shows, for the overview's links. */
  summary: string;
}

export const DASHBOARDS: readonly Dashboard[] = [
  { id: 'overview', label: 'Overview', path: 'data/', summary: 'The latest value of each indicator, with its source and status.' },
  { id: 'federal-funds-rate', label: 'Interest rates', path: 'data/federal-funds-rate/', summary: 'The effective federal funds rate from the New York Fed, with the FOMC target range derived from its records.' },
  { id: 'money-stock', label: 'Money supply', path: 'data/money-stock/', summary: 'M1 and M2 from the Federal Reserve Board H.6 release, seasonally adjusted and not.' },
  { id: 'public-debt', label: 'National debt', path: 'data/public-debt/', summary: "Total public debt outstanding and its two parts, from the Treasury's Debt to the Penny." },
];

export interface RelatedLink {
  path: string;
  label: string;
  text: string;
}

const LESSON_BANKS: RelatedLink = { path: 'learn/how-banks-create-money/', label: 'How Banks Create Money', text: 'how banks borrow reserves overnight, and what the federal funds rate is.' };
const LESSON_MONEY: RelatedLink = { path: 'learn/what-is-money/', label: 'What Is Money?', text: 'what M1 and M2 count, and what they leave out.' };
const LESSON_FLOWS: RelatedLink = { path: 'learn/how-money-flows/', label: 'How Money Flows', text: "Treasury securities, taxes and the government's account at the Fed." };
const CALCULATORS: RelatedLink = { path: 'calculators/', label: 'Calculators', text: 'savings, interest and loans, with the rates and amounts you enter.' };

/** The lessons and calculators a dashboard links back to, most relevant first. */
export const RELATED: Record<DashboardId, readonly RelatedLink[]> = {
  overview: [LESSON_MONEY, LESSON_BANKS, LESSON_FLOWS, CALCULATORS],
  'federal-funds-rate': [LESSON_BANKS, LESSON_FLOWS, CALCULATORS],
  'money-stock': [LESSON_MONEY, LESSON_BANKS, CALCULATORS],
  'public-debt': [LESSON_FLOWS, LESSON_MONEY, CALCULATORS],
};

/** A sentence under the related links, where a page needs one (decision D14). */
export const RELATED_NOTE: Partial<Record<DashboardId, string>> = {
  'federal-funds-rate': 'The calculators use the rates you enter. None of them uses the federal funds rate: it is the rate at which banks lend reserves to each other overnight, not the rate a bank pays on savings or charges on a loan.',
};
