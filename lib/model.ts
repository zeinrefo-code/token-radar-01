// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// protocol that records no token and is not itself a wrapped, staked or exchange product of one that
// trades: the full pre-token universe the snapshot supports, ranked by what a launch would be worth.
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown at the market's own values, and it is
// their trading record that calibrates the model.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple   = the category's peer multiple: the median market-cap-to-TVL ratio of the snapshot's
//                live-token protocols in the same category, winsorised to a third..three times the
//                global median, shrunk toward that median by SHRINK_K phantom peers and clamped to
//                [MULTIPLE_MIN, MULTIPLE_MAX]; a category with no live peers takes the global median
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// states the calibration table the multiples came from, so a reader can recompute any row.

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

/** The model's fixed constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_k: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_k: 5,
  multiple_min: 0.03,
  multiple_max: 2.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: how many live peers it has, their median multiple, the multiple used. */
export interface CategoryCalibration {
  category: string;
  peers: number;
  median_multiple: number | null;
  multiple: number;
}

/** The calibration the snapshot's own live-token protocols produce. */
export interface Calibration {
  global_median: number;
  peer_count: number;
  categories: CategoryCalibration[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
    category_multiple: number;
    category_median: number | null;
    category_peers: number;
    global_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
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
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, the calibration, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
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

/**
 * The calibration: for every category, the median market-cap-to-TVL ratio of the snapshot's live-token
 * protocols in it (a peer is a protocol whose record carries a market cap), shrunk toward the global
 * median by SHRINK_K phantom peers so a category with two wild peers cannot set its own price, then
 * clamped to the model's band. A category with no peers takes the global median.
 */
export function calibrate(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = categoryKey(p);
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const clampMultiple = (m: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, m));
  const categories: CategoryCalibration[] = [...ratiosByCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      // Winsorise the category median to a third..three times the global median before shrinking, so
      // one wild peer (a category with a single live token trading at 3x its TVL) cannot set a price
      // for forty protocols that have none.
      const winsorised = Math.min(globalMedian * 3, Math.max(globalMedian / 3, med));
      const shrunk = (ratios.length * winsorised + model.shrink_k * globalMedian) / (ratios.length + model.shrink_k);
      return { category, peers: ratios.length, median_multiple: round4(med), multiple: round4(clampMultiple(shrunk)) };
    })
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median: round4(globalMedian), peer_count: all.length, categories };
}

/** The multiple one protocol is scored with, from its category's calibration row. */
function multipleFor(calibration: Calibration, p: SnapshotProtocol): CategoryCalibration {
  const key = categoryKey(p);
  const row = calibration.categories.find((c) => c.category === key);
  if (row !== undefined) return row;
  return { category: key, peers: 0, median_multiple: null, multiple: calibration.global_median };
}

/** The multipliers and the implied value one protocol gets under `model` and its category multiple. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

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

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; calibration: Calibration } {
  const calibration = calibrate(snapshot.protocols, model);
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
    const cal = multipleFor(calibration, p);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, cal.multiple);
    return { p, cal, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
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
      category_multiple: s.cal.multiple,
      category_median: s.cal.median_multiple,
      category_peers: s.cal.peers,
      global_median: calibration.global_median,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, calibration };
}

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
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names:
 * the position and its second action come from the category's playbook, the gas from the first chain
 * it names, the capital from its TVL tier, the hold from its age.
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
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
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
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
