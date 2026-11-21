// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// protocol that records no token and is not itself a wrapped, staked or exchange product of one that
// trades: the full pre-token universe the snapshot supports, ranked by what a launch would be worth.
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown at the market's own values.
//
// Model radar-3 prices a launch by FITTING the snapshot's own live-token record, not by asserting a
// multiple. The fit pool is every protocol that records a market cap above zero and a listing date.
// On that pool the model regresses log market cap on four terms, each one a figure the snapshot
// itself carries:
//
//   log value = intercept
//             + b_tvl    x (log TVL - the pool's centre log TVL)
//             + b_growth x clamp(7-day TVL change, -60%, +30%) as a fraction
//             + b_age    x min(days since listing, 1095) / 1095
//             + b_chains x log(1 + chains)
//             + the category's own adjustment
//
// The category adjustment is the category's mean residual after the four terms, shrunk toward zero
// by SHRINK_K phantom peers and clamped to a quarter..four times, so a category with two wild peers
// cannot set its own price; a category with no fit peers takes no adjustment. The growth clamp is the
// range the live peers themselves span (their own extremes are about -40% and +27%): a protocol whose
// TVL moved further in a week is scored at the clamp and flagged on the integrity strip instead.
// A protocol with no recorded listing date is scored at the fit pool's median age.
//
// The fit is not taken on trust: the same pipeline is refitted on one half of the pool and tested on
// the other half, twice, on two different splits, and the held-out misses are published in the
// dashboard next to the same exercise for the previous model (radar-2's category-median multiples).
// Every coefficient the dashboard prints is the coefficient the board was priced with: the page
// recomputes each row from the printed fit and checks it against board.json.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed constants: feature clamps and shrinkage, as the dashboard states them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  age_cap_days: number;
  shrink_k: number;
  category_clamp: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -60,
  growth_cap: 30,
  age_cap_days: 1095,
  shrink_k: 6,
  category_clamp: 4,
  multiple_min: 0.01,
  multiple_max: 12,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's fitted adjustment: how many fit peers it has, their raw median multiple, the adjustment used. */
export interface CategoryFit {
  category: string;
  peers: number;
  median_multiple: number | null;
  adjustment: number;
}

/** The fitted model: coefficients priced with, the pool they came from, and the category table. */
export interface FittedModel {
  peers: number;
  center_log_tvl: number;
  intercept: number;
  log_tvl: number;
  growth: number;
  age: number;
  chains: number;
  median_age_days: number;
  global_median_multiple: number;
  categories: CategoryFit[];
}

/** One held-out exercise: a pipeline fitted on one half of the pool and tested on the other. */
export interface ValidationSplit {
  name: string;
  half_a: number;
  half_b: number;
  fitted_median_miss: number;
  fitted_within_2x_pct: number;
  baseline_median_miss: number;
  baseline_within_2x_pct: number;
}

/** The published validation: two splits, both directions, pooled, plus the final fit's in-sample miss. */
export interface Validation {
  pool: number;
  splits: ValidationSplit[];
  fitted_median_miss: number;
  fitted_within_2x_pct: number;
  baseline_median_miss: number;
  baseline_within_2x_pct: number;
  insample_median_miss: number;
}

/** How many protocols in a set record a token, and how many the set holds. */
export interface RecordStat {
  with_token: number;
  total: number;
}

/** One TVL band's token record. */
export interface BandRecord extends RecordStat {
  band: string;
  min_tvl: number;
}

/** One category's token record. */
export interface CategoryRecord extends RecordStat {
  category: string;
}

