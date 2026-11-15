// Contribution frequency wording shared by the savings calculators. Presentation only; the
// calendar rules are in src/lib/engines/calendar.ts.

import type { ContributionFrequency, ContributionTiming } from '../engines/calendar';

export interface ContributionOption {
  value: ContributionFrequency;
  label: string;
  /** "a month", "every 2 weeks": how often, for sentences. */
  often: string;
  /** The interval a contribution starts or ends: "week", "2-week period". */
  interval: string;
}

export const CONTRIBUTION_OPTIONS: readonly ContributionOption[] = [
  { value: 'none', label: 'None', often: '', interval: '' },
  { value: 'weekly', label: 'Weekly', often: 'a week', interval: 'week' },
  { value: 'biweekly', label: 'Biweekly (every 2 weeks)', often: 'every 2 weeks', interval: '2-week period' },
  { value: 'monthly', label: 'Monthly', often: 'a month', interval: 'month' },
  { value: 'quarterly', label: 'Quarterly', often: 'a quarter', interval: 'quarter' },
  { value: 'annually', label: 'Annually', often: 'a year', interval: 'year' },
];

export const contributionOption = (value: ContributionFrequency): ContributionOption =>
  CONTRIBUTION_OPTIONS.find((o) => o.value === value) ?? CONTRIBUTION_OPTIONS[0]!;

/** "Added once a month, at the end of each month." */
export function contributionHint(frequency: ContributionFrequency, timing: ContributionTiming): string {
  const o = contributionOption(frequency);
  if (frequency === 'none') return 'No regular contributions.';
  const when = timing === 'start' ? 'start' : 'end';
  return `Added ${o.often === 'every 2 weeks' ? o.often : `once ${o.often}`}, at the ${when} of each ${o.interval}.`;
}
