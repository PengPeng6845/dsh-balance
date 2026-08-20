/**
 * dsh-usage-cost: token consumption and API cost reporting.
 *
 * Community-plugin shape: no harness imports (node builtins and local
 * modules only), named exports consumed by the cordis loader.
 *
 * Host half:
 * - folds provider-reported usage from the tokenUsage session projection
 *   (passive change-feed) into durable day/month aggregates,
 * - prices per-model for the token_usage tool, with the "*" entry as the
 *   aggregate rate,
 * - serves GET /usage-cost/summary for the sidebar widget.
 *
 * @module dsh-usage-cost
 */

import {
  DEFAULT_PRICES,
  computeCost,
  displayValue,
  formatTokens,
  moneyText,
  peakLabel,
  resolveRate,
  roundMoney,
  totalTokens,
  zeroBuckets,
} from "./pricing.js";
import { AggregateStore } from "./store.js";
import { BalanceClient } from "./balance.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "balance";

/** Services this plugin cannot start without. Everything else resolves lazily. */
export const inject = ["tools", "timer"];

const PERSIST_DEBOUNCE_MS = 3000;
const DEFAULT_BALANCE_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_BALANCE_BASE_URL = "https://api.deepseek.com";
const DEFAULT_BALANCE_REFRESH_MS = 300000;
const DEFAULT_FX_RATE = 7.2;

/**
 * Plugin configuration, hand-rolled so the package stays dependency-free.
 *
 * - currency: cost currency symbol used in cost text (CNY/USD/EUR).
 * - prices: per-model price table keyed by model id, provider route, or
 *   "*" (fallback). MERGES over the builtin DeepSeek table.
 * - persist: fold aggregates into the storage hub's json backend so day
 *   and month totals survive a restart. Degrades to memory-only when the
 *   storage hub or its json backend is not mounted.
 * - warnThreshold / alertThreshold: today-cost levels (in currency units)
 *   that tint the sidebar widget orange / red.
 * - balanceEnabled: poll the provider's /user/balance endpoint (official
 *   usage-detail APIs do not exist; balance drops ARE the real spend).
 * - balanceApiKeyEnv: credential-ref env name the balance API key lives in.
 * - balanceBaseUrl: provider API base (default DeepSeek).
 * - balanceRefreshMs: balance poll/cache interval.
 * - fxRate: CNY per one table-currency unit (builtin table is USD; the
 *   estimate display multiplies by this when currency is CNY).
 */
function resolveConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  const currency =
    typeof config.currency === "string" && config.currency.length > 0
      ? config.currency
      : "CNY";
  const prices = {
    ...DEFAULT_PRICES,
    ...(config.prices && typeof config.prices === "object" ? config.prices : {}),
  };
  const persist = config.persist !== false;
  const balanceEnabled = config.balanceEnabled !== false;
  const balanceApiKeyEnv =
    typeof config.balanceApiKeyEnv === "string" && config.balanceApiKeyEnv.length > 0
      ? config.balanceApiKeyEnv
      : DEFAULT_BALANCE_API_KEY_ENV;
  const balanceBaseUrl =
    typeof config.balanceBaseUrl === "string" && config.balanceBaseUrl.length > 0
      ? config.balanceBaseUrl
      : DEFAULT_BALANCE_BASE_URL;
  const balanceRefreshMs =
    typeof config.balanceRefreshMs === "number" && config.balanceRefreshMs >= 10000
      ? config.balanceRefreshMs
      : DEFAULT_BALANCE_REFRESH_MS;
  const fxRate =
    typeof config.fxRate === "number" && config.fxRate > 0
      ? config.fxRate
      : DEFAULT_FX_RATE;
  return {
    currency,
    prices,
    persist,
    balanceEnabled,
    balanceApiKeyEnv,
    balanceBaseUrl,
    balanceRefreshMs,
    fxRate,
  };
}

/**
 * Read this session's provider usage buckets, preferring the durable
 * tokenUsage projection and falling back to the token-meter measurement
 * anchor. Returns zeros (source "none") when neither is mounted.
 */
function readBuckets(ctx, session) {
  const projections = ctx.get("sessionProjections");
  if (projections) {
    const snapshot = projections.snapshot(session);
    const usage = snapshot?.values?.tokenUsage;
    if (usage) {
      return {
        uncachedInputTokens: usage.uncachedInputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        source: "provider",
      };
    }
  }
  const meter = ctx.get("tokenMeter");
  if (meter) {
    const measured = meter.measure(session);
    const usage =
      measured?.baseline?.kind === "usage" ? measured.baseline.usage : undefined;
    if (usage) {
      return {
        uncachedInputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        source: "provider",
      };
    }
  }
  return { ...zeroBuckets(), source: "none" };
}

/** Buckets -> store entry priced with the aggregate ("*") rate. */
function aggregateEntryOf(buckets, prices, at) {
  const rate = resolveRate(prices, undefined, undefined);
  return {
    uncachedInputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
    cost: computeCost(buckets, rate, at).totalCost,
  };
}

