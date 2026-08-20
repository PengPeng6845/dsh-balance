/**
 * Price tables and cost math for dsh-usage-cost.
 *
 * Pure functions only — no harness imports, so the same module can be
 * reused by a Client widget later. All rates are per ONE MILLION tokens
 * in the configured currency.
 *
 * @module @deepseek-ai/dsh-usage-cost/pricing
 */

/** Currency symbols used for human-readable cost text. */
export const CURRENCY_SYMBOLS = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
};

/**
 * Builtin default price table, in CNY per 1M tokens.
 *
 * DeepSeek official list prices at the time of writing:
 * - deepseek-chat:     input ¥2 (cache miss) / ¥0.5 (cache hit), output ¥8
 * - deepseek-reasoner: input ¥4 (cache miss) / ¥1 (cache hit), output ¥16
 *
 * DeepSeek bills cache-WRITE tokens at the cache-miss input rate, which is
 * why cacheWritePerMillion mirrors inputPerMillion below. All values are
 * overridable through the plugin config; a user-provided "prices" table
 * REPLACES this one, and entries not listed fall back to the "*" entry.
 */
export const DEFAULT_PRICES = {
  "deepseek-chat": {
    label: "deepseek-chat (official)",
    inputPerMillion: 2,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 2,
    outputPerMillion: 8,
  },
  "deepseek-reasoner": {
    label: "deepseek-reasoner (official)",
    inputPerMillion: 4,
    cacheReadPerMillion: 1,
    cacheWritePerMillion: 4,
    outputPerMillion: 16,
  },
  "*": {
    label: "default estimate",
    inputPerMillion: 2,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 2,
    outputPerMillion: 8,
  },
};

/** The four disjoint provider usage buckets, all zero. */
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
 * Price one bucket set under one rate entry.
 *
 * @param buckets - token buckets.
 * @param rate - resolved rate entry.
 * @returns per-bucket cost plus totalCost, all in the configured currency.
 */
export function computeCost(buckets, rate) {
  const inputCost = (buckets.uncachedInputTokens ?? 0) * (rate.inputPerMillion ?? 0) / 1e6;
  const outputCost = (buckets.outputTokens ?? 0) * (rate.outputPerMillion ?? 0) / 1e6;
  const cacheReadCost = (buckets.cacheReadTokens ?? 0) * (rate.cacheReadPerMillion ?? 0) / 1e6;
  const cacheWriteCost = (buckets.cacheWriteTokens ?? 0) * (rate.cacheWritePerMillion ?? 0) / 1e6;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
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
