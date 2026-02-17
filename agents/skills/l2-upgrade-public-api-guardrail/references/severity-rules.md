# Severity Rules

## Breaking

- Remove or rename any export in `src/index.ts`.
- Remove any exported config type from `src/interface/configuration/types.ts`.
- Add a required field to an existing exported config type.
- Change an existing field from optional to required.
- Remove a required field from an existing exported config type.

## Additive

- Add a new export in `src/index.ts`.
- Add a new exported config type.
- Add an optional field to an existing exported config type.

## Internal

- Refactor implementation without changing public symbols or required shape contracts.
