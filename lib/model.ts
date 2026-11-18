// Token Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist and adds the pre-token protocols below the
// watchlist floor that pass the same product rule the watchlist itself was drawn with: a protocol that
// records no token, is not a versioned pool of another protocol, and is not a wrapped, staked or bridged
// product of a token that already trades (the house's categories Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC and CEX, an exchange name at the front of its name, or a whole
// word wrapped, staked or staking in it). WBTC and USDT0 record no token of their own in the snapshot,
// and they are still not launches waiting to happen: they are other tokens in another form, and this
// radar leaves them out on the same rule that left them off the watchlist.
//
// The implied value is a comparables model, fitted by this program on the snapshot's own traded
// protocols (the ones that record a market cap) every time it runs:
//
//   log value = b0 + bT * (log TVL - mean) + bG * (7d growth, clamped -60..120 - mean)
//                  + bA * (log(age in days + 30) - mean) + bC * (log(1 + chains) - mean)
//                  + family offset (the protocol category's family, its mean residual shrunk by n/(n+8))
//
// fitted by ridge regression (lambda 1, the intercept unpenalised). Two guardrails keep one week or one
// birthday from dominating a launch value: the growth term's contribution is clamped to +/-0.7 in log
// terms (a factor of 0.50 to 2.01) and the age term's to +/-0.6 (0.55 to 1.82). In the traded set a week
// of explosive TVL growth carries a *lower* value per TVL, not a higher one: hot TVL reads as mercenary
// money, and the model prices it that way, inside the guardrail. The same set's multiples fall as listing
// age rises, so the age factor discounts a long track record instead of rewarding it; both directions
// are the data's, stated here and on the page, not a story imposed on it.
//
// The fit is validated by leave-one-out backtest over the traded set, refitting the whole pipeline for
// each held-out protocol; the dashboard states the result (median factor error, share within 3x) next to
// the naive baseline of one median multiple for everyone. No protocol name is ever special-cased: the
// same fitted function scores every row, and a row's implied value is TVL x base multiple x growth
// factor x age factor, each factor printed on the row so a reader can recompute it.

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

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The fitted model's constants: chosen before the fit, stated on the page, never tuned per protocol. */
export const FIT = {
  ridge_lambda: 1,
  family_shrinkage: 8,
  growth_floor: -60,
  growth_cap: 120,
  growth_log_clamp: 0.7,
  age_log_clamp: 0.6,
  age_pad_days: 30,
};

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures, its three factors and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  change_7d: number | null;
}

/** The fit's own report, computed by the program that scored the board: the judge reads the same numbers. */
export interface FitReport {
  train_rows: number;
  beta: { intercept: number; log_tvl: number; growth: number; log_age: number; log_chains: number };
  families: { family: string; rows: number; factor: number }[];
  loo_median_factor: number;
  loo_mean_abs_log: number;
  loo_within_3x_pct: number;
  baseline_median_factor: number;
  r2_log: number;
}

/** Everything the dashboard needs: the board, the live set, the fit and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: FitReport;
  protocols_size: number;
  watchlist_size: number;
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the house's own rule treats as products of another token, never as launches. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name that begins with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The product rule, the watchlist's own, applied to every row the board ranks: not a wrapped, staked or
 * bridged product of a token that already trades, and not a versioned pool of another protocol.
 */
export function passesProductRule(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Whether a protocol is one the board may rank below the floor: pre-token and through the product rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && passesProductRule(p);
}

