# Contributing to TokamakL2JS

Thanks for contributing to TokamakL2JS.

## Development Setup

1. Use Node.js `>=18` (see `package.json`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Contribution Guidelines

1. Open an issue for bugs, feature requests, or API changes before large work.
2. Keep pull requests focused and minimal in scope.
3. Preserve backward compatibility for public exports from `src/index.ts` unless a breaking change is explicitly intended.
4. Add or update examples when behavior changes affect users.
5. Ensure `npm run build` passes before requesting review.

## Pull Request Checklist

- [ ] Code compiles with `npm run build`
- [ ] Public API impact is documented
- [ ] Relevant docs/examples are updated
- [ ] Commit history is clear and reviewable
