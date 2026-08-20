/**
 * @pengpeng6845/dsh-balance: real API balance monitoring.
 *
 * Community-plugin shape: no harness imports (node builtins and local
 * modules only), named exports consumed by the cordis loader.
 *
 * - Polls the official GET /user/balance endpoint with the API key from
 *   the credentials seam; balance drops are the real spend.
 * - Serves GET /dsh-balance/summary for the sidebar widget (balance,
 *   today's real spend, staleness, low-balance flag).
 * - Registers the token_usage tool: exact provider token buckets plus
 *   the real balance — no cost estimates.
 *
 * @module @pengpeng6845/dsh-balance
 */

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
const DEFAULT_LOW_BALANCE_ALERT = 5;

/**
 * Plugin configuration, hand-rolled so the package stays dependency-free.
 *
 * - persist: keep balance samples in the storage hub's json backend so
 *   today's real spend survives restarts (memory-only fallback).
 * - balanceEnabled: poll the official /user/balance endpoint.
 * - balanceApiKeyEnv: credential-ref env name the API key lives in.
 * - balanceBaseUrl: provider API base (default DeepSeek).
 * - balanceRefreshMs: poll/cache interval (ms).
 * - lowBalanceAlert: balance level that flags "low" in the widget and
 *   the tool (in account currency units).
 */
function resolveConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
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
  const lowBalanceAlert =
    typeof config.lowBalanceAlert === "number" && config.lowBalanceAlert >= 0
      ? config.lowBalanceAlert
      : DEFAULT_LOW_BALANCE_ALERT;
  return {
    persist,
    balanceEnabled,
    balanceApiKeyEnv,
    balanceBaseUrl,
    balanceRefreshMs,
    lowBalanceAlert,
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
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    source: "none",
  };
}

/** "¥12.29"-style money text (4 decimals for the tool report). */
function moneyText(value, currency) {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "EUR " : "¥";
  return symbol + (Number(value) || 0).toFixed(4);
}