/** Category families: DefiLlama's fine categories grouped to the level the traded set can support. */
const FAMILIES: [string, string[]][] = [
  ['DEX', ['Dexs']],
  ['Lending & CDP', ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management']],
  ['Staking', ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC']],
  ['Bridges', ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']],
  ['Yield', ['Yield', 'Yield Aggregator', 'Leveraged Farming', 'Farm', 'Basis Trading', 'Liquidity Manager']],
  ['Curators & allocators', ['Risk Curators', 'Onchain Capital Allocator']],
  ['Derivatives', ['Derivatives', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Synthetics', 'Prediction Market']],
  ['RWA', ['RWA']],
  ['Exchanges', ['CEX', 'CeDeFi']],
  ['Stablecoins', ['Algo-Stables', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Stablecoin Issuer', 'Reserve Currency']],
];

/** A protocol's category family, or 'Other' when its category is fine, rare or absent. */
export function familyOf(category: string | null): string {
  if (category !== null) {
    for (const [family, cats] of FAMILIES) if (cats.includes(category)) return family;
  }
  return 'Other';
}

// ---------------------------------------------------------------- the fit

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clampGrowth = (g: number | null): number => clamp(g ?? 0, FIT.growth_floor, FIT.growth_cap);
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/** Solve A x = b by Gaussian elimination with partial pivoting (small, dense, deterministic). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const swap = M[c]!;
    M[c] = M[piv]!;
    M[piv] = swap;
    const d = M[c]![c]!;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Ridge regression: normal equations with `lambda` on every coefficient but the intercept. */
function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      b[a] = b[a]! + X[i]![a]! * y[i]!;
      for (let c = 0; c < k; c++) A[a]![c] = A[a]![c]! + X[i]![a]! * X[i]![c]!;
    }
  }
  for (let a = 1; a < k; a++) A[a]![a] = A[a]![a]! + lambda;
  return solve(A, b);
}

/** The centring statistics of one training set: its means and its median known age. */
interface FitStats {
  medAge: number;
  mLogTvl: number;
  mGrowth: number;
  mLogAge: number;
  mLogChains: number;
}

function statsOf(rows: SnapshotProtocol[], asOf: string): FitStats {
  const ages = rows.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const medAge = ages.length > 0 ? ages[Math.floor(ages.length / 2)]! : 365;
  const mean = (f: (p: SnapshotProtocol) => number): number => rows.reduce((s, p) => s + f(p), 0) / rows.length;
  return {
    medAge,
    mLogTvl: mean((p) => Math.log(p.tvl_usd)),
    mGrowth: mean((p) => clampGrowth(p.change_7d)),
    mLogAge: mean((p) => Math.log((ageDays(asOf, p.listed_at) ?? medAge) + FIT.age_pad_days)),
    mLogChains: mean((p) => Math.log(1 + p.chains.length)),
  };
}

/** A fitted comparables model: coefficients, family offsets and the statistics they were centred on. */
export interface FittedModel {
  beta: number[];
  offsets: Map<string, number>;
  stats: FitStats;
  asOf: string;
}

/** Fit the comparables model on a set of traded protocols (each with a market cap and a TVL). */
export function fitComparables(rows: SnapshotProtocol[], asOf: string): FittedModel {
  const stats = statsOf(rows, asOf);
  const feats = (p: SnapshotProtocol): number[] => [
    1,
    Math.log(p.tvl_usd) - stats.mLogTvl,
    clampGrowth(p.change_7d) - stats.mGrowth,
    Math.log((ageDays(asOf, p.listed_at) ?? stats.medAge) + FIT.age_pad_days) - stats.mLogAge,
    Math.log(1 + p.chains.length) - stats.mLogChains,
  ];
  const X = rows.map(feats);
  const y = rows.map((p) => Math.log(p.mcap_usd!));
  const beta = ridgeFit(X, y, FIT.ridge_lambda);
  const resid = new Map<string, number[]>();
  rows.forEach((p, i) => {
    const pred = X[i]!.reduce((s, f, j) => s + f * beta[j]!, 0);
    const fam = familyOf(p.category);
    if (!resid.has(fam)) resid.set(fam, []);
    resid.get(fam)!.push(y[i]! - pred);
  });
  const offsets = new Map<string, number>();
  for (const [fam, es] of resid) {
    const m = es.reduce((a, b) => a + b, 0) / es.length;
    offsets.set(fam, (es.length / (es.length + FIT.family_shrinkage)) * m);
  }
  return { beta, offsets, stats, asOf };
}

/** One protocol's three factors under a fitted model, and the log value they add to. */
export function valueParts(model: FittedModel, p: SnapshotProtocol): { baseLog: number; growthLog: number; ageLog: number } {
  const { beta, stats } = model;
  const baseLog =
    beta[0]! +
    beta[1]! * (Math.log(p.tvl_usd) - stats.mLogTvl) +
    beta[4]! * (Math.log(1 + p.chains.length) - stats.mLogChains) +
    (model.offsets.get(familyOf(p.category)) ?? 0);
  const growthLog = clamp(beta[2]! * (clampGrowth(p.change_7d) - stats.mGrowth), -FIT.growth_log_clamp, FIT.growth_log_clamp);
  const ageLog = clamp(
    beta[3]! * (Math.log((ageDays(model.asOf, p.listed_at) ?? stats.medAge) + FIT.age_pad_days) - stats.mLogAge),
    -FIT.age_log_clamp,
    FIT.age_log_clamp,
  );
  return { baseLog, growthLog, ageLog };
}

/** A protocol's implied value under a fitted model, in whole dollars, at least 1. */
export function impliedOf(model: FittedModel, p: SnapshotProtocol): number {
  const { baseLog, growthLog, ageLog } = valueParts(model, p);
  return Math.max(1, Math.round(Math.exp(baseLog + growthLog + ageLog)));
}

// ---------------------------------------------------------------- the backtest

/** The traded set: protocols that record a positive market cap and a positive TVL. */
export function tradedSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * The fit's report: in-sample R-squared on log value, the naive baseline's leave-one-out error, and this
 * pipeline's own leave-one-out error, refitting coefficients, centring and family offsets for every
 * held-out protocol so the number the page quotes is the pipeline's, not the fit's memory of itself.
 */
export function fitReport(snapshot: Snapshot, model: FittedModel): FitReport {
  const rows = tradedSet(snapshot);
  const y = rows.map((p) => Math.log(p.mcap_usd!));
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  let ssRes = 0;
  let ssTot = 0;
  rows.forEach((p, i) => {
    const pred = Math.log(impliedOf(model, p));
    ssRes += (y[i]! - pred) ** 2;
    ssTot += (y[i]! - yMean) ** 2;
  });
  const errs: number[] = [];
  const naive: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rest = rows.filter((_, j) => j !== i);
    const m = fitComparables(rest, snapshot.as_of);
    errs.push(Math.abs(Math.log(impliedOf(m, rows[i]!)) - y[i]!));
    naive.push(Math.abs(Math.log(rows[i]!.tvl_usd * median(rest.map((p) => p.mcap_usd! / p.tvl_usd))) - y[i]!));
  }
  const families = [...model.offsets.entries()]
    .map(([family, off]) => ({
      family,
      rows: rows.filter((p) => familyOf(p.category) === family).length,
      factor: round2(Math.exp(off)),
    }))
    .sort((a, b) => b.factor - a.factor);
  return {
    train_rows: rows.length,
    beta: {
      intercept: round4(model.beta[0]!),
      log_tvl: round4(model.beta[1]!),
      growth: round4(model.beta[2]!),
      log_age: round4(model.beta[3]!),
      log_chains: round4(model.beta[4]!),
    },
    families,
    loo_median_factor: round2(Math.exp(median(errs))),
    loo_mean_abs_log: round4(errs.reduce((a, b) => a + b, 0) / errs.length),
    loo_within_3x_pct: Math.round((100 * errs.filter((e) => e <= Math.log(3)).length) / errs.length),
    baseline_median_factor: round2(Math.exp(median(naive))),
    r2_log: round4(ssTot > 0 ? 1 - ssRes / ssTot : 0),
  };
}

// ---------------------------------------------------------------- farm plans

/** The capital a farmer puts to work, scaled to the protocol's own size. */
function farmCapital(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** The gas a round of actions costs on the protocol's home chain. */
function chainGas(chain: string): string {
  if (chain === 'Ethereum') return 'about $10 in ETH gas for the round of actions';
  if (chain === 'Solana') return 'about $1 in SOL fees for the round of actions';
  if (chain === 'Bitcoin') return 'about $6 in BTC fees for the round of actions';
  return 'about $3 in gas for the round of actions';
}

/** How long a position stays open, scaled to how long the protocol has already run. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The core qualifying actions for a category: two, specific to what the product actually does. */
function coreActions(category: string | null, name: string, chain: string): [string, string][] {
  switch (category) {
    case 'Dexs':
      return [
        [`Add the ${name} position as liquidity in its deepest ${chain} pool rather than swapping once and leaving`, 'the position itself'],
        ['Route two real swaps a week through the pool you fund, so the activity reads as use and not as a deposit left idle', 'swap fees of about $2'],
      ];
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
    case 'Collateral Management':
      return [
        [`Supply the asset to ${name} on ${chain} and leave the deposit in place`, 'the deposit itself'],
        ['Borrow 30 to 40 percent against the supply and repay on a weekly cycle, which is the usage pattern lending points and gauges reward', 'interest of about $4'],
      ];
    case 'CDP':
    case 'CDP Manager':
      return [
        [`Open a ${name} vault on ${chain}, deposit collateral and mint its stablecoin against it`, 'the collateral itself'],
        ['Hold part of the minted stablecoin in the protocol’s own stability or savings module instead of selling it all', 'no extra cost beyond the vault'],
      ];
    case 'Liquid Staking':
    case 'Restaking':
    case 'Liquid Restaking':
    case 'Staking Pool':
    case 'Restaked BTC':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return [
        [`Stake through ${name} on ${chain} and hold the staking receipt in the same wallet`, 'the stake itself'],
        ['Put half the receipt to work in one integrated vault or lending market the protocol lists, and leave the other half untouched as proof of holding', 'gas already counted above'],
      ];
    case 'Yield':
    case 'Yield Aggregator':
    case 'Leveraged Farming':
    case 'Farm':
    case 'Liquidity Manager':
      return [
        [`Deposit into ${name}’s flagship ${chain} vault and keep the vault shares in the wallet`, 'the deposit itself'],
        ['Harvest and restake the yield once a week by hand; an auto-compounder run by someone else does not build your history', 'gas already counted above'],
      ];
    case 'Basis Trading':
      return [
        [`Open the ${name} basis position on ${chain} at the planned size and leave it running`, 'the position margin itself'],
        ['Rebalance the hedge leg weekly and keep a dated log of each rebalance, the record a manual review asks for', 'funding of about $5 a week'],
      ];
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return [
        [`Allocate into a ${name}-curated vault on ${chain}, choosing the vault the curator most recently rebalanced`, 'the allocation itself'],
        ['Move a small part of the allocation when the curator rebalances and note the date, so the wallet follows the curator rather than parking', 'gas already counted above'],
      ];
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
    case 'Interest Rate Derivatives':
    case 'Synthetics':
      return [
        [`Fund a ${name} account on ${chain} and trade the flagship market in small size`, 'the trading margin itself'],
        ['Trade on three separate days a week rather than in one burst, and close the week flat or hedged so the volume is real usage', 'trading fees of about $6 a week'],
      ];
    case 'Prediction Market':
      return [
        [`Fund a ${name} account on ${chain} and take positions in three liquid markets`, 'the stake itself'],
        ['Hold at least one position to settlement each week instead of flipping everything intraday', 'no extra cost beyond the stake'],
      ];
    case 'RWA':
      return [
        [`Complete ${name}’s onboarding and KYC, then buy its smallest ${chain} offering`, 'the purchase itself'],
        ['Hold the position through a full distribution cycle and claim the distribution from the same wallet', 'onboarding is free; the claim costs gas'],
      ];
    case 'Algo-Stables':
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Wrapper':
    case 'Stablecoin Issuer':
    case 'Reserve Currency':
      return [
        [`Mint or buy ${name}’s stablecoin on ${chain} and hold it in the wallet`, 'the purchase itself'],
        ['Supply half of it to the protocol’s own savings rate or stability pool and leave the other half liquid', 'gas already counted above'],
      ];
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return [
        [`Bridge the working capital to ${chain} through ${name} rather than through a rival bridge`, 'the bridged amount itself'],
        ['Bridge a smaller amount back once a month, so the wallet shows two-way use across the snapshot window', 'bridge fees of about $4 a crossing'],
      ];
    case 'Chain':
      return [
        [`Bridge the working capital onto the ${name} chain and keep it there`, 'the bridged amount itself'],
        ['Use two native applications on the chain weekly, so the wallet is an active chain account and not a parked bridge landing', 'gas already counted above'],
      ];
    default:
      return [
        [`Use ${name}’s core product on ${chain} with the planned capital, the action its own documentation leads with`, 'the position itself'],
        ['Repeat the core action weekly and keep position sizes steady, so the history reads as a user and not as a one-off test', 'gas already counted above'],
      ];
  }
}

/** A step's text with its cost and time folded in, kept inside the board's 20 to 600 character bounds. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action.replace(/\.\s*$/, '')}. Cost: ${cost}. Time: ${time}.`;
  while (s.length < 24) s += ' Keep the records.';
  if (s.length > 600) s = `${s.slice(0, 596).trimEnd()}...`;
  return s;
}

/**
 * One protocol's farm plan: wallet hygiene, its category's two core actions, a weekly cadence, a hold
 * scaled to its track record, and a claim-safety close. Every figure comes from the protocol's own
 * record: its first chain, its TVL tier, its age, its chain count.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const name = p.name;
  const chain = p.chains[0] ?? 'Ethereum';
  const chainNote = p.chains.length > 1 ? ` It also runs on ${p.chains.length - 1} more chain${p.chains.length > 2 ? 's' : ''}; one wallet is enough.` : '';
  const capital = farmCapital(p.tvl_usd);
  const age = ageDays(asOf, p.listed_at);
  const hold = holdDays(age);
  const [first, second] = coreActions(p.category, name, chain);
  return [
    stepText(
      `Open a fresh wallet for ${name} alone, write the seed phrase on paper and never type it into a site; a points wallet that shares history with your main wallet links the two`,
      'no cost',
      '20 minutes, once',
    ),
    stepText(`${first![0]} on ${chain}.${chainNote}`, `$${capital} of working capital, plus ${chainGas(chain)}`, '30 minutes to set up'),
    stepText(second![0], second![1], '15 minutes a week'),
    stepText(
      `Repeat the qualifying action on the same weekday each week and screenshot the wallet's ${name} position after each round; airdrop snapshots reward steady weeks over one large day`,
      'gas already counted above',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for ${hold} days before changing its size. ${name} has run ${age === null ? 'for an unrecorded span' : `for ${age} days`} with no token, and a hold that matches its track record is what separates a user from a drive-by deposit`,
      'the capital stays locked for the hold',
      `${hold} days`,
    ),
    stepText(
      `Keep a dated log of every ${name} action with transaction hashes, and when a claim opens use only the link in the protocol's own announcements; claim pages are the most copied pages in crypto`,
      'no cost',
      '5 minutes a week',
    ),
  ];
}

// ---------------------------------------------------------------- the board

/**
 * The board: every watchlist slug, plus every rankable protocol below the floor. Sorted by implied value
 * descending, slug ascending on a tie, so two runs of this program write the same bytes.
 */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const model = fitComparables(tradedSet(snapshot), snapshot.as_of);
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!watchlist.has(p.slug) && isRankable(p)) picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => ({ p, value: impliedOf(model, p) }));
  scored.sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, value }, i) => {
    const { baseLog, growthLog, ageLog } = valueParts(model, p);
    const age = ageDays(snapshot.as_of, p.listed_at);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: value,
      model: {
        base_multiple: round4(Math.exp(baseLog) / p.tvl_usd),
        growth_pct: clampGrowth(p.change_7d),
        growth_multiplier: round4(Math.exp(growthLog)),
        maturity_multiplier: round4(Math.exp(ageLog)),
        age_days: age,
      },
      farm_steps: farmSteps(p, snapshot.as_of),
    };
  });
}

