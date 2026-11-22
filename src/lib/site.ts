// Site-wide constants: identity, navigation and the Phase 1 catalog.

export const SITE = {
  name: 'RadMage Finance',
  publisher: 'RadMage Labs',
  publisherUrl: 'https://radmagelabs.com/',
  origin: 'https://radmagelabs.com',
  contactEmail: 'radmageirl@radmagelabs.com',
  description:
    'Interactive lessons and calculators that show how money, banking and interest work, with every fact sourced. Source-linked financial news is in development.',
} as const;

export interface NavItem {
  label: string;
  path: string;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { label: 'Home', path: '' },
  { label: 'News', path: 'news/' },
  { label: 'Learn', path: 'learn/' },
  { label: 'Calculators', path: 'calculators/' },
];

/** The More menu in the header and the second group in the phone menu. */
export const MORE_NAV: readonly NavItem[] = [
  { label: 'About', path: 'about/' },
  { label: 'Methodology', path: 'methodology/' },
  { label: 'Sources', path: 'sources/' },
  { label: 'Corrections', path: 'corrections/' },
  { label: 'Privacy', path: 'privacy/' },
  { label: 'Disclaimer', path: 'disclaimer/' },
];

/**
 * The economic data pages (decision D15 (b)): an entry in the More menu, kept apart from the
 * reference pages there, plus links from Home and the lessons; the primary bar approved at G1a
 * is unchanged. No calculator links to or prefills from the data (decision D14).
 */
export const DATA_NAV: NavItem = { label: 'Economic conditions', path: 'data/' };

/** The three dashboards, for the Home page (DashboardNav lists them on the data pages). */
export const DATA_PAGES: readonly CatalogItem[] = [
  {
    title: 'Interest rates',
    path: 'data/federal-funds-rate/',
    summary: 'The effective federal funds rate from the New York Fed, with the FOMC target range.',
    detail: 'Daily history, with the observed rate and the derived target range told apart.',
    status: 'available',
  },
  {
    title: 'Money supply',
    path: 'data/money-stock/',
    summary: 'M1 and M2 from the Federal Reserve Board H.6 release.',
    detail: 'Monthly, seasonally adjusted and not, with revisions shown.',
    status: 'available',
  },
  {
    title: 'National debt',
    path: 'data/public-debt/',
    summary: "Total public debt outstanding and its two parts, from the Treasury's Debt to the Penny.",
    detail: 'Daily values as published, with missing and unusual days explained.',
    status: 'available',
  },
];

export const FOOTER_GROUPS: readonly { title: string; items: readonly NavItem[] }[] = [
  {
    title: 'Explore',
    items: [
      { label: 'News', path: 'news/' },
      { label: 'Learn', path: 'learn/' },
      { label: 'Calculators', path: 'calculators/' },
      { label: 'About', path: 'about/' },
    ],
  },
  {
    title: 'Standards',
    items: [
      { label: 'Methodology', path: 'methodology/' },
      { label: 'Sources', path: 'sources/' },
      { label: 'Corrections', path: 'corrections/' },
    ],
  },
  {
    title: 'Policies',
    items: [
      { label: 'Privacy', path: 'privacy/' },
      { label: 'Disclaimer', path: 'disclaimer/' },
    ],
  },
];

/**
 * News is a core section. Until feeds are collected (a later phase) the News page is a
 * layout preview: it shows no stories, carries noindex, and stays out of the sitemap.
 */
export const NEWS_LIVE = false;

export interface NewsCategory {
  id: string;
  label: string;
  scope: string;
}