/** The peers' record: how often protocols like these record a token, by category and by TVL band. */
export interface RecordTables {
  overall: RecordStat;
  by_band: BandRecord[];
  by_category: CategoryRecord[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** What one protocol's farm plan ties up and burns, in whole dollars, from the plan's own figures. */
export interface PlanCost {
  capital_usd: number;
  gas_usd: number;
  total_usd: number;
  transactions: number;
}

/** The farm verdict codes the dashboard renders: a uniform rule over claim, plan cost and flags. */
export type Verdict = 'farm-first' | 'farm' | 'small' | 'watch';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    predicted_multiple: number;
    category_adjustment: number;
    category_peers: number;
    growth_pct: number;
    age_days_used: number;
  };
  flags: string[];
  plan_cost_usd: number;
  verdict: Verdict;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  predicted_multiple: number;
  category_adjustment: number;
  category_peers: number;
  flags: string[];
  plan_cost_usd: number;
  verdict: Verdict;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Headline figures the dashboard's summary strip shows. */
export interface RadarStats {
  total_tvl_usd: number;
  total_implied_usd: number;
  median_implied_usd: number;
  top_gainer_slug: string | null;
  top_gainer_change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit, its validation, and the record. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FittedModel;
  validation: Validation;
  records: RecordTables;
  stats: RadarStats;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The median of a non-empty list, taken the plain way so two runs agree byte for byte. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category key a protocol calibrates under: its own category, or one shared key when it has none. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorised';
}

/** FNV-1a over the slug: the deterministic coin the validation splits flip. */
function fnv1a(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The fit pool: protocols whose record carries a market cap above zero and a listing date, in slug
 * order. A recorded zero market cap is a dead token, not a price, and a peer with no date cannot
 * carry the age term; both are left out of the fit and the dashboard says so.
 */
export function fitPool(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && ageDays(snapshot.as_of, p.listed_at) !== null)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The four fitted features of one protocol, exactly as the dashboard recomputes them. */
export function featuresOf(p: SnapshotProtocol, asOf: string, medianAgeDays: number): [number, number, number, number] {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0)));
  return [
    Math.log(p.tvl_usd),
    growthPct / 100,
    Math.min(age ?? medianAgeDays, MODEL.age_cap_days) / MODEL.age_cap_days,
    Math.log(1 + p.chains.length),
  ];
}

/** Ordinary least squares by the normal equations, solved by Gauss-Jordan with partial pivoting. */
function ols(x: number[][], y: number[]): number[] {
  const n = x[0]!.length;
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < n; j++) {
      b[j]! += x[i]![j]! * y[i]!;
      for (let k = 0; k < n; k++) a[j]![k]! += x[i]![j]! * x[i]![k]!;
    }
  }
  for (let j = 0; j < n; j++) a[j]![j]! += 1e-9;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    const rowSwap = a[c]!; a[c] = a[piv]!; a[piv] = rowSwap;
    const bSwap = b[c]!; b[c] = b[piv]!; b[piv] = bSwap;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < n; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  return b.map((v, i) => v / a[i]![i]!);
}

/**
 * Fit the model on a pool of live-token peers: the four terms by least squares on log market cap,
 * then each category's adjustment from its peers' mean residual, shrunk toward zero by SHRINK_K
 * phantom peers and clamped to a quarter..four times. Coefficients are rounded to six decimals
 * before any prediction is made with them, so the dashboard's printed fit is the board's fit.
 */
export function fitModel(pool: SnapshotProtocol[], asOf: string): FittedModel {
  const ages = pool.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) : 365;
  const center = pool.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / pool.length;
  const x = pool.map((p) => {
    const f = featuresOf(p, asOf, medianAge);
    return [1, f[0] - center, f[1], f[2], f[3]];
  });
  const y = pool.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(x, y).map(round6);
  const residuals = pool.map((p, i) => y[i]! - x[i]!.reduce((s, v, j) => s + v * beta[j]!, 0));
  const byCategory = new Map<string, { residuals: number[]; ratios: number[] }>();
  pool.forEach((p, i) => {
    const key = categoryKey(p);
    const entry = byCategory.get(key) ?? { residuals: [], ratios: [] };
    entry.residuals.push(residuals[i]!);
    entry.ratios.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, entry);
  });
  const clampLog = Math.log(MODEL.category_clamp);
  const categories: CategoryFit[] = [...byCategory.entries()]
    .map(([category, entry]) => {
      const mean = entry.residuals.reduce((s, v) => s + v, 0) / entry.residuals.length;
      const shrunk = mean * (entry.residuals.length / (entry.residuals.length + MODEL.shrink_k));
      const clamped = Math.max(-clampLog, Math.min(clampLog, shrunk));
      return { category, peers: entry.residuals.length, median_multiple: round4(median(entry.ratios)), adjustment: round4(Math.exp(clamped)) };
    })
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    peers: pool.length,
    center_log_tvl: round6(center),
    intercept: beta[0]!,
    log_tvl: beta[1]!,
    growth: beta[2]!,
    age: beta[3]!,
    chains: beta[4]!,
    median_age_days: medianAge,
    global_median_multiple: round4(median(pool.map((p) => p.mcap_usd! / p.tvl_usd))),
    categories,
  };
}

