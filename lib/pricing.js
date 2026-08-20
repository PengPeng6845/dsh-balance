/**
 * Price tables and cost math for dsh-usage-cost.
 *
 * Pure functions only — no harness imports. Rates are in the table's
 * native currency (USD for the builtin DeepSeek table, per the official
 * pricing page) and converted to the display currency through
 * displayValue(). All rates are per ONE MILLION tokens.
 *
 * The builtin table reflects the 2026-08-16 peak/off-peak pricing:
 * peak hours are 01:00-04:00 and 06:00-10:00 UTC (all other hours are
 * off-peak, at exactly half the peak rate). Cache WRITE is billed at the
 * cache-miss rate.
 *
 * @module dsh-usage-cost/pricing
 */

/** Currency symbols used for human-readable cost text. */
export const CURRENCY_SYMBOLS = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
};

/** Peak windows as [startHour, endHour) in UTC. */
export const DEFAULT_PEAK_WINDOWS = [
  [1, 4],
  [6, 10],
];

/**
 * Builtin default price table, in USD per 1M tokens, OFF-PEAK rates;
 * peakFactor doubles every rate inside peak windows. Sources:
 * api-docs.deepseek.com/quick_start/pricing (2026-08-16 peak/off-peak).
 *
 * A user-provided "prices" table MERGES over this one; entries not listed
 * fall back to the "*" entry.
 */
export const DEFAULT_PRICES = {
  "deepseek-v4-flash": {
    label: "deepseek-v4-flash (official)",
    inputPerMillion: 0.22,
    cacheReadPerMillion: 0.007,
    cacheWritePerMillion: 0.22,
    outputPerMillion: 0.66,
    peakFactor: 2,
  },
  "deepseek-v4-pro": {
    label: "deepseek-v4-pro (official)",
    inputPerMillion: 0.66,
    cacheReadPerMillion: 0.022,
    cacheWritePerMillion: 0.66,
    outputPerMillion: 1.98,
    peakFactor: 2,
  },
  "deepseek-chat": {
    label: "deepseek-chat (legacy table)",
    inputPerMillion: 0.28,
    cacheReadPerMillion: 0.07,
    cacheWritePerMillion: 0.28,
    outputPerMillion: 1.1,
    peakFactor: 1,
  },
  "*": {
    label: "default estimate",
    inputPerMillion: 0.22,
    cacheReadPerMillion: 0.007,
    cacheWritePerMillion: 0.22,
    outputPerMillion: 0.66,
    peakFactor: 2,
  },
};

/** The four disjoint provider usage buckets. */
export function zeroBuckets() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/** Sum one bucket set into one total-token count. */
export function totalTokens(buckets) {
  return (
    (buckets.uncachedInputTokens ?? 0) +
    (buckets.outputTokens ?? 0) +
    (buckets.cacheReadTokens ?? 0) +
    (buckets.cacheWriteTokens ?? 0)
  );
}

/** Field-wise non-negative difference: the usage gained since prev. */
export function tokenDelta(next, prev) {
  const keys = ["uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
  const delta = {};
  for (const key of keys) {
    delta[key] = Math.max(0, (next[key] ?? 0) - (prev[key] ?? 0));
  }
  return delta;
}

/**
 * Whether a timestamp falls inside one of the peak windows (UTC).
 *
 * @param at - epoch ms (defaults to now).
 * @param windows - [startHour, endHour) pairs in UTC.
 */
export function isPeak(at, windows) {
  const list = Array.isArray(windows) && windows.length > 0 ? windows : DEFAULT_PEAK_WINDOWS;
  const hour = new Date(at ?? Date.now()).getUTCHours();
  for (const w of list) {
    if (hour >= w[0] && hour < w[1]) return true;
  }
  return false;
}

/** "峰时"/"off-peak" suffix for the rate label. */
export function peakLabel(at, windows, peakFactor) {
  if (peakFactor === 1 || peakFactor === undefined) return "";
  return isPeak(at, windows) ? "（峰时）" : "（谷时）";
}

/**
 * Resolve the price entry for one call.
 *
 * Lookup order: exact model id, then provider route, then the "*" entry,
 * then the builtin "*" fallback so an unknown route still gets an estimate.
 *
 * @param prices - user-configured table (already schema-resolved).
 * @param provider - provider route from the calling agent.
 * @param model - model id from the calling agent.
 * @returns the rate entry plus the key that matched.
 */
export function resolveRate(prices, provider, model) {
  const table = prices && typeof prices === "object" ? prices : {};
  for (const key of [model, provider, "*"]) {
    if (key && table[key]) {
      return { key, ...table[key] };
    }
  }
  return { key: "*", ...DEFAULT_PRICES["*"] };
}

/**
 * Price one bucket set under one rate entry at one moment.
 *
 * Peak windows double every rate (peakFactor); cache write rides the
 * miss rate. Costs come back in the TABLE currency.
 *
 * @param buckets - token buckets.
 * @param rate - resolved rate entry.
 * @param at - epoch ms deciding the peak factor (defaults to now).
 * @returns per-bucket cost plus totalCost, in the table currency.
 */
export function computeCost(buckets, rate, at) {
  const factor =
    isPeak(at, rate.peakWindows) ? rate.peakFactor ?? 1 : 1;
  const inputCost = (buckets.uncachedInputTokens ?? 0) * (rate.inputPerMillion ?? 0) / 1e6 * factor;
  const outputCost = (buckets.outputTokens ?? 0) * (rate.outputPerMillion ?? 0) / 1e6 * factor;
  const cacheReadCost = (buckets.cacheReadTokens ?? 0) * (rate.cacheReadPerMillion ?? 0) / 1e6 * factor;
  const cacheWriteCost = (buckets.cacheWriteTokens ?? 0) * (rate.cacheWritePerMillion ?? 0) / 1e6 * factor;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

/**
 * Convert a table-currency amount into the display currency.
 *
 * @param value - amount in the table currency.
 * @param currency - display currency code.
 * @param fxRate - table currency per one display unit (CNY per USD).
 */
export function displayValue(value, currency, fxRate) {
  if (currency === "CNY") return value * (Number(fxRate) || 7.2);
  return value;
}

/** Round money to 4 decimal places (0.0001 of a currency unit). */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

/** "¥0.1234"-style cost text. */
export function moneyText(value, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  return symbol + roundMoney(value).toFixed(4);
}

/** "1.23M" / "456.7k" / "89"-style token text. */
export function formatTokens(value) {
  const n = value ?? 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