/** "1.23M" / "456.7k" / "89"-style token text. */
function formatTokens(value) {
  const n = value ?? 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function totalTokens(buckets) {
  return (
    (buckets.uncachedInputTokens ?? 0) +
    (buckets.outputTokens ?? 0) +
    (buckets.cacheReadTokens ?? 0) +
    (buckets.cacheWriteTokens ?? 0)
  );
}

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
function formatReport(value) {
  const lines = [];
  lines.push(
    "Token usage (provider-reported, exact): " +
      bucketLine(value.session) +
      " = " +
      formatTokens(value.session.totalTokens) +
      " tokens",
  );
  if (value.balance) {
    lines.push(
      "Account balance (real, from /user/balance): " +
        moneyText(value.balance.totalBalance, value.balance.currency) +
        (value.balance.stale ? " (stale — last successful check)" : ""),
    );
  } else {
    lines.push("Account balance: unavailable (API key not configured or network failure).");
  }
  if (typeof value.realTodayCost === "number" && value.realTodayCost > 0) {
    lines.push(
      "Real spend today (sum of balance drops): " +
        moneyText(value.realTodayCost, value.balance?.currency ?? "CNY"),
    );
  }
  if (value.lowBalance) {
    lines.push(
      "Balance is below the low-balance alert threshold (" +
        moneyText(value.lowBalanceThreshold, value.balance?.currency ?? "CNY") +
        ") — consider topping up.",
    );
  }
  if (value.source !== "provider") {
    lines.push(
      "- note: no provider usage recorded for this session yet; token counts read zero.",
    );
  }
  return lines.join("\n");
}

/** Register the token_usage tool, the balance endpoint, and the poller. */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const store = new AggregateStore();

  if (config.persist) {
    void store.init(ctx.get("storage"));
    ctx.effect(() => () => store.close());
  }

  // Debounced durable writes: samples can arrive in bursts (endpoint hits,
  // poll ticks), but the json backend rewrites the whole unit file.
  let persistTimer = null;
  const schedulePersist = () => {
    if (persistTimer !== null) return;
    persistTimer = ctx.timeout(() => {
      persistTimer = null;
      store.persist();
    }, PERSIST_DEBOUNCE_MS);
  };

  const balance = config.balanceEnabled ? new BalanceClient(config, ctx) : null;
  if (balance) {
    const pollBalance = async () => {
      const data = await balance.check(true);
      if (!data) return;
      store.recordBalance(data.totalBalance, Date.now());
      schedulePersist();
    };
    // Delay the first poll slightly: the credentials provider finishes
    // mounting right after composition load, and a too-early miss would
    // arm the failure backoff for no reason.
    ctx.timeout(() => void pollBalance(), 2000);
    ctx.interval(() => void pollBalance(), config.balanceRefreshMs);
  }

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
            status: balanceData ? "ok" : "unavailable",
            balance: balanceData
              ? {
                  currency: balanceData.currency,
                  totalBalance: balanceData.totalBalance,
                  checkedAt: balanceData.checkedAt,
                  stale: balanceData.stale === true,
                }
              : null,
            realTodayCost: balanceData ? store.realTodaySpend(now) : null,
            lowBalance: balanceData
              ? balanceData.totalBalance < config.lowBalanceAlert
              : null,
            lowBalanceThreshold: config.lowBalanceAlert,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(req.method === "HEAD" ? undefined : body);
        },
      }),
    );
  });

  const usageCellSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      uncachedInputTokens: { type: "integer" },
      outputTokens: { type: "integer" },
      cacheReadTokens: { type: "integer" },
      cacheWriteTokens: { type: "integer" },
      totalTokens: { type: "integer" },
    },
    required: [
      "uncachedInputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
    ],
  };

  ctx.tools.register({
    name: "token_usage",
    description:
      "Report this session's exact provider-reported token consumption (input/output/cache buckets) and the real account balance from the official /user/balance endpoint.",
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
          provider: { type: "string" },
          model: { type: "string" },
          source: { type: "string" },
          session: usageCellSchema,
          balance: {
            type: "object",
            additionalProperties: false,
            properties: {
              currency: { type: "string" },
              totalBalance: { type: "number" },
              stale: { type: "boolean" },
            },
            required: ["currency", "totalBalance"],
          },
          realTodayCost: { type: "number" },
          lowBalance: { type: "boolean" },
          lowBalanceThreshold: { type: "number" },
        },
        required: ["provider", "model", "source", "session"],
      },
      render: (_args, value) => [{ type: "text", text: formatReport(value) }],
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const agent = exec?.agent;
      if (!agent) {
        throw new Error("token_usage must be called from an agent session");
      }
      const buckets = readBuckets(ctx, agent.session);
      const now = new Date();
      const balanceData = balance ? await balance.check(false) : null;
      if (balanceData) {
        store.recordBalance(balanceData.totalBalance, Date.now());
        schedulePersist();
      }
      return {
        provider: agent.options?.provider ?? "unknown",
        model: agent.options?.model ?? "unknown",
        source: buckets.source,
        session: {
          uncachedInputTokens: buckets.uncachedInputTokens,
          outputTokens: buckets.outputTokens,
          cacheReadTokens: buckets.cacheReadTokens,
          cacheWriteTokens: buckets.cacheWriteTokens,
          totalTokens: totalTokens(buckets),
        },
        ...(balanceData
          ? {
              balance: {
                currency: balanceData.currency,
                totalBalance: balanceData.totalBalance,
                ...(balanceData.stale === true ? { stale: true } : {}),
              },
              realTodayCost: store.realTodaySpend(now),
              lowBalance: balanceData.totalBalance < config.lowBalanceAlert,
              lowBalanceThreshold: config.lowBalanceAlert,
            }
          : {}),
      };
    },
  });

  const systemPrompt = ctx.get("systemPrompt");
  if (systemPrompt) {
    systemPrompt.section({
      name: "tool:token_usage",
      order: 121,
      text: "Use the token_usage tool to check the current session's token consumption and the real account balance whenever the user asks about usage, tokens, balance, or billing, and report the numbers it returns in your answer.",
    });
  }
}

export default { name, inject, apply };
