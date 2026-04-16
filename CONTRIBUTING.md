# Contributing to Liftit

Thanks for your interest in contributing. Here's how to get started.

## Setup

```bash
git clone https://github.com/AhmedEssyad/liftit.git
cd liftit
npm install
npx playwright install chromium
```

## Development

```bash
# Run the full pipeline
npx ts-node src/cli/orchestrate.ts https://example.com

# Run individual steps
npx ts-node src/scan/cli.ts https://example.com
npx ts-node src/export/export.ts tailwind --input ./output

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run build
```

## Architecture

```
src/
  core/        Shared foundation: types, errors, logger, browser utils, config
  scan/        Playwright-based extraction (DOM, styles, animations, interactions)
  transform/   Post-processing (motion distiller, pattern classifier, synthesizer)
  export/      Output adapters (Tailwind, shadcn, CSS vars, codegen, DESIGN.md)
  mcp/         MCP server tools and handlers
  brand/       Brand extraction and smart adoption
  cli/         CLI entry points and orchestration
  extras/      Performance, accessibility, cross-browser testing
```

Pipeline flow: `scan/ -> transform/ -> export/`

Each export adapter follows the same pattern:

```typescript
export function generate*(data: DesignData, opts: *Options): string
```

Each MCP handler follows:

```typescript
export async function handle*(rawArgs: unknown) {
  const args = validateArgs(Schema, rawArgs);
  // ... business logic ...
  return textResponse(...);
}
```

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test` and `npm run build` to verify
4. Open a pull request with a clear description

## Code Style

- TypeScript strict mode — no `any` types
- Use the structured logger from `src/core/logger.ts`, not `console.log`
- Options objects for function parameters, not positional args
- Errors use typed classes from `src/core/errors.ts`

## Environment Variables

- `ANTHROPIC_API_KEY` — optional. Enables AI-powered synthesis and pattern classification. The pipeline works without it, producing token-only output.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
