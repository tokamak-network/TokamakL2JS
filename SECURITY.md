# Security Policy

## Reporting a Vulnerability

Please do not disclose security issues in public GitHub issues.

Use GitHub Security Advisories for private reporting when available:

- https://github.com/tokamak-network/TokamakL2JS/security/advisories/new

If the advisory flow is unavailable, open a minimal issue requesting a private contact channel without sharing exploit details.

## Scope

Security reports are especially relevant for:

- Transaction signing and verification code (`src/tx`, `src/crypto`)
- State manager and Merkle-tree logic (`src/stateManager`)
- Public APIs exported from `src/index.ts`

## Response Expectations

Maintainers will triage valid reports and coordinate remediation and disclosure timing.
