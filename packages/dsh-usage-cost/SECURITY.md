# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in dsh-usage-cost, please
report it privately via the GitHub Security Advisory ("Report a vulnerability")
tab of this repository instead of opening a public issue.

## Scope

The plugin runs inside your local DeepSeek Harness process:

- It reads token-usage data already produced by the harness and writes
  aggregate counters into the storage hub's json backend.
- It makes no network requests and sends no data anywhere.
- Prices come from local configuration, never from the network.

## Supported Versions

Only the latest release is supported. Please upgrade before reporting.
