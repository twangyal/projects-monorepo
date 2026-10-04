export type Metric = 'revenue' | 'netIncome' | 'debt' | 'equity' | 'growthPct' | 'marginPct' | 'debtEquity';
export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
export type MoneyMetric = 'revenue' | 'netIncome' | 'debt' | 'equity';
export const NOTEBOOK_SCHEMA_VERSION = 2;
export interface Company {
  ticker: string; name: string; sector: string; currency: string; fiscalDate: string;
  revenue: number | null; priorRevenue: number | null; netIncome: number | null;
  debt: number | null; equity: number | null; filingUrl: string | null; sourceLine: number;
}
export interface Dataset {
  id: string; fileName: string; importedDate: string; basis: 'annual-12-month';
  units: 'currency-millions'; synthetic: boolean; companies: Company[];
}
export interface Filter { metric: Metric; operator: Operator; value: number; currency: string | null }
export interface Screen {
  sector: string | null; currency: string | null; filters: Filter[]; includeStale: boolean;
  sortBy: Metric | 'ticker'; direction: 'asc' | 'desc';
}
export interface ResearchNote { ticker: string; text: string }
export interface EditState { title: string; query: string; screen: Screen; watchlist: string[]; comparison: string[]; notes: ResearchNote[] }
export interface Notebook extends EditState { schemaVersion: 2; id: string; dataset: Dataset }
export interface CsvPreview { fileName: string; companies: Company[] }
export interface QueryResult { screen: Screen; interpretation: string[] }
export interface Derived { growthPct: number | null; marginPct: number | null; debtEquity: number | null }
export interface Observation { kind: 'strength' | 'risk' | 'uncertainty'; code: string; text: string; fields: (keyof Company)[] }
export interface ResearchRow { company: Company; derived: Derived; stale: boolean; observations: Observation[] }
export interface ScreenResult { rows: ResearchRow[]; excludedStale: number; excludedMissing: number }
export interface ScreenReason {
  kind: 'stale' | 'sector' | 'currency' | 'filter-currency' | 'undefined' | 'threshold';
  text: string; fields: (keyof Company)[]; filterIndex: number | null;
}
export interface ScreenDecision { row: ResearchRow; matched: boolean; reasons: ScreenReason[] }
export interface Comparison { rows: ResearchRow[]; warnings: string[]; monetaryComparable: boolean }

export const LIMITS = Object.freeze({
  companies: 500, periodsPerTicker: 5, csvBytes: 2 * 1024 * 1024, notebookBytes: 4 * 1024 * 1024,
  reportBytes: 8 * 1024 * 1024, jsonDepth: 24, tickerCharacters: 16, nameCharacters: 100,
  sectorCharacters: 60, fileNameCharacters: 120, titleCharacters: 80, amount: 1_000_000_000,
  amountDecimals: 6, queryCharacters: 500, filters: 16, watchlist: 100, comparison: 4,
  notes: 100, noteCharacters: 4000, historyStates: 30, historyBytes: 8 * 1024 * 1024,
  urlCharacters: 2048, minDate: '2000-01-01', maxDate: '2099-12-31', staleDays: 548,
});