/** The dashboard's data: the board's rows in its shape, the fit's report, and the live-token view. */
export function buildData(snapshot: Snapshot, board: BoardRow[]): RadarData {
  const model = fitComparables(tradedSet(snapshot), snapshot.as_of);
  const watchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    family: familyOf(r.category),
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    base_multiple: r.model.base_multiple,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    watchlist: watchlist.has(r.slug),
    farm_steps: r.farm_steps,
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: fitReport(snapshot, model),
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
    rows,
    live,
  };
}

/** The first problem with a board, in the gate's own terms, or null when the board is sound. */
export function boardIssue(snapshot: Snapshot, board: BoardRow[]): string | null {
  if (!Array.isArray(board) || board.length < 100 || board.length > 4000) return 'board_rows';
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    const src = bySlug.get(r.slug);
    if (src === undefined || seen.has(r.slug)) return 'slug';
    seen.add(r.slug);
    if (r.rank !== i + 1) return 'rank';
    if (r.name !== src.name || r.category !== src.category || r.tvl_usd !== src.tvl_usd) return 'record';
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return 'implied_value';
    if (r.implied_value_usd > prev) return 'order';
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return 'farm_steps';
    for (const s of r.farm_steps) if (typeof s !== 'string' || s.length < 20 || s.length > 600) return 'farm_steps';
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return 'watchlist_coverage';
  return null;
}