/** A category's fitted adjustment (a multiplier), or 1 when the category has no fit peers. */
export function adjustmentFor(fit: FittedModel, p: SnapshotProtocol): CategoryFit {
  const key = categoryKey(p);
  const row = fit.categories.find((c) => c.category === key);
  if (row !== undefined) return row;
  return { category: key, peers: 0, median_multiple: null, adjustment: 1 };
}

/** The model's predicted log market cap for one protocol under a fit. */
export function predictLog(fit: FittedModel, p: SnapshotProtocol, asOf: string): number {
  const f = featuresOf(p, asOf, fit.median_age_days);
  const adj = adjustmentFor(fit, p);
  return (
    fit.intercept +
    fit.log_tvl * (f[0] - fit.center_log_tvl) +
    fit.growth * f[1] +
    fit.age * f[2] +
    fit.chains * f[3] +
    Math.log(adj.adjustment)
  );
}

/** The implied value and its pieces for one protocol under a fit. */
export function impliedValue(
  fit: FittedModel,
  protocol: SnapshotProtocol,
  asOf: string,
): { implied: number; multiple: number; growthPct: number; ageUsed: number; adjustment: number; peers: number } {
  const adj = adjustmentFor(fit, protocol);
  const rawMultiple = Math.exp(predictLog(fit, protocol, asOf)) / protocol.tvl_usd;
  const multiple = Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, rawMultiple));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple));
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(protocol.change_7d, 0)));
  const age = ageDays(asOf, protocol.listed_at);
  return { implied, multiple: round4(multiple), growthPct, ageUsed: age ?? fit.median_age_days, adjustment: adj.adjustment, peers: adj.peers };
}

// ---------- the radar-2 baseline, kept only so the validation can race the two models ----------

/** radar-2's calibration on a training pool: category median multiples, winsorised and shrunk. */
function baselineMultiples(train: SnapshotProtocol[]): { global: number; byCategory: Map<string, number> } {
  const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const key = categoryKey(p);
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const byCategory = new Map<string, number>();
  for (const [category, list] of byCat) {
    const winsorised = Math.min(global * 3, Math.max(global / 3, median(list)));
    const shrunk = (list.length * winsorised + 5 * global) / (list.length + 5);
    byCategory.set(category, Math.min(2.5, Math.max(0.03, shrunk)));
  }
  return { global, byCategory };
}

/** radar-2's prediction for one protocol: TVL x category median multiple x growth x maturity. */
function baselinePredict(cal: { global: number; byCategory: Map<string, number> }, p: SnapshotProtocol, asOf: string): number {
  const multiple = cal.byCategory.get(categoryKey(p)) ?? cal.global;
  const growthPct = Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const maturityMult = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
  return Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
}

/** Held-out summary of a predictor over a test set: median multiplicative miss and the within-2x share. */
function heldOut(predict: (p: SnapshotProtocol) => number, test: SnapshotProtocol[]): { medianMiss: number; within2x: number } {
  const errors = test.map((p) => Math.abs(Math.log(predict(p) / p.mcap_usd!))).sort((a, b) => a - b);
  const mid = Math.floor(errors.length / 2);
  const medianError = errors.length % 2 === 1 ? errors[mid]! : (errors[mid - 1]! + errors[mid]!) / 2;
  const within = test.filter((p) => {
    const r = predict(p) / p.mcap_usd!;
    return r >= 0.5 && r <= 2;
  }).length;
  return { medianMiss: Math.exp(medianError), within2x: (within / test.length) * 100 };
}

