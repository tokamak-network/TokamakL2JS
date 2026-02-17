---
name: upgrade-public-api-guardrail
description: Guard public API compatibility for TokamakL2JS upgrades. Use when changing APIs exported through `src/index.ts`, including exported functions, exported classes, class constructors, class member methods, and public configuration types.
---

# Public API Guardrail

Run this skill whenever a change may affect npm consumers.

## Quick Start

```bash
node agents/skills/upgrade-public-api-guardrail/scripts/check-public-api.mjs --base origin/main
```

The script writes:
- Markdown report: `agents/skills/upgrade-public-api-guardrail/out/public-api-report.md`
- JSON report: `agents/skills/upgrade-public-api-guardrail/out/public-api-report.json`

It exits non-zero when breaking API deltas are detected.

## Scope

This guardrail treats the following as public API when reachable from `src/index.ts`:
- exported functions
- exported classes
- exported class constructors
- exported public class member methods

It also validates breaking shape changes in `src/interface/configuration/types.ts`.

## Workflow

1. Run `check-public-api.mjs` with a base ref representing the previous release point.
2. Review symbol-level delta for exports from `src/index.ts`.
3. Review constructor/method deltas for exported classes.
4. Review configuration type shape deltas.
5. If report contains breaking changes, require compatibility shim or major-version decision.

## Inputs

- `--base <git-ref>`: comparison base (default: `HEAD~1`)
- `--report <path>`: markdown output path
- `--json <path>`: machine-readable output path

## Output Contract

JSON report schema:
- `baseRef`: string
- `headRef`: string
- `breaking`: number
- `additive`: number
- `internal`: number
- `details`: object with symbol/class/type deltas

Use severity rules in `references/severity-rules.md`.
