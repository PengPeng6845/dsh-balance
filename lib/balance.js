/**
 * DeepSeek account-balance client for dsh-usage-cost.
 *
 * The official API exposes no usage-detail endpoint — the balance endpoint
 * (GET /user/balance) is the API-key-verifiable ground truth. Repeated
 * samples let the plugin derive real spend as the sum of balance drops
 * (rises are treated as top-ups and ignored).
 *
 * Zero-dep: uses global fetch (Node 20+). The secret is re-resolved from
 * the credentials seam on every check and never cached or logged.
 *
 * @module dsh-usage-cost/balance
 */

export class BalanceClient {
  /**
   * @param config - { balanceBaseUrl, balanceApiKeyEnv, balanceRefreshMs }
   * @param ctx - cordis context (credentials seam, optional).
   */
  constructor(config, ctx) {
    this.config = config;
    this.ctx = ctx;
    this.cache = null;
  }

  /**
   * Fetch the current balance, honoring the refresh-interval cache.
   *
   * @param force - bypass the cache.
   * @returns { currency, totalBalance, grantedBalance, toppedUpBalance,
   *   checkedAt } or null when the key, network, or shape is unavailable.
   */
  async check(force) {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < this.config.balanceRefreshMs) {
      return this.cache.data;
    }
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
      const resp = await fetch(base + "/user/balance", {
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
      const data = {
        currency: String(info.currency ?? "CNY"),
        totalBalance: Number(info.total_balance ?? 0),
        grantedBalance: Number(info.granted_balance ?? 0),
        toppedUpBalance: Number(info.topped_up_balance ?? 0),
        checkedAt: now,
      };
      this.cache = { at: now, data };
      return data;
    } catch {
      return null;
    }
  }
}
