// Standalone unit smoke test for the zero-dep modules of dsh-usage-cost.
// Run with: node test/smoke.mjs (no install step required).
import { DEFAULT_PRICES, computeCost, displayValue, isPeak, resolveRate, totalTokens, moneyText, roundMoney } from "../lib/pricing.js";
import { AggregateStore, dateKey } from "../lib/store.js";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log((ok ? "PASS " : "FAIL ") + label + ": " + JSON.stringify(actual) + (ok ? "" : " (expected " + JSON.stringify(expected) + ")"));
}

// rate resolution: exact model, provider fallback, wildcard
const byModel = resolveRate(DEFAULT_PRICES, "deepseek", "deepseek-v4-pro");
check("resolve by model", byModel.key, "deepseek-v4-pro");
check("pro output rate", byModel.outputPerMillion, 1.98);
const byProvider = resolveRate({ "my-provider": { inputPerMillion: 1, outputPerMillion: 3 } }, "my-provider", "unknown-model");
check("resolve by provider", byProvider.key, "my-provider");
const byWildcard = resolveRate({}, "other", "other-model");
check("resolve wildcard fallback", byWildcard.key, "*");

// peak windows: UTC 01-04 and 06-10 are peak, everything else is half
check("peak hour 07 UTC", isPeak(Date.UTC(2026, 7, 20, 7, 0, 0)), true);
check("off-peak hour 05 UTC", isPeak(Date.UTC(2026, 7, 20, 5, 0, 0)), false);
check("off-peak hour 12 UTC", isPeak(Date.UTC(2026, 7, 20, 12, 0, 0)), false);

// cost math, v4-flash: 1M miss + 2M output, off-peak (05:00 UTC)
const buckets = { uncachedInputTokens: 1000000, outputTokens: 2000000, cacheReadTokens: 0, cacheWriteTokens: 0 };
const rate = resolveRate(DEFAULT_PRICES, "deepseek", "deepseek-v4-flash");
const offPeakAt = Date.UTC(2026, 7, 20, 5, 0, 0);
const cost = computeCost(buckets, rate, offPeakAt);
check("off-peak input cost", roundMoney(cost.inputCost), 0.22);
check("off-peak output cost", roundMoney(cost.outputCost), 1.32);
check("off-peak total cost", roundMoney(cost.totalCost), 1.54);
const peakAt = Date.UTC(2026, 7, 20, 7, 0, 0);
const peakCost = computeCost(buckets, rate, peakAt);
check("peak total cost doubles", roundMoney(peakCost.totalCost), 3.08);
check("fx display CNY", roundMoney(displayValue(1.54, "CNY", 7.2)), 11.088);
check("fx display USD unchanged", displayValue(1.54, "USD", 7.2), 1.54);
check("cost text", moneyText(displayValue(1.54, "CNY", 7.2), "CNY"), "¥11.0880");

// aggregate store: monotonic deltas, day/month keys, idempotent replay
const store = new AggregateStore();
const t0 = new Date(2026, 7, 14, 10, 0, 0);
const e0 = { ...buckets, cost: cost.totalCost };
const r0 = store.record("sess-1", e0, t0);
check("first record today tokens", totalTokens(r0.today), totalTokens(buckets));
check("first record month key", dateKey(t0).slice(0, 7), "2026-08");
const e1 = { uncachedInputTokens: 1200000, outputTokens: 2000000, cacheReadTokens: 0, cacheWriteTokens: 0, cost: cost.totalCost + 0.4 };
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

// balance samples: real spend = sum of drops; top-ups never count
const bal = new AggregateStore();
const t1 = Date.parse("2026-08-20T09:00:00");
const t2 = Date.parse("2026-08-20T10:00:00");
const t3 = Date.parse("2026-08-20T11:00:00");
bal.recordBalance(110, t1);
bal.recordBalance(109.9, t2);
bal.recordBalance(159.9, t3); // top-up: rise must not count
check("balance real spend", bal.realTodaySpend(new Date(2026, 7, 20, 12, 0, 0)), 0.1);
bal.recordBalance(159.8, Date.parse("2026-08-20T12:00:00"));
check("balance spend after top-up", bal.realTodaySpend(new Date(2026, 7, 20, 12, 30, 0)), 0.2);
check("unchanged sample replaces time", bal.state.balanceSamples.length, 4);

// index module loads and exposes the plugin contract
const mod = await import("../lib/index.js");
check("plugin name", mod.name, "usage-cost");
check("plugin inject", JSON.stringify(mod.inject), JSON.stringify(["tools", "timer"]));
check("default export name", mod.default?.name, "usage-cost");
check("apply is function", typeof mod.apply, "function");

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
