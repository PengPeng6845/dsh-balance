/**
 * Durable day/month cost aggregates for dsh-usage-cost.
 *
 * Sits on the storage hub's "json" backend (registered by
 * dsh-storage-json) when both are present; otherwise degrades to
 * process-memory only. Writes are serialized through one promise chain
 * because the KV contract leaves write ordering to the caller.
 *
 * @module @deepseek-ai/dsh-usage-cost/store
 */

import { tokenDelta } from "./pricing.js";

/** Static identity of the KV unit this store owns (UNIT_NAME_RE-safe). */
const UNIT_NAME = "usage_cost";
const UNIT_VERSION = 1;

/** Cap on remembered per-session last-seen usage, to bound the global record. */
const MAX_SESSIONS = 256;
const PRUNE_COUNT = 64;

/** One aggregate cell: token buckets plus attributed cost. */
function emptyEntry() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };
}

function sanitizeMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

/** Local-time day key "YYYY-MM-DD". */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function addEntry(map, key, delta) {
  const cell = map[key] ?? emptyEntry();
  cell.uncachedInputTokens += delta.uncachedInputTokens;
  cell.outputTokens += delta.outputTokens;
  cell.cacheReadTokens += delta.cacheReadTokens;
  cell.cacheWriteTokens += delta.cacheWriteTokens;
  cell.cost += delta.cost;
  map[key] = cell;
  return { ...cell };
}

export class AggregateStore {
  constructor() {
    this.unit = null;
    this.persisted = false;
    this.chain = Promise.resolve();
    this.state = { last: {}, days: {}, months: {}, balanceSamples: [], schemaVersion: 2 };
  }

  /**
   * Open the storage unit and hydrate aggregates. Safe to call once at
   * plugin start; every failure leaves the store memory-only.
   *
   * @param storage - ctx.storage hub, or undefined.
   */
  async init(storage) {
    if (!storage) return;
    try {
      const backend = storage.backend?.get("json");
      const kv = backend?.kv;
      if (!kv) return;
      const unit = await kv.open({
        name: UNIT_NAME,
        version: UNIT_VERSION,
        tables: [],
        hasGlobal: true,
      });
      const loaded = await unit.loadAll();
      const g = loaded.global;
      const migrated = g && typeof g === "object" && !Array.isArray(g) && g.schemaVersion === 2;
      if (migrated) {
        this.state = {
          last: sanitizeMap(g.last),
          days: sanitizeMap(g.days),
          months: sanitizeMap(g.months),
          balanceSamples: Array.isArray(g.balanceSamples) ? g.balanceSamples : [],
          schemaVersion: 2,
        };
      } else {
        // Pre-0.4.0 records priced with an outdated table. Reset the
        // estimated aggregates (token history cannot be reconstructed per
        // day), but keep balance samples — they are real provider money.
        this.state = {
          last: {},
          days: {},
          months: {},
          balanceSamples:
            g && typeof g === "object" && !Array.isArray(g) && Array.isArray(g.balanceSamples)
              ? g.balanceSamples
              : [],
          schemaVersion: 2,
        };
      }
      this.unit = unit;
      this.persisted = true;
    } catch (err) {
      console.warn("[usage-cost] persistence unavailable, memory-only:", err?.message);
    }
  }

  /**
   * Fold one session's cumulative usage into the day/month aggregates.
   *
   * Token and cost deltas are clamped at zero, so retries and replayed
   * calls never double-count. Cost misattribution when a price table
   * changes mid-session is accepted: deltas carry the rate in effect.
   *
   * @param sessionId - durable session id.
   * @param entry - { uncachedInputTokens, outputTokens, cacheReadTokens,
   *   cacheWriteTokens, cost } cumulative for this session.
   * @param now - current time, for the day/month keys.
   * @returns fresh { today, month } aggregate cells.
   */
  record(sessionId, entry, now) {
    const prev = this.state.last[sessionId] ?? emptyEntry();
    const delta = tokenDelta(entry, prev);
    delta.cost = Math.max(0, (entry.cost ?? 0) - (prev.cost ?? 0));
    this.state.last[sessionId] = { ...entry };
    this._pruneSessions();

    const day = dateKey(now ?? new Date());
    const today = addEntry(this.state.days, day, delta);
    const month = addEntry(this.state.months, day.slice(0, 7), delta);

    return { today, month };
  }

  /**
   * Read-only snapshot of the current day and month aggregate cells.
   *
   * @param now - current time, for the day/month keys.
   * @returns { today, month } cells (copies, safe to hand out).
   */
  summary(now) {
    const day = dateKey(now ?? new Date());
    return {
      today: { ...(this.state.days[day] ?? emptyEntry()) },
      month: { ...(this.state.months[day.slice(0, 7)] ?? emptyEntry()) },
    };
  }

  /**
   * Append one balance sample. Unchanged totals replace the sample time
   * instead of appending, so polls do not grow the list; the list is
   * bounded for the persisted record.
   *
   * @param totalBalance - current total balance from the provider.
   * @param at - sample time (ms epoch).
   */
  recordBalance(totalBalance, at) {
    const samples = this.state.balanceSamples;
    const prev = samples[samples.length - 1];
    const total = Number(totalBalance) || 0;
    const time = at ?? Date.now();
    if (prev && prev.total === total) {
      if (time > prev.at) prev.at = time;
      return;
    }
    samples.push({ at: time, total });
    if (samples.length > 96) samples.shift();
  }

  /**
   * Real spend since local midnight: the sum of balance DROPS between
   * consecutive samples. Rises (top-ups) never count as negative spend.
   *
   * @param now - current time.
   * @returns spend in currency units, rounded to 0.0001.
   */
  realTodaySpend(now) {
    const today = dateKey(now ?? new Date());
    const dayStart = Date.parse(today + "T00:00:00");
    const end = (now ?? new Date()).getTime();
    const samples = this.state.balanceSamples.filter((s) => s.at >= dayStart && s.at <= end);
    let spend = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const drop = samples[i - 1].total - samples[i].total;
      if (drop > 0) spend += drop;
    }
    return Math.round((spend + Number.EPSILON) * 1e4) / 1e4;
  }

  /**
   * Enqueue one durable write of the current state. Callers debounce; the
   * chain serializes writes, and close() flushes a final write first.
   */
  persist() {
    if (!this.persisted || !this.unit) return;
    const snapshot = this.state;
    this.chain = this.chain
      .then(() => this.unit.setGlobal(snapshot))
      .catch((err) => console.warn("[usage-cost] persist failed:", err?.message));
  }

  /** Flush one final write, then close the unit behind in-flight writes. */
  close() {
    if (!this.unit) return;
    const unit = this.unit;
    this.unit = null;
    this.chain = this.chain
      .then(() => (this.persisted ? unit.setGlobal(this.state) : undefined))
      .then(() => unit.close())
      .catch(() => {});
  }

  _pruneSessions() {
    const keys = Object.keys(this.state.last);
    if (keys.length <= MAX_SESSIONS) return;
    for (const key of keys.slice(0, PRUNE_COUNT)) {
      delete this.state.last[key];
    }
  }
}
