# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-08-20

### Changed

- Near-realtime balance: refresh triggers on token activity (debounced
  20s after the last usage change) in addition to the baseline poll,
  which is now every 60s (was 5m); the widget polls every 15s (was 30s).

## [0.6.0] - 2026-08-20

### Changed

- Estimate engine removed entirely (pricing table, passive projection
  fold, day/month aggregates): the plugin is now a single-purpose balance
  monitor. token_usage reports exact provider token buckets plus the real
  balance — no estimated money anywhere.
- BalanceClient hardened: in-flight request dedup, exponential backoff on
  failure (5s doubling to 5m), stale-cache serving during backoff with a
  stale flag; the first poll waits 2s for the credentials provider to
  finish mounting.
- Widget state machine: 查询中 → 余额/不可用/过期(灰化); polling pauses
  while the tab is hidden; low balance (below lowBalanceAlert, default 5)
  tints the value orange.
- Storage schemaVersion 3: balance samples only (estimate tables dropped
  on migration; samples survive).
- Config: lowBalanceAlert added; currency/prices/fxRate/thresholds
  removed.

## [0.5.0] - 2026-08-20

### Changed

- Renamed to @pengpeng6845/dsh-balance (plugin id balance; bundle entry
  name updated accordingly). The GitHub repo path stays the same.
- The sidebar widget now shows ONLY the real account balance from the
  official /user/balance endpoint (updated every 30s; tooltip carries
  today's real spend from balance drops and the check time). Estimated
  cost rows and threshold coloring are gone.
- The summary endpoint is now GET /dsh-balance/summary and returns
  balance + realTodayCost only.
- Config: warnThreshold/alertThreshold removed. The token_usage tool
  still reports provider tokens plus the real balance; estimated money is
  reported as secondary information only.

## [0.4.0] - 2026-08-20

### Changed (breaking for persisted estimates)

- Pricing table replaced with the official 2026-08-16 peak/off-peak rates:
  v4-flash off-peak hit $0.007 / miss $0.22 / output $0.66, v4-pro $0.022 /
  $0.66 / $1.98; peak windows (UTC 01-04, 06-10) double every rate. The
  previous builtin table (legacy v3-era prices) overstated cache-read cost
  by ~70x — real balance verification (¥15.05 vs estimated ¥25.08/day)
  exposed the drift.
- Table currency is USD; fxRate (default 7.2) converts to the display
  currency (CNY). Store cells keep table currency; conversion happens at
  display time.
- Persisted estimates from pre-0.4.0 versions reset on load (token
  history cannot be repriced per day); balance samples are kept — they
  are real provider money. Unit schemaVersion is now stamped as 2.
- rateLabel now carries a peak/off-peak marker.

## [0.3.0] - 2026-08-20

### Added

- Real account balance via the official GET /user/balance endpoint (the
  provider has no public usage-detail API; balance drops are the API-key-
  verifiable spend). Polled at startup and every balanceRefreshMs, cached
  per request, key re-resolved from the credentials seam per call and never
  logged.
- realTodayCost: sum of balance drops between samples since local midnight
  (rises are top-ups and never count), persisted in the storage unit.
- Widget "余额" row and richer tooltip; token_usage reports balance and
  real spend today alongside the local estimate.

### Config

- balanceEnabled (default true), balanceApiKeyEnv (default
  DEEPSEEK_API_KEY), balanceBaseUrl (default https://api.deepseek.com),
  balanceRefreshMs (default 300000).

## [0.2.0] - 2026-08-20

### Added

- Sidebar cost widget (client plugin): registers into sidebar.footer.action,
  shows today/month cost with token counts, polls GET /usage-cost/summary
  every 10 seconds, tints orange/red past configurable thresholds, and
  renders a compact variant when the sidebar is collapsed.
- Host summary endpoint GET /usage-cost/summary (no session identity needed).
- Passive aggregation: the tokenUsage projection change feed folds into the
  day/month store continuously, so aggregates stay fresh even when the
  token_usage tool is never called; durable writes are debounced (3s).

### Changed

- token_usage now reads aggregates instead of recording them when the
  projection change feed is available (single recorder, no double counting).
- Aggregate rate is the "*" price-table entry; the tool still prices the
  current session with the model-specific rate.
- Config: warnThreshold (default 5) and alertThreshold (default 20).
- Plugin now also injects the timer service for the persist debounce.

## [0.1.0] - 2026-08-14

### Added

- token_usage model tool: provider-reported token buckets (uncached input /
  output / cache read / cache write), session cost, and today/month aggregates.
- Price table with builtin DeepSeek official rates, resolved by model id, then
  provider route, then the "*" fallback entry; user config merges over defaults.
- Durable day/month aggregates over the storage hub's json backend (unit
  usage_cost), with graceful in-memory degradation and idempotent clamped deltas.
- Token-meter heuristic fallback when the session projection is unavailable.
- System-prompt guidance section for the tool.
- Standalone zero-dependency unit smoke test suite (node test/smoke.mjs).
