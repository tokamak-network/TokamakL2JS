# Severity Rules

## Breaking

- Remove or rename any symbol exported via `src/index.ts`.
- Change exported function signature.
- Remove or change exported class constructor signature.
- Remove exported public class method.
- Change exported public class method signature.
- Remove exported config type from `src/interface/configuration/types.ts`.
- Add required field to an existing exported config type.
- Change existing config field from optional to required.
- Remove required field from existing exported config type.

## Additive

- Add new symbol exported via `src/index.ts`.
- Add new exported class constructor overload.
- Add new exported public class method.
- Add new exported config type.
- Add optional field to existing exported config type.

## Internal

- Refactor implementation without changing exported symbol signatures.