/** One JSON schema fragment for a usage cell (session/today/month). */
const usageCellSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    uncachedInputTokens: { type: "integer" },
    outputTokens: { type: "integer" },
    cacheReadTokens: { type: "integer" },
    cacheWriteTokens: { type: "integer" },
    totalTokens: { type: "integer" },
    cost: { type: "number" },
    costText: { type: "string" },
  },
  required: [
    "uncachedInputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
    "cost",
    "costText",
  ],
};

/** Buckets + cost -> canonical usage cell, in display currency. */
function usageCell(buckets, cost, currency, fxRate) {
  const shown = displayValue(cost.totalCost, currency, fxRate);
  return {
    uncachedInputTokens: buckets.uncachedInputTokens ?? 0,
    outputTokens: buckets.outputTokens ?? 0,
    cacheReadTokens: buckets.cacheReadTokens ?? 0,
    cacheWriteTokens: buckets.cacheWriteTokens ?? 0,
    totalTokens: totalTokens(buckets),
    cost: roundMoney(shown),
    costText: moneyText(shown, currency),
  };
}

/** Aggregate cell -> canonical usage cell, in display currency. */
function aggregateCell(cell, currency, fxRate) {
  const shown = displayValue(cell.cost, currency, fxRate);
  return {
    uncachedInputTokens: cell.uncachedInputTokens,
    outputTokens: cell.outputTokens,
    cacheReadTokens: cell.cacheReadTokens,
    cacheWriteTokens: cell.cacheWriteTokens,
    totalTokens: totalTokens(cell),
    cost: roundMoney(shown),
    costText: moneyText(shown, currency),
  };
}

/** One-line breakdown of a bucket set, for the model-facing text. */
function bucketLine(buckets) {
  const parts = [];
  parts.push(formatTokens(buckets.uncachedInputTokens) + " input");
  if ((buckets.cacheReadTokens ?? 0) > 0) {
    parts.push(formatTokens(buckets.cacheReadTokens) + " cache-read");
  }
  if ((buckets.cacheWriteTokens ?? 0) > 0) {
    parts.push(formatTokens(buckets.cacheWriteTokens) + " cache-write");
  }
  parts.push(formatTokens(buckets.outputTokens) + " output");
  return parts.join(" + ");
}

/** Render the canonical value as one model-facing text block. */
function formatUsageText(value) {
  const lines = [];
  lines.push("Token usage, " + value.rateLabel + ":");
  lines.push(
    "- session: " +
      bucketLine(value.session) +
      " = " +
      formatTokens(value.session.totalTokens) +
      " tokens",
  );
  lines.push("- cost: " + value.session.costText + " this session");
  lines.push(
    "- today: " +
      value.today.costText +
      " (" +
      formatTokens(value.today.totalTokens) +
      " tokens)",
  );
  lines.push(
    "- this month: " +
      value.month.costText +
      " (" +
      formatTokens(value.month.totalTokens) +
      " tokens)",
  );
  if (value.persisted) {
    lines.push("- day/month totals are persisted and survive restarts");
  } else {
    lines.push("- day/month totals are in-memory only (no storage backend mounted)");
  }
  if (value.balance) {
    lines.push(
      "- account balance: " + moneyText(value.balance.totalBalance, value.balance.currency) + " (real, from /user/balance)",
    );
  }
  if (typeof value.realTodayCost === "number") {
    lines.push(
      "- real spend today: " + moneyText(value.realTodayCost, value.currency) + " (sum of balance drops, API-key verified)",
    );
  }
  if (value.source !== "provider") {
    lines.push("- note: " + value.note);
  }
  return lines.join("\n");
}

function noteFor(source) {
  if (source === "none") {
    return "No provider usage recorded for this session yet; costs read zero until the first successful model call.";
  }
  if (source === "estimate") {
    return "Usage is a token-meter heuristic estimate, not provider-reported billing data.";
  }
  return "Usage is provider-reported billing data.";
}

