// Standalone unit smoke test for the zero-dep modules of @pengpeng6845/dsh-balance.
// Run with: node test/smoke.mjs (no install step required).
import { AggregateStore, dateKey } from "../lib/store.js";
import { BalanceClient } from "../lib/balance.js";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log((ok ? "PASS " : "FAIL ") + label + ": " + JSON.stringify(actual) + (ok ? "" : " (expected " + JSON.stringify(expected) + ")"));
}

// ---- store: fake kv backend ----
function fakeStorage(initialGlobal) {
  const box = { global: initialGlobal ?? null, writes: [], closed: false };
  return {
    storage: {
      backend: {
        get: () => ({
          kv: {
            open: async () => ({
              loadAll: async () => ({ tables: {}, global: box.global }),
              setGlobal: async (v) => { box.global = v; box.writes.push(v); },
              close: async () => { box.closed = true; },
            }),
          },
        }),
      },
    },
    box,
  };
}

// migration: v2 record keeps balance samples, drops estimate tables
const legacy = {
  last: { s1: { uncachedInputTokens: 1 } },
  days: { "2026-08-20": { cost: 3 } },
  months: {},
  balanceSamples: [{ at: 1700000000000, total: 15.05 }],
  schemaVersion: 2,
};
const migrated = new AggregateStore();
await migrated.init(fakeStorage(legacy).storage);
check("migration keeps samples", migrated.state.balanceSamples.length, 1);
check("migration sample total", migrated.state.balanceSamples[0].total, 15.05);
check("migration drops estimates", migrated.state.days, undefined);
check("migration stamps v3", migrated.state.schemaVersion, 3);

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
bal.recordBalance(159.8, Date.parse("2026-08-20T12:05:00"));
check("unchanged sample replaces time", bal.state.balanceSamples.length, 4);
check("dateKey pad", dateKey(new Date(2026, 0, 5)), "2026-01-05");

// persist + close flush
const ps = fakeStorage({ balanceSamples: [], schemaVersion: 3 });
const pst = new AggregateStore();
await pst.init(ps.storage);
pst.recordBalance(10, Date.now());
pst.persist();
await pst.chain;
check("persist wrote global", ps.box.writes.length, 1);
check("persist stamped v3", ps.box.writes[0].schemaVersion, 3);
pst.close();
await pst.chain;
check("close closes unit", ps.box.closed, true);

// ---- balance client ----
function fakeCtx(resolveImpl) {
  return { get: (n) => (n === "credentials" ? { resolve: resolveImpl } : undefined) };
}
const cfg = { balanceBaseUrl: "https://api.deepseek.com", balanceApiKeyEnv: "DEEPSEEK_API_KEY", balanceRefreshMs: 300000 };

let fetchCalls = 0;
const okFetch = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    json: async () => ({
      is_available: true,
      balance_infos: [
        { currency: "USD", total_balance: "0.00", granted_balance: "0", topped_up_balance: "0" },
        { currency: "CNY", total_balance: "12.29", granted_balance: "0", topped_up_balance: "12.29" },
      ],
    }),
  };
};

const client = new BalanceClient(cfg, fakeCtx(async () => ({ value: "secret" })), okFetch);
const first = await client.check(true);
check("balance picks funded bucket", first.currency, "CNY");
check("balance total", first.totalBalance, 12.29);
const second = await client.check(false);
check("balance cached", fetchCalls, 1);
check("balance cache hit", second.totalBalance, 12.29);

// in-flight dedup: two concurrent checks share one request
let inflightCalls = 0;
let release;
const slowFetch = () => {
  inflightCalls += 1;
  return new Promise((resolve) => {
    release = () => resolve({ ok: true, json: async () => ({ balance_infos: [{ currency: "CNY", total_balance: "9" }] }) });
  });
};
const dedup = new BalanceClient({ ...cfg, balanceRefreshMs: 1 }, fakeCtx(async () => ({ value: "secret" })), slowFetch);
const p1 = dedup.check(true);
const p2 = dedup.check(true);
await new Promise((resolve) => setTimeout(resolve, 10)); // let the fetch start
release();
await Promise.all([p1, p2]);
check("in-flight dedup", inflightCalls, 1);

// failure backoff: no retry inside the window, stale cache still served
let failCalls = 0;
const failThenOk = async () => {
  failCalls += 1;
  if (failCalls === 1) throw new Error("network");
  return { ok: true, json: async () => ({ balance_infos: [{ currency: "CNY", total_balance: "8" }] }) };
};
const retry = new BalanceClient({ ...cfg, balanceRefreshMs: 0 }, fakeCtx(async () => ({ value: "secret" })), failThenOk);
check("failure returns null", await retry.check(true), null);
const staleProbe = await retry.check(false);
check("backoff serves null without cache", staleProbe, null);
check("backoff window set", retry.nextAttemptAt > Date.now(), true);

// stale cache served during backoff
let staleCalls = 0;
const staleThenFail = async () => {
  staleCalls += 1;
  if (staleCalls === 1) {
    return { ok: true, json: async () => ({ balance_infos: [{ currency: "CNY", total_balance: "7" }] }) };
  }
  throw new Error("down");
};
const st = new BalanceClient({ ...cfg, balanceRefreshMs: 0 }, fakeCtx(async () => ({ value: "secret" })), staleThenFail);
await st.check(true); // success, caches 7
await st.check(true); // fail, arms backoff
const staleValue = await st.check(false);
check("stale served during backoff", staleValue.totalBalance, 7);
check("stale flagged", staleValue.stale, true);

// missing credentials -> null without fetch
const noKey = new BalanceClient(cfg, fakeCtx(async () => undefined), okFetch);
check("no key returns null", await noKey.check(true), null);

// ---- plugin contract ----
const mod = await import("../lib/index.js");
check("plugin name", mod.name, "balance");
check("plugin inject", JSON.stringify(mod.inject), JSON.stringify(["tools", "timer"]));
check("default export name", mod.default?.name, "balance");
check("apply is function", typeof mod.apply, "function");

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
