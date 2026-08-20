/**
 * Balance-sample store for @pengpeng6845/dsh-balance.
 *
 * Sits on the storage hub's "json" backend (registered by
 * dsh-storage-json) when both are present; otherwise degrades to
 * process-memory only. Writes are serialized through one promise chain
 * because the KV contract leaves write ordering to the caller.
 *
 * State shape (schemaVersion 3): balance samples only. Everything else
 * from earlier versions is dropped on migration — balance samples are
 * real provider money and are the one thing worth keeping.
 *
 * @module @pengpeng6845/dsh-balance/store
 */

/** Static identity of the KV unit this store owns (UNIT_NAME_RE-safe). */
const UNIT_NAME = "usage_cost";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 3;

/** Cap on retained balance samples (5-minute polls, ~8 hours). */
const MAX_SAMPLES = 96;

function sanitizeSamples(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === "object" && Number.isFinite(s.at) && Number.isFinite(s.total))
    .map((s) => ({ at: s.at, total: s.total }))
    .slice(-MAX_SAMPLES);
}

/** Local-time day key "YYYY-MM-DD". */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export class AggregateStore {
  constructor() {
    this.unit = null;
    this.persisted = false;
    this.chain = Promise.resolve();
    this.state = { balanceSamples: [], schemaVersion: SCHEMA_VERSION };
  }

  /**
   * Open the storage unit and hydrate samples. Safe to call once at
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
      // Migration: keep balance samples from any version, drop the rest.
      this.state = {
        balanceSamples:
          g && typeof g === "object" && !Array.isArray(g)
            ? sanitizeSamples(g.balanceSamples)
            : [],
        schemaVersion: SCHEMA_VERSION,
      };
      this.unit = unit;
      this.persisted = true;
    } catch (err) {
      console.warn("[balance] persistence unavailable, memory-only:", err?.message);
    }
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
    if (samples.length > MAX_SAMPLES) samples.shift();
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
      .catch((err) => console.warn("[balance] persist failed:", err?.message));
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
}