/**
 * The published validation. The fit pool is split in two twice — once on bit 0 of each slug's FNV-1a
 * hash, once on bit 8 — and on each split the fitted pipeline and the radar-2 baseline are each
 * trained on one half and tested on the other, in both directions. Every number the dashboard
 * prints comes out of this function on the sealed snapshot; nothing is asserted by hand.
 */
export function validate(pool: SnapshotProtocol[], asOf: string, finalFit: FittedModel): Validation {
  const splits: ValidationSplit[] = [];
  const fittedErrors: number[] = [];
  const baselineErrors: number[] = [];
  let fittedWithin = 0;
  let baselineWithin = 0;
  let tested = 0;
  for (const bit of [0, 8]) {
    const a = pool.filter((p) => ((fnv1a(p.slug) >> bit) & 1) === 0);
    const b = pool.filter((p) => ((fnv1a(p.slug) >> bit) & 1) === 1);
    let fMiss = 0;
    let bMiss = 0;
    let fWithin = 0;
    let bWithin = 0;
    for (const [train, test] of [[a, b], [b, a]] as const) {
      const fit = fitModel(train, asOf);
      const cal = baselineMultiples(train);
      const f = heldOut((p) => Math.exp(predictLog(fit, p, asOf)), test);
      const bl = heldOut((p) => baselinePredict(cal, p, asOf), test);
      fMiss += f.medianMiss;
      bMiss += bl.medianMiss;
      fWithin += f.within2x;
      bWithin += bl.within2x;
      for (const p of test) {
        fittedErrors.push(Math.abs(Math.log(Math.exp(predictLog(fit, p, asOf)) / p.mcap_usd!)));
        baselineErrors.push(Math.abs(Math.log(baselinePredict(cal, p, asOf) / p.mcap_usd!)));
        const rf = Math.exp(predictLog(fit, p, asOf)) / p.mcap_usd!;
        if (rf >= 0.5 && rf <= 2) fittedWithin++;
        const rb = baselinePredict(cal, p, asOf) / p.mcap_usd!;
        if (rb >= 0.5 && rb <= 2) baselineWithin++;
        tested++;
      }
    }
    splits.push({
      name: `Split ${bit === 0 ? 'A' : 'B'}`,
      half_a: a.length,
      half_b: b.length,
      fitted_median_miss: round4(fMiss / 2),
      fitted_within_2x_pct: Math.round(fWithin / 2),
      baseline_median_miss: round4(bMiss / 2),
      baseline_within_2x_pct: Math.round(bWithin / 2),
    });
  }
  const pooled = (errors: number[]): number => {
    const sorted = [...errors].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return Math.exp(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  };
  const insample = heldOut((p) => Math.exp(predictLog(finalFit, p, asOf)), pool);
  return {
    pool: pool.length,
    splits,
    fitted_median_miss: round4(pooled(fittedErrors)),
    fitted_within_2x_pct: Math.round((fittedWithin / tested) * 100),
    baseline_median_miss: round4(pooled(baselineErrors)),
    baseline_within_2x_pct: Math.round((baselineWithin / tested) * 100),
    insample_median_miss: round4(insample.medianMiss),
  };
}

// ---------- the peers' record: how often protocols like these record a token ----------

/** Whether a protocol's record carries a token: a CoinGecko id or a symbol. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** The TVL bands the record is cut by. */
export const BANDS: { band: string; min_tvl: number }[] = [
  { band: '$5M-$50M', min_tvl: 5_000_000 },
  { band: '$50M-$250M', min_tvl: 50_000_000 },
  { band: '$250M-$1B', min_tvl: 250_000_000 },
  { band: '$1B and up', min_tvl: 1_000_000_000 },
];

/** The band a TVL falls in: the last band whose floor it clears. */
export function bandOf(tvl: number): BandRecord & { index: number } {
  let index = 0;
  for (let i = 0; i < BANDS.length; i++) if (tvl >= BANDS[i]!.min_tvl) index = i;
  return { ...BANDS[index]!, index, with_token: 0, total: 0 };
}

/** The record tables over the whole snapshot: overall, by TVL band, and by category. */
export function recordTables(snapshot: Snapshot): RecordTables {
  const byBand: BandRecord[] = BANDS.map((b) => ({ ...b, with_token: 0, total: 0 }));
  const byCat = new Map<string, CategoryRecord>();
  let withToken = 0;
  for (const p of snapshot.protocols) {
    const tok = recordsToken(p);
    if (tok) withToken++;
    const band = byBand[bandOf(p.tvl_usd).index]!;
    band.total++;
    if (tok) band.with_token++;
    const key = categoryKey(p);
    const entry = byCat.get(key) ?? { category: key, with_token: 0, total: 0 };
    entry.total++;
    if (tok) entry.with_token++;
    byCat.set(key, entry);
  }
  return {
    overall: { with_token: withToken, total: snapshot.protocols.length },
    by_band: byBand,
    by_category: [...byCat.values()].sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1)),
  };
}