/** Register the token_usage tool plus its system-prompt guidance. */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const store = new AggregateStore();

  if (config.persist) {
    void store.init(ctx.get("storage"));
    ctx.effect(() => () => store.close());
  }

  // Debounced durable writes: the change feed can fold many times per
  // response, but the json backend rewrites the whole unit file per write.
  let persistTimer = null;
  const schedulePersist = () => {
    if (persistTimer !== null) return;
    persistTimer = ctx.timeout(() => {
      persistTimer = null;
      store.persist();
    }, PERSIST_DEBOUNCE_MS);
  };

  // Real balance ground truth: the official API has no usage-detail
  // endpoint, so balance samples are the API-key-verifiable spend source.
  // Polled at startup and every balanceRefreshMs; drops between samples
  // are the real spend (rises are top-ups and never count).
  const balance = config.balanceEnabled
    ? new BalanceClient(config, ctx)
    : null;
  if (balance) {
    const pollBalance = async () => {
      const data = await balance.check(true);
      if (!data) return;
      store.recordBalance(data.totalBalance, Date.now());
      schedulePersist();
    };
    void pollBalance();
    ctx.interval(() => void pollBalance(), config.balanceRefreshMs);
  }

  // Passive aggregation: fold every tokenUsage projection change into the
  // day/month store at the aggregate rate, so the widget stays fresh even
  // when nobody calls the tool. Absent projections keep the tool-only path.
  let projectionsAvailable = false;
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.effect(() =>
      projectionCtx.sessionProjections.onChanged((session, key, value) => {
        if (key !== "tokenUsage" || !value || typeof value !== "object") return;
        const buckets = {
          uncachedInputTokens: value.uncachedInputTokens ?? 0,
          outputTokens: value.outputTokens ?? 0,
          cacheReadTokens: value.cacheReadTokens ?? 0,
          cacheWriteTokens: value.cacheWriteTokens ?? 0,
        };
        store.record(
          String(session?.id ?? "unknown"),
          aggregateEntryOf(buckets, config.prices, new Date()),
          new Date(),
        );
        schedulePersist();
      }),
    );
    projectionsAvailable = true;
  });

  // Widget data endpoint: GET /dsh-balance/summary -> real balance only.
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: "exact",
        path: "/dsh-balance/summary",
        async handler(req, res) {
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { "content-type": "text/plain" });
            res.end("method not allowed");
            return;
          }
          const now = new Date();
          const balanceData = balance ? await balance.check(false) : null;
          if (balanceData) {
            store.recordBalance(balanceData.totalBalance, Date.now());
            schedulePersist();
          }
          const body = JSON.stringify({
            balance: balanceData
              ? {
                  currency: balanceData.currency,
                  totalBalance: balanceData.totalBalance,
                  checkedAt: balanceData.checkedAt,
                }
              : null,
            realTodayCost: balanceData ? store.realTodaySpend(now) : null,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(req.method === "HEAD" ? undefined : body);
        },
      }),
    );
  });

  ctx.tools.register({
    name: "token_usage",
    description:
      "Report this session's token consumption and estimated API cost: provider-reported input/output/cache tokens, the cost of this session, and the accumulated cost for today and this month.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          currency: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          rateLabel: { type: "string" },
          source: { type: "string" },
          persisted: { type: "boolean" },
          session: usageCellSchema,
          today: usageCellSchema,
          month: usageCellSchema,
          balance: {
            type: "object",
            additionalProperties: false,
            properties: {
              currency: { type: "string" },
              totalBalance: { type: "number" },
            },
            required: ["currency", "totalBalance"],
          },
          realTodayCost: { type: "number" },
          note: { type: "string" },
        },
        required: [
          "currency",
          "provider",
          "model",
          "rateLabel",
          "source",
          "persisted",
          "session",
          "today",
          "month",
        ],
      },
      render: (_args, value) => [{ type: "text", text: formatUsageText(value) }],
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const agent = exec?.agent;
      if (!agent) {
        throw new Error("token_usage must be called from an agent session");
      }
      const buckets = readBuckets(ctx, agent.session);
      const provider = agent.options?.provider;
      const model = agent.options?.model;
      const rate = resolveRate(config.prices, provider, model);
      const now = new Date();
      const cost = computeCost(buckets, rate, now);
      if (!projectionsAvailable) {
        // Fallback: no change feed — fold this call into the aggregates.
        const entry = {
          uncachedInputTokens: buckets.uncachedInputTokens,
          outputTokens: buckets.outputTokens,
          cacheReadTokens: buckets.cacheReadTokens,
          cacheWriteTokens: buckets.cacheWriteTokens,
          cost: cost.totalCost,
        };
        store.record(String(agent.id ?? "unknown"), entry, now);
        store.persist();
      }
      const { today, month } = store.summary(now);
      const balanceData = balance ? await balance.check(false) : null;
      if (balanceData) {
        store.recordBalance(balanceData.totalBalance, Date.now());
        schedulePersist();
      }
      return {
        currency: config.currency,
        provider: provider ?? "unknown",
        model: model ?? "unknown",
        rateLabel: (rate.label ?? rate.key) + peakLabel(now, undefined, rate.peakFactor),
        source: buckets.source,
        persisted: store.persisted,
        session: usageCell(buckets, cost, config.currency, config.fxRate),
        today: aggregateCell(today, config.currency, config.fxRate),
        month: aggregateCell(month, config.currency, config.fxRate),
        ...(balanceData
          ? {
              balance: {
                currency: balanceData.currency,
                totalBalance: roundMoney(balanceData.totalBalance),
              },
              realTodayCost: store.realTodaySpend(now),
            }
          : {}),
        note: noteFor(buckets.source),
      };
    },
  });

  const systemPrompt = ctx.get("systemPrompt");
  if (systemPrompt) {
    systemPrompt.section({
      name: "tool:token_usage",
      order: 121,
      text: "Use the token_usage tool to check the current session's token consumption and estimated API cost whenever the user asks about usage, cost, or billing, and report the numbers it returns in your answer.",
    });
  }
}

export default { name, inject, apply };
