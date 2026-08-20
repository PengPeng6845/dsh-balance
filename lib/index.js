/**
 * dsh-usage-cost: token consumption and API cost reporting.
 *
 * Community-plugin shape: no harness imports (node builtins and local
 * modules only), named exports consumed by the cordis loader. Reads
 * provider-reported usage from the tokenUsage session projection (with a
 * token-meter heuristic fallback), prices it against a configurable
 * per-model table, folds deltas into durable day/month aggregates, and
 * registers the model-facing token_usage tool.
 *
 * @module @deepseek-ai/dsh-usage-cost
 */

import {
  DEFAULT_PRICES,
  computeCost,
  formatTokens,
  moneyText,
  resolveRate,
  roundMoney,
  totalTokens,
  zeroBuckets,
} from "./pricing.js";
import { AggregateStore } from "./store.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "usage-cost";

/** Services this plugin cannot start without. Everything else resolves lazily. */
export const inject = ["tools"];

/**
 * Plugin configuration, hand-rolled so the package stays dependency-free.
 *
 * - currency: cost currency symbol used in costText (CNY/USD/EUR).
 * - prices: per-model price table keyed by model id, provider route, or
 *   "*" (fallback). MERGES over the builtin DeepSeek table.
 * - persist: fold aggregates into the storage hub's json backend so day
 *   and month totals survive a restart. Degrades to memory-only when the
 *   storage hub or its json backend is not mounted.
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
  return { currency, prices, persist };
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

/** Buckets + cost -> canonical usage cell. */
function usageCell(buckets, cost, currency) {
  return {
    uncachedInputTokens: buckets.uncachedInputTokens ?? 0,
    outputTokens: buckets.outputTokens ?? 0,
    cacheReadTokens: buckets.cacheReadTokens ?? 0,
    cacheWriteTokens: buckets.cacheWriteTokens ?? 0,
    totalTokens: totalTokens(buckets),
    cost: roundMoney(cost.totalCost),
    costText: moneyText(cost.totalCost, currency),
  };
}

/** Aggregate cell -> canonical usage cell. */
function aggregateCell(cell, currency) {
  return {
    uncachedInputTokens: cell.uncachedInputTokens,
    outputTokens: cell.outputTokens,
    cacheReadTokens: cell.cacheReadTokens,
    cacheWriteTokens: cell.cacheWriteTokens,
    totalTokens: totalTokens(cell),
    cost: roundMoney(cell.cost),
    costText: moneyText(cell.cost, currency),
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
      const cost = computeCost(buckets, rate);
      const entry = {
        uncachedInputTokens: buckets.uncachedInputTokens,
        outputTokens: buckets.outputTokens,
        cacheReadTokens: buckets.cacheReadTokens,
        cacheWriteTokens: buckets.cacheWriteTokens,
        cost: cost.totalCost,
      };
      const { today, month } = store.record(
        String(agent.id ?? "unknown"),
        entry,
        new Date(),
      );
      return {
        currency: config.currency,
        provider: provider ?? "unknown",
        model: model ?? "unknown",
        rateLabel: rate.label ?? rate.key,
        source: buckets.source,
        persisted: store.persisted,
        session: usageCell(buckets, cost, config.currency),
        today: aggregateCell(today, config.currency),
        month: aggregateCell(month, config.currency),
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
