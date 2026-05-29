# Security Policy

## Supported versions

`@liqhtworks/sophon-sdk` is pre-1.0. Security fixes land on the latest `0.x`
release line; please upgrade to the newest published version before reporting.

| Version | Supported |
|---------|-----------|
| latest `0.1.x` | ✅ |
| older `0.x` | ❌ (upgrade to latest) |

Once `1.0.0` ships, this table will track the supported major lines.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately using GitHub's **"Report a vulnerability"** button under the
repository's [Security tab](https://github.com/Liqhtworks/sophon-sdk-typescript/security)
(GitHub Private Vulnerability Reporting). If private reporting is unavailable to
you, contact the Liqhtworks maintainers through the repository rather than
filing public details.

Please include:

- the SDK version and runtime (Node version / browser),
- a description of the issue and its impact,
- and a minimal reproduction if possible.

## What to expect

- **Acknowledgement** of your report as soon as we can triage it.
- An assessment and, where warranted, a coordinated fix and release.
- Credit in the release notes if you'd like it (let us know).

Please give us a reasonable window to remediate before any public disclosure.

## Scope

This repository is the **client SDK** only. Issues in the SOPHON encoding
service or API (`api.liqhtworks.xyz`) — authorization, tenant isolation,
rate limiting, billing — should be reported to Liqhtworks through the same
private channel; they are not fixed in this package.

When reporting against the SDK, the highest-value areas are: handling of the
API key (it must never be logged or sent over an unencrypted connection or in a
URL), webhook signature verification, and the output-download redirect
handling.