export const NEWS_CATEGORIES: readonly NewsCategory[] = [
  { id: 'markets', label: 'Markets', scope: 'Stocks, bonds, currencies and commodities: what moved, and what the reporting says about why.' },
  { id: 'economy', label: 'Economy', scope: 'Jobs, inflation, growth and spending, alongside the official releases they come from.' },
  { id: 'federal-reserve', label: 'Federal Reserve', scope: 'Policy decisions, statements, minutes, speeches and the Fed balance sheet.' },
  { id: 'banking', label: 'Banking', scope: 'Lending, deposits, bank health, failures and supervision.' },
  { id: 'crypto', label: 'Crypto', scope: 'Digital assets and stablecoins: regulation, institutional adoption and infrastructure, without hype.' },
  { id: 'regulation', label: 'Regulation', scope: 'Financial rules and legislation: proposals, final rules, enforcement actions and votes.' },
];

export type ItemStatus = 'available' | 'in-development';

export interface CatalogItem {
  title: string;
  path: string;
  summary: string;
  detail: string;
  status: ItemStatus;
}

export const MODULES: readonly CatalogItem[] = [
  {
    title: 'What Is Money?',
    path: 'learn/what-is-money/',
    summary: 'Cash, bank deposits, reserves, Treasury bills, stablecoins, bitcoin and gold, compared side by side.',
    detail: 'Whose promise each one is, who can hold it, how a payment settles, and what backs it.',
    status: 'available',
  },
  {
    title: 'How Banks Create Money',
    path: 'learn/how-banks-create-money/',
    summary: 'Make a loan, watch a deposit appear, then follow repayment, interest, settlement between banks and default.',
    detail: 'Capital, liquidity and credit risk shown as the constraints they are.',
    status: 'available',
  },
  {
    title: 'How Money Flows',
    path: 'learn/how-money-flows/',
    summary: 'Follow wages, spending, taxes and bond purchases between households, businesses, banks, the government and the Fed.',
    detail: 'Every step updates real balance sheets that always balance.',
    status: 'available',
  },
];

export const CALCULATORS: readonly CatalogItem[] = [
  {
    title: 'Compound interest',
    path: 'calculators/compound-interest/',
    summary: 'See how a balance grows with annual to daily compounding and regular contributions.',
    detail: 'Schedules by day, month or year, contributions versus interest.',
    status: 'available',
  },
  {
    title: 'APR and APY',
    path: 'calculators/apr-apy/',
    summary: 'Convert between an interest rate and the annual percentage yield, from annual to daily compounding, and compare up to three accounts.',
    detail: 'Why a savings APY and a loan APR measure different things.',
    status: 'available',
  },
  {
    title: 'High-yield savings',
    path: 'calculators/savings-growth/',
    summary: 'Project a savings balance with deposits, rate changes and daily or monthly compounding.',
    detail: 'Interest earned each period and the APY you actually earned.',
    status: 'available',
  },
  {
    title: 'Loan amortization',
    path: 'calculators/amortization/',
    summary: 'Build the full payment schedule for a fixed-rate loan, month by month.',
    detail: 'How each payment splits between principal and interest.',
    status: 'available',
  },
  {
    title: 'Mortgage payoff',
    path: 'calculators/loan-payoff/',
    summary: 'Compare paying as scheduled with extra monthly or one-time principal payments.',
    detail: 'Interest saved, months saved and the new payoff date.',
    status: 'available',
  },
];

/** The date the Phase 1 pages' text and facts were last reviewed. */
export const PHASE1_REVIEWED = '2026-11-16';

const ORGANIZATION = { '@type': 'Organization', name: SITE.publisher, url: SITE.publisherUrl } as const;

/** schema.org properties for a calculator page (SEO_STRATEGY section 4). */
export function calculatorSchema(reviewed = PHASE1_REVIEWED): Record<string, unknown> {
  return {
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any (runs in a web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    author: ORGANIZATION,
    dateModified: reviewed,
  };
}

/** schema.org properties for a Learn module (SEO_STRATEGY section 4). */
export function lessonSchema(about: readonly string[], reviewed = PHASE1_REVIEWED): Record<string, unknown> {
  return {
    learningResourceType: 'Interactive lesson',
    isAccessibleForFree: true,
    author: ORGANIZATION,
    datePublished: reviewed,
    dateModified: reviewed,
    about: about.map((name) => ({ '@type': 'Thing', name })),
  };
}
