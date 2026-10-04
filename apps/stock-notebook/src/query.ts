import { validateDataset, validateScreen } from './validation.ts';
import { LIMITS } from './types.ts';
import type { Dataset, QueryResult, Screen, Metric, Operator, Filter } from './types.ts';

const metrics: [string, Metric][] = [['revenue growth', 'growthPct'], ['profit margin', 'marginPct'], ['debt to equity', 'debtEquity'],
  ['net income', 'netIncome'], ['revenue', 'revenue'], ['debt', 'debt'], ['equity', 'equity']];
const comparisons: [string, Operator][] = [['at least', 'gte'], ['at most', 'lte'], ['equal to', 'eq'], ['above', 'gt'], ['below', 'lt']];
const shortcuts: [string, Filter][] = [
  ['profitable', { metric: 'netIncome', operator: 'gt', value: 0, currency: null }],
  ['growing', { metric: 'growthPct', operator: 'gt', value: 0, currency: null }],
  ['low debt', { metric: 'debtEquity', operator: 'lte', value: 1, currency: null }],
  ['high margin', { metric: 'marginPct', operator: 'gte', value: 10, currency: null }],
];
const syntax = (): Error => new Error('Unsupported screening syntax. Examples: companies with profitable and revenue growth at least 10%; companies using currency USD sorted by revenue descending.');

class Parser {
  private remaining: string;
  constructor(text: string) { this.remaining = text; }
  take(pattern: RegExp): string | null {
    const match = pattern.exec(this.remaining);
    if (!match) return null;
    this.remaining = this.remaining.slice(match[0].length); return match[0];
  }
  words(words: string, leading = false): boolean {
    return this.take(new RegExp(`^${leading ? '[ \\t]+' : ''}${words.split(' ').join('[ \\t]+')}(?=$|[ \\t])`, 'i')) !== null;
  }
  space(): void { if (this.take(/^[ \t]+/) === null) throw syntax(); }
  keyword<T>(choices: [string, T][]): T {
    for (const [word, value] of choices) if (this.words(word)) return value;
    throw syntax();
  }
  currency(): string {
    const token = this.take(/^[A-Za-z]{3}(?=$|[ \t])/);
    if (token === null) throw syntax();
    return token.toUpperCase();
  }
  predicate(): Filter {
    for (const [word, filter] of shortcuts) if (this.words(word)) return { ...filter };
    const metric = this.keyword(metrics); this.space(); const operator = this.keyword(comparisons); this.space();
    const token = this.take(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?/);
    if (token === null) throw syntax();
    const value = Number(token); let currency: string | null = null;
    if (metric === 'growthPct' || metric === 'marginPct') { if (this.take(/^%/) === null) throw syntax(); }
    else if (metric !== 'debtEquity') {
      this.space(); if (!this.words('million')) throw syntax(); this.space(); currency = this.currency();
    }
    return { metric, operator, value, currency };
  }
  parse(): Screen {
    const screen: Screen = { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' };
    if (!this.remaining) return screen;
    if (!this.words('companies')) throw syntax();
    if (this.words('in', true)) {
      this.space(); const quoted = this.take(/^"(?:[^"\\]|\\["\\])*"/);
      if (quoted === null) throw syntax(); screen.sector = (JSON.parse(quoted) as string).trim();
    }
    if (this.words('using currency', true)) { this.space(); screen.currency = this.currency(); }
    if (this.words('with', true)) {
      do { this.space(); screen.filters.push(this.predicate()); if (screen.filters.length > LIMITS.filters) throw syntax(); }
      while (this.words('and', true));
    }
    if (this.words('sorted by', true)) {
      this.space(); screen.sortBy = this.keyword(metrics); this.space(); screen.direction = this.keyword([['ascending', 'asc'], ['descending', 'desc']]);
    }
    if (this.remaining) throw syntax();
    return screen;
  }
}

function interpretation(screen: Screen): string[] {
  const result = [screen.sector === null ? 'All sectors' : `Sector: ${screen.sector}`,
    screen.currency === null ? 'All declared currencies; no currency conversion' : `Currency: ${screen.currency}`];
  const name = (metric: Metric): string => metrics.find(([, key]) => key === metric)![0];
  for (const filter of screen.filters) {
    const operation = comparisons.find(([, key]) => key === filter.operator)![0];
    const suffix = filter.metric === 'growthPct' || filter.metric === 'marginPct' ? '%'
      : filter.metric === 'debtEquity' ? ' (ratio)' : ` million ${filter.currency ?? '(sign comparison across currencies)'}`;
    result.push(`${name(filter.metric)} ${operation} ${filter.value}${suffix}`);
  }
  if (!screen.filters.length) result.push('No financial thresholds');
  result.push(`Sort: ${screen.sortBy === 'ticker' ? 'ticker' : name(screen.sortBy)} ${screen.direction === 'asc' ? 'ascending' : 'descending'}`,
    'Exclude fiscal periods more than 548 days old; thresholds are screening conventions, not recommendations');
  return result;
}

/** Consume the entire controlled sentence; never salvage an unsupported prefix. */
export function parseQuery(query: string, dataset: Dataset): QueryResult {
  const data = validateDataset(dataset, LIMITS.maxDate);
  try {
    if (typeof query !== 'string' || query.length > LIMITS.queryCharacters * 2 || [...query].length > LIMITS.queryCharacters) throw syntax();
    for (const char of query) {
      const code = char.codePointAt(0)!;
      if ((code < 32 && code !== 9) || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) throw syntax();
    }
    const screen = validateScreen(new Parser(query.trim()).parse(), data);
    return { screen, interpretation: interpretation(screen) };
  } catch { throw syntax(); }
}
