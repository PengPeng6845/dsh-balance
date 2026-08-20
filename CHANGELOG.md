# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