// ---------- the integrity strip: what in a protocol's own record should make a reader careful ----------

/**
 * The flags one protocol's record raises, as codes the dashboard words:
 * sharp-move (the week's TVL change runs past the range the fit was trained on), no-7d (no seven-day
 * figure recorded), no-date (no listing date: the age term is the pool's median), no-category,
 * one-chain (the whole record sits on a single chain), thin-peers (its category's adjustment rests
 * on fewer than three fit peers).
 */
export function flagsFor(p: SnapshotProtocol, fit: FittedModel, asOf: string): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('no-7d');
  else if (Math.abs(p.change_7d) > MODEL.growth_cap) flags.push('sharp-move');
  if (ageDays(asOf, p.listed_at) === null) flags.push('no-date');
  if (p.category === null) flags.push('no-category');
  if (p.chains.length <= 1) flags.push('one-chain');
  if (adjustmentFor(fit, p).peers < 3) flags.push('thin-peers');
  return flags;
}

// ---------- the board: who is ranked ----------

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that itself says the protocol is a wrapped or staked product of another asset. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are products of another protocol or an exchange, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped, staked,
 * bridged or exchange product of one that trades — the same tests the snapshot's watchlist applies,
 * carried to the whole pre-token universe.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_NAME.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

// ---------- farm plans: steps, their cost, and the verdict on the plan ----------

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs in gas on a chain, in dollars, from a small stated table. */
function gasFor(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 12;
    case 'Solana':
      return 0.25;
    case 'Base':
    case 'Arbitrum':
    case 'Optimism':
    case 'Linea':
    case 'Scroll':
    case 'zkSync Era':
      return 0.8;
    case 'BSC':
      return 0.4;
    case 'Polygon':
      return 0.3;
    case 'Avalanche':
      return 0.9;
    default:
      return 2;
  }
}

