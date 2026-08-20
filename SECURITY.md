# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in @pengpeng6845/dsh-balance,
please report it privately via the GitHub Security Advisory ("Report a
vulnerability") tab of this repository instead of opening a public issue.

## Scope

The plugin runs inside your local DeepSeek Harness process:

- It reads the API key from the credentials seam (an environment variable
  reference such as DEEPSEEK_API_KEY), never from files it writes, and
  re-resolves it per request without caching the secret.
- It makes one HTTPS call every five minutes to the provider's official
  GET /user/balance endpoint and sends nothing else anywhere.
- It writes balance samples (numbers only, never the key) to the storage
  hub's json backend unit usage_cost.

## Supported Versions

Only the latest release is supported. Please upgrade before reporting.
