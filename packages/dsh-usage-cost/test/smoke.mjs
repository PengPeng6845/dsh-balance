// Standalone unit smoke test for the zero-dep modules of dsh-usage-cost.
// Run with: node test/smoke.mjs (no install step required).
import { DEFAULT_PRICES, computeCost, resolveRate, totalTokens, moneyText, roundMoney } from "../lib/pricing.js";
import { AggregateStore, dateKey } from "../lib/store.js";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log((ok ? "PASS " : "FAIL ") + label + ": " + JSON.stringify(actual) + (ok ? "" : " (expected " + JSON.stringify(expected) + ")"));
}

// rate resolution: exact model, provider fallback, wildcard
const byModel = resolveRate(DEFAULT_PRICES, "deepseek", "deepseek-reasoner");
check("resolve by model", byModel.key, "deepseek-reasoner");
check("reasoner output rate", byModel.outputPerMillion, 16);
const byProvider = resolveRate({ "my-provider": { inputPerMillion: 1, outputPerMillion: 3 } }, "my-provider", "unknown-model");
check("resolve by provider", byProvider.key, "my-provider");
const byWildcard = resolveRate({}, "other", "other-model");
check("resolve wildcard fallback", byWildcard.key, "*");

// cost math: 1.2M input(miss) + 3M output + 0.5M cache-read + 10k cache-write on deepseek-chat
const buckets = { uncachedInputTokens: 1200000, outputTokens: 3000000, cacheReadTokens: 500000, cacheWriteTokens: 10000 };
const rate = resolveRate(DEFAULT_PRICES, "deepseek", "deepseek-chat");
const cost = computeCost(buckets, rate);
check("input cost", roundMoney(cost.inputCost), 2.4);
check("output cost", roundMoney(cost.outputCost), 24);
check("cache-read cost", roundMoney(cost.cacheReadCost), 0.25);
check("cache-write cost", roundMoney(cost.cacheWriteCost), 0.02);
check("total cost", roundMoney(cost.totalCost), 26.67);
check("cost text", moneyText(cost.totalCost, "CNY"), "¥26.6700");

// aggregate store: monotonic deltas, day/month keys, idempotent replay
const store = new AggregateStore();
const t0 = new Date(2026, 7, 14, 10, 0, 0);
const e0 = { ...buckets, cost: cost.totalCost };
const r0 = store.record("sess-1", e0, t0);
check("first record today tokens", totalTokens(r0.today), totalTokens(buckets));
check("first record month key", dateKey(t0).slice(0, 7), "2026-08");
const e1 = { uncachedInputTokens: 1400000, outputTokens: 3000000, cacheReadTokens: 500000, cacheWriteTokens: 10000, cost: cost.totalCost + 0.4 };
const r1 = store.record("sess-1", e1, t0);
check("delta tokens", totalTokens(r1.today) - totalTokens(r0.today), 200000);
check("delta cost", roundMoney(r1.today.cost - r0.today.cost), 0.4);
const r2 = store.record("sess-1", e1, t0);
check("replay idempotent tokens", totalTokens(r2.today), totalTokens(r1.today));
check("replay idempotent cost", roundMoney(r2.today.cost), roundMoney(r1.today.cost));
const r3 = store.record("sess-2", e0, new Date(2026, 7, 15, 9, 0, 0));
check("second day separate", totalTokens(r3.today), totalTokens(buckets));
check("month accumulates across days", totalTokens(r3.month), totalTokens(r1.today) + totalTokens(buckets));
check("dateKey pad", dateKey(new Date(2026, 0, 5)), "2026-01-05");

// index module loads and exposes the plugin contract
const mod = await import("../lib/index.js");
check("plugin name", mod.name, "usage-cost");
check("plugin inject", JSON.stringify(mod.inject), JSON.stringify(["tools"]));
check("default export name", mod.default?.name, "usage-cost");
check("apply is function", typeof mod.apply, "function");

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