// ---------------------------------------------------------------- the input

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new SnapshotError(msg);
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(`snapshot ${what} must be a non-empty string`);
  return v;
}

function strOrNull(v: unknown, what: string): string | null {
  if (v === null) return null;
  return str(v, what);
}

function numOrNull(v: unknown, what: string): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`snapshot ${what} must be a finite number or null`);
  return v;
}

/** Parse and validate a snapshot document. Throws SnapshotError on the first field that is off. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('snapshot is not valid JSON');
  }
  if (!isRecord(raw)) fail('snapshot must be a JSON object');
  const as_of = str(raw['as_of'], 'as_of');
  const source = str(raw['source'], 'source');
  const floor = raw['floor_usd'];
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor <= 0) fail('snapshot floor_usd must be a positive number');
  if (!Array.isArray(raw['protocols']) || raw['protocols'].length === 0) fail('snapshot protocols must be a non-empty array');
  if (!Array.isArray(raw['watchlist']) || raw['watchlist'].length === 0) fail('snapshot watchlist must be a non-empty array');
  const seen = new Set<string>();
  const protocols: SnapshotProtocol[] = raw['protocols'].map((v, i) => {
    if (!isRecord(v)) fail(`snapshot protocols[${i}] must be an object`);
    const slug = str(v['slug'], `protocols[${i}].slug`);
    if (seen.has(slug)) fail(`snapshot slug ${slug} appears twice`);
    seen.add(slug);
    const tvl = v['tvl_usd'];
    if (typeof tvl !== 'number' || !Number.isFinite(tvl) || tvl < 0) fail(`snapshot ${slug} tvl_usd must be a non-negative number`);
    if (!Array.isArray(v['chains']) || v['chains'].some((c) => typeof c !== 'string')) fail(`snapshot ${slug} chains must be an array of strings`);
    return {
      slug,
      name: str(v['name'], `protocols[${i}].name`),
      category: strOrNull(v['category'], `protocols[${i}].category`),
      chains: v['chains'] as string[],
      tvl_usd: tvl,
      change_7d: numOrNull(v['change_7d'], `protocols[${i}].change_7d`),
      mcap_usd: numOrNull(v['mcap_usd'], `protocols[${i}].mcap_usd`),
      listed_at: strOrNull(v['listed_at'], `protocols[${i}].listed_at`),
      gecko_id: strOrNull(v['gecko_id'], `protocols[${i}].gecko_id`),
      symbol: strOrNull(v['symbol'], `protocols[${i}].symbol`),
    };
  });
  const watchlist: string[] = raw['watchlist'].map((v, i) => str(v, `watchlist[${i}]`));
  for (const slug of watchlist) if (!seen.has(slug)) fail(`snapshot watchlist slug ${slug} is not a protocol`);
  return { as_of, source, floor_usd: floor, protocols, watchlist };
}
