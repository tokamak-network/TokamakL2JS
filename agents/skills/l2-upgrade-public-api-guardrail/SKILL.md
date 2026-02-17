---
name: l2-upgrade-public-api-guardrail
description: Guard public API compatibility for TokamakL2JS upgrades. Use when changing exported functions/classes/types, `src/index.ts` export surface, `src/interface/configuration/types.ts`, transaction/state manager public methods, or preparing an npm version bump/release.
---

# Public API Guardrail

Run this skill whenever a change may affect downstream npm consumers.

## Quick Start

```bash
node agents/skills/l2-upgrade-public-api-guardrail/scripts/check-public-api.mjs --base origin/main
```

The script writes:
- Markdown report: `agents/skills/l2-upgrade-public-api-guardrail/out/public-api-report.md`
- JSON report: `agents/skills/l2-upgrade-public-api-guardrail/out/public-api-report.json`

It exits non-zero when a breaking delta is detected.

## Workflow

1. Run `check-public-api.mjs` with a base ref that represents the previous release point.
2. Review `index.ts` export delta:
- removed export => breaking
- added export => additive
3. Review `src/interface/configuration/types.ts` structural delta:
- removed exported type => breaking
- added required field => breaking
- optional -> required => breaking
4. If report contains breaking changes:
- add compatibility alias/wrapper, or
- confirm major-version release decision
5. Run `npm run build` before closing the gate.

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
- `details`: object arrays by category

Use severity rules in `references/severity-rules.md`.