/** The gas asset a chain's fees are paid in, for the funding step. */
function gasAssetFor(chain: string): string {
  switch (chain) {
    case 'Solana':
      return 'SOL';
    case 'BSC':
      return 'BNB';
    case 'Polygon':
      return 'POL';
    case 'Avalanche':
      return 'AVAX';
    default:
      return 'ETH';
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family's two moves: the position to open, then the second action that deepens it. */
function playbookFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') && !c.includes('uncollateralized'))
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and leave the deposit open.`,
      `Borrow about a quarter of the deposit back, hold it a few days, then repay in full: activity on both sides of the market is what lending farms count.`,
    ];
  if (c.includes('cdp') || c.includes('collateral'))
    return [
      `Deposit $${capital} of collateral into ${name} on ${chain} and mint its stablecoin against the position.`,
      `Hold the minted stablecoin in the protocol's own pool or a second vault, and repay a slice of the debt once a month so the position shows a full life cycle.`,
    ];
  if (c.includes('dex'))
    return [
      `Provide $${capital} of liquidity to ${name}'s main USDC pool on ${chain} and keep the LP position open.`,
      `Route two or three small swaps a week through ${name} itself rather than an aggregator, so the volume lands on the protocol you are farming.`,
    ];
  if (c.includes('curator') || c.includes('allocator'))
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`,
      `Open the curator's own allocation page once a week and, when a second vault in the same strategy opens, split the position across both: two vaults, two records.`,
    ];
  if (c.includes('rwa'))
    return [
      `Complete ${name}'s onboarding checks, then mint $${capital} of its yield asset on ${chain} and hold it.`,
      `Hold through one full distribution cycle before redeeming anything: RWA farms are scored on time in the asset, not on transaction count.`,
    ];
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options'))
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, long and short the same size.`,
      `Close and reopen a small position once a week: steady volume across several snapshots counts for more than one large trade.`,
    ];
  if (c.includes('basis'))
    return [
      `Fund ${name}'s basis vault with $${capital} on ${chain} and keep the shares.`,
      `Check the vault's funding page weekly and stay in through at least two funding cycles; leaving mid-cycle is what the strategy charges for.`,
    ];
  if (c.includes('bridge'))
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in an app on the far side.`,
      `Bridge a smaller amount back on a different day each week: round trips on separate days read as real use, not as one transfer split up.`,
    ];
  if (c.includes('staking') || c.includes('restak'))
    return [
      `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the farming wallet.`,
      `Leave the position untouched through one full unstaking-queue cycle before changing it: staking farms reward time staked above all.`,
    ];
  if (c.includes('chain'))
    return [
      `Bridge $${capital} onto ${name} and hold the balance in the farming wallet.`,
      `Make two or three small transactions a week in the chain's own apps, a swap and a lend, so the wallet reads as a resident, not a passer-by.`,
    ];
  if (c.includes('yield') || c.includes('farm') || c.includes('index'))
    return [
      `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the shares.`,
      `Claim the vault's rewards once a month and put them back in the same vault: the record shows a farmer who stays, not one who strips yield.`,
    ];
  if (c.includes('insurance'))
    return [
      `Put $${capital} into ${name}'s underwriting pool on ${chain}, or buy that much cover from it, and keep the position open.`,
      `Renew or extend the position before it lapses: an unbroken cover or staking record is the history this category counts.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund ${name} with $${capital} and place one position in a market you have a view on.`,
      `Trade a second, smaller market each week and settle every position at expiry: settled history counts, abandoned tickets do not.`,
    ];
  if (c.includes('payment'))
    return [
      `Fund a ${name} account or wallet with $${capital} on ${chain}.`,
      `Route two or three real payments a week through it, varied amounts on varied days, the pattern a payment farm is scored on.`,
    ];
  if (c.includes('stable') || c.includes('wrapper'))
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`,
      `Keep the balance unbroken for the hold period and add a small top-up monthly: stable farms count balance-days, not transactions.`,
    ];
  if (c.includes('privacy'))
    return [
      `Deposit $${capital} into ${name}'s shielded pool on ${chain} from the farming wallet.`,
      `Make one shielded transfer a week between your own wallets and keep the notes recorded in your farm log.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Make one more qualifying action the app offers, a second deposit, a borrow or a swap, so the wallet's record is more than a single touch.`,
  ];
}

/**
 * A protocol's farm plan: seven or eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names: the position and its second action come from the category's playbook, the gas from
 * the first chain it names, the capital from its TVL tier, the hold from its age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [open, deepen] = playbookFor(p, capital, chain);
  const gasText = gas < 1 ? `about $${gas.toFixed(2)}` : `about $${Math.round(gas)}`;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with ${gasAssetFor(chain)} for gas on ${chain}.`,
      cost: `${gasText} of gas per transaction on ${chain}`,
      time: '10 minutes',
    },
    { text: open, cost: `$${capital} of capital and ${gasText} of gas`, time: '15 minutes to set up' },
    { text: deepen, cost: `${gasText} of gas each time`, time: '10 minutes' },
    {
      text: `Repeat one qualifying action every week, on the same weekday, so the record spans several weekly snapshots.`,
      cost: `${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days before withdrawing anything.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (p.chains.length > 1) {
    steps.push({
      text: `${p.name} also runs on ${p.chains.slice(1, 3).join(' and ')}: one small position there doubles the surfaces the farm is read on.`,
      cost: `$25 of capital and that chain's gas`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps.slice(0, 8);
}

/**
 * What a protocol's plan costs, counted from the plan's own steps: the capital it ties up plus the
 * gas it burns — one funding transaction, one to open, one deepening a month, one qualifying action
 * a week across the hold, and a second small position when the protocol runs on more than one chain.
 */
