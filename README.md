# @pengpeng6845/dsh-balance

[![CI](https://img.shields.io/github/actions/workflow/status/PengPeng6845/dsh-usage-cost/ci.yml?branch=main)](https://github.com/PengPeng6845/dsh-usage-cost/actions)
[![license](https://img.shields.io/github/license/PengPeng6845/dsh-usage-cost)](LICENSE)

Real API balance in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sidebar: polls the official /user/balance endpoint with your API key and shows only real, verifiable numbers — no estimates.

[中文说明](README.zh.md)

## Features

- **Sidebar balance widget** — one flat native-style row "余额 ¥13.94" in the sidebar footer, refreshed every 30s; tooltip carries today's real spend (sum of balance drops) and the check time; the collapsed rail shows just the amount.
- **API-key verified** — the balance comes from the official endpoint (real billing data). Drops between samples are real spend; top-up rises never count.
- **token_usage tool** — kept as a bonus: the model can self-report exact provider token buckets plus the real balance; estimated money is secondary only.
- **Zero dependencies** — no npm runtime deps, no build step; plain ESM host plus a hand-written client bundle.

## Install

From npm (once published):

    dsh plugin --profile web add @pengpeng6845/dsh-balance

From GitHub:

    dsh plugin --profile web add github:PengPeng6845/dsh-usage-cost

Then make sure "@pengpeng6845/dsh-balance" is in dsh.profile.bundles in your profile's package.json and restart dsh web.

## Config

Override in your profile's cordis.patch.yml:

    - id: balance
      config:
        balanceEnabled: true
        balanceApiKeyEnv: DEEPSEEK_API_KEY
        balanceBaseUrl: https://api.deepseek.com
        balanceRefreshMs: 300000

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| balanceEnabled | boolean | true | Poll the official balance endpoint |
| balanceApiKeyEnv | string | DEEPSEEK_API_KEY | Credential-ref env name holding the API key |
| balanceBaseUrl | string | https://api.deepseek.com | Balance API base |
| balanceRefreshMs | number | 300000 | Balance poll interval (ms) |

Balance is displayed in the account currency with no FX conversion.

## Development

    npm test          # zero-install unit smoke suite (node test/smoke.mjs)
    npm pack          # produce the distributable tarball

The test suite runs on Node 20 and 22 in CI with no install step.

## Get listed in the plugin market

Open a PR adding this repository to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

## License

[MIT](LICENSE) © 2026 PengPeng6845
