# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
