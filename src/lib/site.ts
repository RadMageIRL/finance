// Site-wide constants: identity, navigation and the Phase 1 catalog.

export const SITE = {
  name: 'RadMage Finance',
  publisher: 'RadMage Labs',
  publisherUrl: 'https://radmagelabs.com/',
  origin: 'https://radmagelabs.com',
  contactEmail: 'radmageirl@radmagelabs.com',
  description:
    'Free financial news from named sources, interactive lessons, and calculators that show how money, banking and interest work, with every fact sourced.',
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
    title: 'How Money Flows',
    path: 'learn/how-money-flows/',
    summary: 'Follow wages, spending, taxes and bond purchases between households, businesses, banks, the government and the Fed.',
    detail: 'Every step updates real balance sheets that always balance.',
    status: 'in-development',
  },
  {
    title: 'How Banks Create Money',
    path: 'learn/how-banks-create-money/',
    summary: 'Make a loan, watch a deposit appear, then follow repayment, interest, settlement between banks and default.',
    detail: 'Capital, liquidity and credit risk shown as the constraints they are.',
    status: 'in-development',
  },
];

export const CALCULATORS: readonly CatalogItem[] = [
  {
    title: 'Compound interest',
    path: 'calculators/compound-interest/',
    summary: 'See how a balance grows with any compounding frequency and regular contributions.',
    detail: 'Year-by-year table, contributions versus interest.',
    status: 'available',
  },
  {
    title: 'APR and APY',
    path: 'calculators/apr-apy/',
    summary: 'Convert between a stated rate and the annual percentage yield, and compare up to three accounts.',
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