export function planCost(p: SnapshotProtocol, age: number | null): PlanCost {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const months = Math.ceil(hold / 30);
  let transactions = 2 + months + weeks;
  let gasUsd = gas * transactions;
  let capital = capitalFor(p);
  if (p.chains.length > 1) {
    capital += 25;
    gasUsd += gasFor(p.chains[1]!);
    transactions += 1;
  }
  const gasRounded = Math.round(gasUsd);
  return { capital_usd: capital, gas_usd: gasRounded, total_usd: capital + gasRounded, transactions };
}

/**
 * The verdict on a plan, one uniform rule over the model's claim and the record's integrity flags
 * (the plan's all-in cost is printed beside the verdict, and every plan on the board costs between
 * $52 and $282, so cost alone cannot separate them): a claim of $20M or more on a record with at
 * most one flag is a farm-first; $7.5M or more with at most two flags is a farm; $2.5M or more
 * earns a small farm only; anything below that, or a record with three or more flags whatever the
 * claim, is a watch.
 */
export function verdictFor(implied: number, planTotalUsd: number, flagCount: number): Verdict {
  void planTotalUsd;
  if (flagCount >= 3) return 'watch';
  if (implied >= 20_000_000 && flagCount <= 1) return 'farm-first';
  if (implied >= 7_500_000 && flagCount <= 2) return 'farm';
  if (implied >= 2_500_000) return 'small';
  return 'watch';
}

// ---------- assembling the board and the dashboard's data ----------

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n, priced by the fitted model. */
export function buildBoard(snapshot: Snapshot, fit: FittedModel): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, even one the rankable tests would leave out.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The rest of the pre-token universe the tests admit, at any TVL: the radar's whole field.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { implied, multiple, growthPct, ageUsed, adjustment, peers } = impliedValue(fit, p, snapshot.as_of);
    const flags = flagsFor(p, fit, snapshot.as_of);
    const cost = planCost(p, age);
    return { p, age, implied, multiple, growthPct, ageUsed, adjustment, peers, flags, cost };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      predicted_multiple: s.multiple,
      category_adjustment: s.adjustment,
      category_peers: s.peers,
      growth_pct: s.growthPct,
      age_days_used: s.ageUsed,
    },
    flags: s.flags,
    plan_cost_usd: s.cost.total_usd,
    verdict: verdictFor(s.implied, s.cost.total_usd, s.flags.length),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    predicted_multiple: row.model.predicted_multiple,
    category_adjustment: row.model.category_adjustment,
    category_peers: row.model.category_peers,
    flags: row.flags,
    plan_cost_usd: row.plan_cost_usd,
    verdict: row.verdict,
  };
}

/** The headline figures: totals over the ranked board and its fastest riser. */
function radarStats(board: BoardRow[]): RadarStats {
  const totalTvl = board.reduce((sum, r) => sum + r.tvl_usd, 0);
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const medianImplied = impliedSorted.length > 0 ? impliedSorted[Math.floor(impliedSorted.length / 2)]! : 0;
  let top: BoardRow | null = null;
  for (const r of board) {
    if (r.change_7d !== null && (top === null || r.change_7d > (top.change_7d ?? 0))) top = r;
  }
  return {
    total_tvl_usd: totalTvl,
    total_implied_usd: totalImplied,
    median_implied_usd: medianImplied,
    top_gainer_slug: top?.slug ?? null,
    top_gainer_change_7d: top?.change_7d ?? null,
  };
}

/** Everything the dashboard renders, from the snapshot: fit, validation, record, board, live set. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const pool = fitPool(snapshot);
  const fit = fitModel(pool, snapshot.as_of);
  const validation = validate(pool, snapshot.as_of, fit);
  const records = recordTables(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    fit,
    validation,
    records,
    stats: radarStats(board),
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows: the gate asks for at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}, past the gate's cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
