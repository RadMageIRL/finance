// What Is Money?: the instruments compared and the sources behind every answer. One data
// module feeds the page (build time), the comparison panel (browser) and the tests, so the
// two views can never disagree. Facts verified from primary sources on November 15, 2026
// (local/research/m16/REPORT.md); quotations are exact.

export const REVIEWED = '2026-11-15';
export const REVIEWED_LABEL = 'November 15, 2026';

export interface Source {
  id: string;
  publisher: string;
  title: string;
  /** The document's own date, or "undated". */
  date: string;
  url: string;
}

/** In the order they are cited on the page; numbered from 1. */
export const SOURCES: readonly Source[] = [
  { id: 'fed-education-functions', publisher: 'Federal Reserve Education (Federal Reserve System)', title: 'Functions of Money', date: 'undated', url: 'https://www.federalreserveeducation.org/teaching-resources/economics/money/functions-of-money' },
  { id: 'fed-faq-legal-tender', publisher: 'Board of Governors of the Federal Reserve System', title: 'Is it legal for a business in the United States to refuse cash as a form of payment?', date: 'last updated July 21, 2020', url: 'https://www.federalreserve.gov/faqs/currency_12772.htm' },
  { id: 'fed-faq-inflation', publisher: 'Board of Governors of the Federal Reserve System', title: 'What is inflation, and how does the Federal Reserve evaluate changes in the rate of inflation?', date: 'last updated August 22, 2025', url: 'https://www.federalreserve.gov/faqs/economy_14419.htm' },
  { id: 'fra-2a', publisher: 'Board of Governors of the Federal Reserve System', title: 'Federal Reserve Act, Section 2A, Monetary policy objectives (12 U.S.C. 225a)', date: 'last updated February 13, 2017', url: 'https://www.federalreserve.gov/aboutthefed/section2a.htm' },
  { id: 'fed-money-supply', publisher: 'Board of Governors of the Federal Reserve System', title: 'What is the money supply? Is it important?', date: 'last updated July 19, 2024', url: 'https://www.federalreserve.gov/faqs/money_12845.htm' },
  { id: 'fed-money-payments', publisher: 'Board of Governors of the Federal Reserve System', title: 'Money and Payments: The U.S. Dollar in the Age of Digital Transformation', date: 'January 2022', url: 'https://www.federalreserve.gov/publications/money-and-payments-discussion-paper.htm' },
  { id: 'usc-31-5103', publisher: 'U.S. Code (govinfo, 2023 edition)', title: '31 U.S.C. 5103, Legal tender', date: '2023 edition', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title31/html/USCODE-2023-title31-subtitleIV-chap51-subchapI-sec5103.htm' },
  { id: 'usc-12-411', publisher: 'U.S. Code (govinfo, 2023 edition)', title: '12 U.S.C. 411, Issuance to reserve banks; nature of obligation; redemption', date: '2023 edition', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title12/html/USCODE-2023-title12-chap3-subchapXII-sec411.htm' },
  { id: 'fed-balance-sheet', publisher: 'Board of Governors of the Federal Reserve System', title: 'Credit and Liquidity Programs and the Balance Sheet', date: 'last updated March 7, 2024', url: 'https://www.federalreserve.gov/monetarypolicy/bst_fedsbalancesheet.htm' },
  { id: 'fed-currency-faq', publisher: 'Board of Governors of the Federal Reserve System', title: 'Is U.S. currency still backed by gold?', date: 'last updated August 2, 2013', url: 'https://www.federalreserve.gov/faqs/currency_12770.htm' },
  { id: 'fed-iorb-faq', publisher: 'Board of Governors of the Federal Reserve System', title: 'Interest on Reserve Balances (IORB) Frequently Asked Questions', date: 'last updated December 12, 2025', url: 'https://www.federalreserve.gov/monetarypolicy/iorb-faqs.htm' },
  { id: 'fed-iorb-2026-10', publisher: 'Board of Governors of the Federal Reserve System', title: 'Implementation Note issued October 28, 2026', date: 'October 28, 2026', url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a1.htm' },
  { id: 'fed-liabilities', publisher: 'Board of Governors of the Federal Reserve System', title: 'Federal Reserve liabilities', date: 'last updated November 15, 2021', url: 'https://www.federalreserve.gov/monetarypolicy/bst_frliabilities.htm' },
  { id: 'fed-account-guidelines', publisher: 'Federal Register, 87 FR 51099', title: 'Guidelines for Evaluating Account and Services Requests', date: 'August 19, 2022', url: 'https://www.govinfo.gov/content/pkg/FR-2022-08-19/html/2022-17885.htm' },
  { id: 'fed-fedwire', publisher: 'Board of Governors of the Federal Reserve System', title: 'Fedwire Funds Services', date: 'last updated June 25, 2024', url: 'https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm' },
  { id: 'fdic-faq', publisher: 'Federal Deposit Insurance Corporation', title: 'Deposit Insurance FAQs', date: 'last updated April 1, 2024', url: 'https://www.fdic.gov/resources/deposit-insurance/faq' },
  { id: 'usc-12-1821', publisher: 'U.S. Code (govinfo, 2023 edition)', title: '12 U.S.C. 1821, Insurance Funds, subsection (a)(1)(E)', date: '2023 edition', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title12/html/USCODE-2023-title12-chap16-sec1821.htm' },
  { id: 'fdic-not-insured', publisher: 'Federal Deposit Insurance Corporation', title: 'Financial Products That Are Not Insured by the FDIC', date: 'last updated May 12, 2026', url: 'https://www.fdic.gov/resources/deposit-insurance/financial-products-not-insured' },
  { id: 'fdic-crypto', publisher: 'Federal Deposit Insurance Corporation', title: 'Fact Sheet: What the Public Needs to Know About FDIC Deposit Insurance and Crypto Companies', date: 'July 28, 2022', url: 'https://www.fdic.gov/news/fact-sheets/crypto-fact-sheet-7-28-22.html' },
  { id: 'treasury-bills', publisher: 'U.S. Department of the Treasury, TreasuryDirect', title: 'Treasury Bills', date: 'undated', url: 'https://www.treasurydirect.gov/marketable-securities/treasury-bills/' },
  { id: 'treasury-marketable', publisher: 'U.S. Department of the Treasury, TreasuryDirect', title: 'Marketable Securities', date: 'undated', url: 'https://www.treasurydirect.gov/marketable-securities/' },
  { id: 'sec-mmf-2023', publisher: 'Securities and Exchange Commission, Federal Register 88 FR 51404', title: 'Money Market Fund Reforms (Release No. IC-34959), final rule', date: 'August 3, 2023', url: 'https://www.govinfo.gov/content/pkg/FR-2023-08-03/html/2023-15124.htm' },
  { id: 'genius-act', publisher: 'Public Law 119-27, 139 Stat. 419 (govinfo)', title: 'Guiding and Establishing National Innovation for U.S. Stablecoins Act (GENIUS Act)', date: 'July 18, 2025', url: 'https://www.govinfo.gov/content/pkg/PLAW-119publ27/html/PLAW-119publ27.htm' },
  { id: 'occ-genius-final', publisher: 'Office of the Comptroller of the Currency, Federal Register 91 FR 67000', title: 'Implementing the Guiding and Establishing National Innovation for U.S. Stablecoins Act for the Issuance of Stablecoins by Entities Subject to the Jurisdiction of the Office of the Comptroller of the Currency (final rule)', date: 'October 23, 2026', url: 'https://www.govinfo.gov/content/pkg/FR-2026-10-23/html/2026-21706.htm' },
  { id: 'treasury-genius-ifr', publisher: 'U.S. Department of the Treasury, Federal Register 91 FR 61688', title: 'Forms and Procedures for Review of State Certifications by the Stablecoin Certification Review Committee (interim final rule)', date: 'September 30, 2026', url: 'https://www.govinfo.gov/content/pkg/FR-2026-09-30/html/2026-19966.htm' },
  { id: 'cftc-virtual-currency', publisher: 'Commodity Futures Trading Commission', title: 'Customer Advisory: Understand the Risks of Virtual Currency Trading', date: 'first issued December 2017', url: 'https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/understand_risks_of_virtual_currency.html' },
  { id: 'irs-digital-assets', publisher: 'Internal Revenue Service', title: 'Digital assets', date: 'last reviewed September 2, 2026', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/digital-assets' },
  { id: 'usc-31-5112', publisher: 'U.S. Code (govinfo, 2023 edition)', title: '31 U.S.C. 5112, Denominations, specifications, and design of coins', date: '2023 edition', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title31/html/USCODE-2023-title31-subtitleIV-chap51-subchapII-sec5112.htm' },
  { id: 'fed-gold-faq', publisher: 'Board of Governors of the Federal Reserve System', title: 'Does the Federal Reserve own or hold gold?', date: 'last updated November 5, 2024', url: 'https://www.federalreserve.gov/faqs/does-the-federal-reserve-own-or-hold-gold.htm' },
  { id: 'treasury-gold', publisher: 'U.S. Department of the Treasury, Fiscal Data', title: 'Status Report of U.S. Government Gold Reserve', date: 'updated November 3, 2026', url: 'https://fiscaldata.treasury.gov/datasets/status-report-government-gold-reserve/' },
];

const NUMBER = new Map(SOURCES.map((s, i) => [s.id, i + 1]));

export function sourceNumber(id: string): number {
  const n = NUMBER.get(id);
  if (!n) throw new Error(`money: unknown source ${id}`);
  return n;
}

export const QUESTIONS = [
  { key: 'promise', label: 'Whose promise is it?' },
  { key: 'legal', label: 'Legal status' },
  { key: 'holders', label: 'Who can hold it?' },
  { key: 'settlement', label: 'How does a payment with it settle?' },
  { key: 'backing', label: 'Insurance or backing' },
  { key: 'price', label: 'Price against the dollar' },
] as const;

export type QuestionKey = (typeof QUESTIONS)[number]['key'];
export const ANSWER_KEYS: readonly QuestionKey[] = QUESTIONS.map((q) => q.key);

export interface Answer {
  text: string;
  /** Source ids, in the order cited. */
  sources: readonly string[];
}

export interface Instrument {
  id: string;
  name: string;
  /** One line: what it is. */
  summary: string;
  /** For the "whose promise" list: who owes the holder, or that no one does. */
  owedBy: string;
  /** No one's liability. */
  noIssuer?: boolean;
  answers: Readonly<Record<QuestionKey, Answer>>;
}

const a = (text: string, ...sources: string[]): Answer => ({ text, sources });

export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: 'cash',
    name: 'Cash',
    summary: 'Federal Reserve notes and coins: the paper money and coins in your wallet.',
    owedBy: 'The United States and the Federal Reserve',
    answers: {
      promise: a('Federal Reserve notes are by law "obligations of the United States," and the Federal Reserve lists them as a liability on its balance sheet.', 'usc-12-411', 'fed-balance-sheet'),
      legal: a('Legal tender: US coins and currency, including Federal Reserve notes, "are legal tender for all debts, public charges, taxes, and dues."', 'usc-31-5103'),
      holders: a('Anyone.'),
      settlement: a('Handing the cash over completes the payment. No bank stands between the payer and the payee.'),
      backing: a('No insurance, and no gold: the notes "are not redeemable in gold, silver, or any other commodity." The Reserve Banks must hold collateral equal in value to the notes they put into circulation, chiefly Treasury, federal agency and government-sponsored enterprise securities.', 'fed-currency-faq'),
      price: a('Always its face value in dollars: a $20 note is $20. What a dollar buys changes with prices.'),
    },
  },
  {
    id: 'deposits',
    name: 'Bank deposits',
    summary: 'The balance in a checking or savings account at a bank.',
    owedBy: 'Your bank',
    answers: {
      promise: a('A debt the bank owes you. The Federal Reserve notes that the money used in everyday digital payments is made of "liabilities of private entities, such as commercial banks."', 'fed-money-payments'),
      legal: a('Not legal tender, which the statute limits to US coins and currency. A deposit is a claim on the bank under your account agreement.', 'usc-31-5103'),
      holders: a('Anyone with an account at a bank.'),
      settlement: a('Within one bank, the bank moves the balance from one account to another. Between banks, the banks settle with each other, for example over the Federal Reserve\'s Fedwire Funds Service, whose payments are "immediate, final, and irrevocable once processed."', 'fed-fedwire'),
      backing: a('FDIC insurance at insured banks: "$250,000 per depositor, per FDIC-insured bank, per ownership category." The amount is set by statute. Balances above it are not insured.', 'fdic-faq', 'usc-12-1821'),
      price: a('A claim to a fixed number of dollars. Insurance protects it up to the standard amount; beyond that, its safety depends on the bank.', 'fdic-faq'),
    },
  },
  {
    id: 'reserves',
    name: 'Central bank reserves',
    summary: "Banks' balances in their accounts at the Federal Reserve Banks.",
    owedBy: 'The Federal Reserve (held by banks)',
    answers: {
      promise: a('"Reserve balances (or "reserves") are a liability of the Federal Reserve and an asset of the depository institutions" that hold them. "Only the Federal Reserve, as the central bank, can create reserves."', 'fed-iorb-faq'),
      legal: a('Balances in accounts at the Federal Reserve Banks, which an institution may hold only if it is eligible "under the Federal Reserve Act or other federal statute."', 'fed-account-guidelines'),
      holders: a('Banks and certain other eligible financial institutions, never households or ordinary businesses. "More than 5,000 depository institutions maintain accounts at the Federal Reserve Banks."', 'fed-account-guidelines', 'fed-liabilities'),
      settlement: a('Moved from one institution\'s Reserve Bank account to another\'s, for example over Fedwire, where a payment is final once processed. This is how banks settle payments between themselves.', 'fed-fedwire'),
      backing: a('A liability of the central bank itself, which creates them. The Federal Reserve pays interest on them at the IORB rate, 3.90 percent as of October 29, 2026.', 'fed-iorb-faq', 'fed-iorb-2026-10'),
      price: a('One dollar of reserves is always one dollar.'),
    },
  },
  {
    id: 't-bills',
    name: 'Treasury bills',
    summary: 'Short-term debt the US Treasury sells, for terms of 4 to 52 weeks.',
    owedBy: 'The US Treasury',
    answers: {
      promise: a('A debt of the US government. Treasury securities "are backed by the full faith and credit of the United States government."', 'treasury-marketable'),
      legal: a('A marketable Treasury security, sold "for terms ranging from four weeks to 52 weeks." Not legal tender.', 'treasury-bills', 'usc-31-5103'),
      holders: a('Anyone: TreasuryDirect sells bills from $100, in $100 steps.', 'treasury-bills'),
      settlement: a('A bill is not used to pay for things directly. Its holder sells it, or waits to be paid its face value at maturity, and receives dollars.', 'treasury-bills'),
      backing: a('The full faith and credit of the United States. Not covered by FDIC insurance, even when bought through a bank.', 'treasury-marketable', 'fdic-not-insured'),
      price: a('"Bills are sold at a discount or at par (face value)." "When the bill matures, you are paid its face value." The difference is the interest.', 'treasury-bills'),
    },
  },
  {
    id: 'mmf',
    name: 'Money market fund shares',
    summary: 'Shares in a fund that invests in short-term debt such as Treasury bills.',
    owedBy: 'No one owes a fixed amount: a share of the fund\'s holdings',
    answers: {
      promise: a('Not a debt: a share in an investment fund. What the share is worth depends on what the fund owns.', 'sec-mmf-2023'),
      legal: a('A security, regulated by the Securities and Exchange Commission under its money market fund rule (rule 2a-7), last overhauled in 2023.', 'sec-mmf-2023'),
      holders: a('Any investor. Funds for individuals (retail) and for institutions follow different rules.', 'sec-mmf-2023'),
      settlement: a('The holder sells (redeems) shares with the fund and is paid in dollars, usually into a bank account.'),
      backing: a('The fund\'s investments. Not FDIC insured: deposit insurance "does not apply to financial products such as stocks, bonds, money market mutual funds." Since the 2023 reforms a fund can no longer suspend redemptions, and some funds must charge a fee when redemptions are heavy.', 'fdic-crypto', 'sec-mmf-2023'),
      price: a('"Government and retail money market funds" can generally keep "a stable share price, typically $1.00." Institutional prime and institutional tax-exempt funds must use a floating share price.', 'sec-mmf-2023'),
    },
  },
  {
    id: 'stablecoins',
    name: 'Payment stablecoins',
    summary: 'Digital tokens whose issuer promises to redeem them for a fixed amount of money, such as one dollar.',
    owedBy: 'The issuer',
    answers: {
      promise: a('A liability of its issuer, who under the GENIUS Act "is obligated to convert, redeem, or repurchase" it "for a fixed amount of monetary value."', 'genius-act'),
      legal: a('Governed by the GENIUS Act (signed July 18, 2025), which takes effect on January 18, 2027. Once it does, only a "permitted payment stablecoin issuer" may issue one in the US, issuers may not market one as legal tender, and one from a permitted issuer is not a security. Rules issued so far, as of November 15, 2026: a final rule from the OCC (effective January 18, 2027) and an interim final rule from the Treasury on state certifications; the FDIC, Federal Reserve Board and NCUA rules are still proposals.', 'genius-act', 'occ-genius-final', 'treasury-genius-ifr'),
      holders: a('Anyone with a wallet or platform that supports them.'),
      settlement: a('A transfer is recorded on a "cryptographically secured distributed ledger." Getting dollars back means redeeming with the issuer, which must publish "procedures for timely redemption," or selling to someone else.', 'genius-act'),
      backing: a('Reserves of at least 1 to 1 in cash, bank deposits, Treasury bills of 93 days or less, overnight repurchase agreements and government money market funds. Not "backed by the full faith and credit of the United States" and not "subject to deposit insurance." If the issuer fails, holders\' claims "rank senior to" other creditors\'.', 'genius-act'),
      price: a('The issuer represents that it will keep "a stable value relative to the value of a fixed amount of monetary value." Holding that value depends on the issuer\'s reserves and its keeping the promise.', 'genius-act'),
    },
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin and similar crypto assets',
    summary: 'Crypto assets with no issuer, such as bitcoin, traded on a network and on platforms.',
    owedBy: 'No one',
    noIssuer: true,
    answers: {
      promise: a('No one\'s liability: no issuer promises to pay the holder anything. The CFTC notes such virtual currencies "are not currently backed nor supported by any government or central bank."', 'cftc-virtual-currency'),
      legal: a('Not legal tender in the US: the CFTC says virtual currency "does not have legal tender status." For federal tax, "digital assets are considered property, not currency." The CFTC treats bitcoin as a commodity.', 'cftc-virtual-currency', 'irs-digital-assets'),
      holders: a('Anyone with a wallet or platform that supports them.'),
      settlement: a('Transfers are recorded on the network\'s shared ledger, with no bank in between. "There is no assurance of recourse if your virtual currency is stolen."', 'cftc-virtual-currency'),
      backing: a('None. Crypto assets are not FDIC insured, and their "value is completely derived by market forces of supply and demand."', 'fdic-not-insured', 'cftc-virtual-currency'),
      price: a('Floats with the market; virtual currencies "are more volatile than traditional fiat currencies."', 'cftc-virtual-currency'),
    },
  },
  {
    id: 'gold',
    name: 'Gold',
    summary: 'The metal, as bars or coins: the classic commodity money.',
    owedBy: 'No one',
    noIssuer: true,
    answers: {
      promise: a('No one\'s liability: a physical commodity. Commodity money "had value because it was made of a substance that had value."', 'fed-education-functions'),
      legal: a('Bullion is not legal tender, and "foreign gold or silver coins are not legal tender for debts." US gold coins are legal tender at their face value ($50 for the one-ounce coin), but that is not their price: by law they are sold "at a price equal to the market value of the bullion at the time of sale, plus the cost of minting, marketing, and distributing such coins."', 'usc-31-5103', 'usc-31-5112'),
      holders: a('Anyone. The Treasury, not the Federal Reserve, holds the US government\'s gold: "The Federal Reserve does not own gold."', 'fed-gold-faq'),
      settlement: a('Paying with gold means delivering it, or transferring ownership of gold a custodian holds. In practice it is usually sold for dollars first.'),
      backing: a('None, and none needed: its value is what buyers pay for the metal. The Treasury\'s gold is carried at $42 and two-ninths (about $42.22) an ounce, "a value established by law," not a market price.', 'treasury-gold'),
      price: a('Floats with the market price of gold.'),
    },
  },
];
