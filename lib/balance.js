/**
 * DeepSeek account-balance client for @pengpeng6845/dsh-balance.
 *
 * The official API exposes no usage-detail endpoint — the balance endpoint
 * (GET /user/balance) is the API-key-verifiable ground truth. Repeated
 * samples let the plugin derive real spend as the sum of balance drops
 * (rises are treated as top-ups and ignored).
 *
 * Zero-dep: uses global fetch (Node 20+); a fetch implementation can be
 * injected for tests. The secret is re-resolved from the credentials seam
 * on every network attempt and never cached or logged.
 *
 * @module @pengpeng6845/dsh-balance/balance
 */

const BACKOFF_INITIAL_MS = 60000;
const BACKOFF_MAX_MS = 300000;

export class BalanceClient {
  /**
   * @param config - { balanceBaseUrl, balanceApiKeyEnv, balanceRefreshMs }
   * @param ctx - cordis context (credentials seam, optional).
   * @param fetchImpl - fetch implementation (test injection).
   */
  constructor(config, ctx, fetchImpl) {
    this.config = config;
    this.ctx = ctx;
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
    this.cache = null;
    this.inflight = null;
    this.nextAttemptAt = 0;
    this.backoffMs = BACKOFF_INITIAL_MS;
  }

  /**
   * Return the current balance, honoring the refresh-interval cache.
   *
   * - Within balanceRefreshMs: cached value, no network.
   * - Concurrent callers share one in-flight request.
   * - After a failure, network attempts back off (60s doubling to 5m)
   *   while the last successful value is still served (possibly stale).
   *
   * @param force - bypass the cache and the backoff window.
   * @returns { currency, totalBalance, grantedBalance, toppedUpBalance,
   *   checkedAt, stale } or null when unavailable.
   */
  async check(force) {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < this.config.balanceRefreshMs) {
      return this.cache.data;
    }
    if (this.inflight) return this.inflight;
    if (!force && now < this.nextAttemptAt) {
      return this.cache ? { ...this.cache.data, stale: true } : null;
    }
    this.inflight = this._doFetch()
      .then((data) => {
        if (data) {
          this.cache = { at: Date.now(), data };
          this.backoffMs = BACKOFF_INITIAL_MS;
        } else {
          this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
          this.nextAttemptAt = Date.now() + this.backoffMs;
        }
        return data;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async _doFetch() {
    const credentials = this.ctx.get("credentials");
    if (!credentials) return null;
    let resolved;
    try {
      resolved = await credentials.resolve(this.config.balanceApiKeyEnv);
    } catch {
      resolved = undefined;
    }
    if (!resolved || !resolved.value) return null;
    try {
      const base = String(this.config.balanceBaseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
      const resp = await this.fetchImpl(base + "/user/balance", {
        headers: { authorization: "Bearer " + resolved.value },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      if (!json || !Array.isArray(json.balance_infos) || json.balance_infos.length === 0) return null;
      // DeepSeek reports one bucket per currency (CNY + USD). Pick the one
      // actually funded so a zero-filled foreign bucket never masquerades
      // as an empty account.
      let info = null;
      let best = -1;
      for (const candidate of json.balance_infos) {
        const total = Number(candidate?.total_balance ?? -1);
        if (total > best) {
          best = total;
          info = candidate;
        }
      }
      if (info === null) return null;
      return {
        currency: String(info.currency ?? "CNY"),
        totalBalance: Number(info.total_balance ?? 0),
        grantedBalance: Number(info.granted_balance ?? 0),
        toppedUpBalance: Number(info.topped_up_balance ?? 0),
        checkedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
