# dsh-usage-cost

[![npm](https://img.shields.io/npm/v/dsh-usage-cost)](https://www.npmjs.com/package/dsh-usage-cost)
[![CI](https://img.shields.io/github/actions/workflow/status/PengPeng6845/dsh-usage-cost/ci.yml?branch=main)](https://github.com/PengPeng6845/dsh-usage-cost/actions)
[![license](https://img.shields.io/github/license/PengPeng6845/dsh-usage-cost)](LICENSE)

Token consumption and API cost reporting for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): prices the built-in tokenUsage session projection against a configurable per-model table, folds day/month aggregates into the storage hub, and registers the model-facing token_usage tool.

[中文说明](README.zh.md)

## Features

- **token_usage tool** — the model can check its own consumption mid-task: provider-reported buckets (uncached input / output / cache read / cache write), this session's cost, plus today's and this month's accumulated cost.
- **Real billing data** — reads the tokenUsage projection first (provider-reported, not heuristic); falls back to the token-meter anchor; returns zeros with a note when neither exists.
- **Durable aggregates** — deltas fold into the storage hub's json backend unit usage_cost; degrades to in-memory when the backend is absent. Idempotent by construction (clamped deltas, replayed calls never double-count).
- **Per-model pricing** — lookup order: model id, then provider route, then the "*" fallback entry. Builtin DeepSeek official rates, merged with your config.
- **Zero dependencies** — no npm runtime dependencies, no build step; plain ESM, community-plugin shape (name / inject / apply).

## Install

From npm (recommended):

    dsh plugin --profile web add dsh-usage-cost

From GitHub (unpublished):

    dsh plugin --profile web add github:PengPeng6845/dsh-usage-cost

Then append "dsh-usage-cost" to dsh.profile.bundles in your profile's package.json and restart dsh web (or refresh the page if HMR is enabled).

Or through the in-app plugin market once the package is listed on awesome-dsh-plugin (see below).

## Config

Override in your profile's cordis.patch.yml:

    - id: usage-cost
      config:
        currency: CNY          # CNY / USD / EUR
        persist: true          # persist day/month aggregates
        prices:                # merges over the builtin table
          deepseek-chat:
            inputPerMillion: 2
            cacheReadPerMillion: 0.5
            cacheWritePerMillion: 2
            outputPerMillion: 8

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| currency | string | CNY | Currency symbol used in cost text |
| persist | boolean | true | Persist day/month aggregates to the storage json backend |
| prices | map | DeepSeek official rates | Price per 1M tokens, keyed by model id, provider route, or "*" |

Builtin price table (CNY per 1M tokens; check the provider's official page and update over time):

| Model | Input (miss) | Cache read | Cache write | Output |
| --- | --- | --- | --- | --- |
| deepseek-chat | 2 | 0.5 | 2 | 8 |
| deepseek-reasoner | 4 | 1 | 4 | 16 |

## Development

    npm test          # zero-install unit smoke suite (node test/smoke.mjs)
    npm pack          # produce the distributable tarball

The test suite runs on Node 20 and 22 in CI with no install step.

## Release

    npm login         # once
    npm publish       # then users run: dsh plugin --profile web add dsh-usage-cost

The package lives at the repository root on purpose: single-package layout so both npm installs and github: installs resolve the plugin directly.

## Get listed in the plugin market

The dsh-market registry is curated through [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin). Open a PR adding one entry for this repository to the list; the website and the in-app market pick it up automatically (usually within a day).

## License

[MIT](LICENSE) © 2026 PengPeng6845
