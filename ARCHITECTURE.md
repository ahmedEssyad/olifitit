# Architecture

## Pipeline Flow

```
URL
 |
 v
Scanner (Playwright)
 |  DOM, computed styles, screenshots (8 breakpoints),
 |  fonts, images, colors, animations, API calls
 |
 +---> Analyzer (css-tree AST)
 |       CSS architecture, component detection,
 |       responsive patterns, forms, accessibility
 |
 +---> Motion Capture (Playwright)
 |       Scroll-triggered transforms, hover transitions,
 |       Web Animations API, intersection observers
 |
 +---> Interaction Extractor (Playwright)
 |       Navigation, toggles, modals, dropdowns,
 |       forms, scroll behaviors
 |
 v
Scroll-Interaction Mapper
 |  Connects animations to interactivity
 |
 v
Motion Distiller
 |  Compresses raw motion data into compact specs
 |  Classifies: entrance, scroll-linked, hover, parallax
 |
 v
Pattern Classifier
 |  Section types (hero, pricing, testimonials)
 |  Layout strategies (grid, carousel, bento)
 |  Content patterns, animation intent
 |
 v
Asset Pipeline
 |  Copies fonts/images/SVGs, generates @font-face CSS
 |
 v
Export Adapters ──> tailwind.config.ts
                    globals.css (shadcn)
                    design-tokens.css
                    DESIGN.md
                    Component.tsx + Component.module.css
```

Steps 2-4 run in parallel via `Promise.allSettled`.

## Module Structure

```
src/
  core/           Shared foundation
    types/          Type definitions (scanner, analyzer, motion, etc.)
    errors.ts       Typed error hierarchy (PipelineError base)
    logger.ts       Structured logger with level filtering
    utils.ts        Browser lifecycle, retry, file I/O helpers
    config.ts       Zod-validated configuration with deep merge
    security.ts     URL validation, path traversal protection
    browser.ts      Playwright timeout/abort utilities

  scan/            Extraction (Playwright)
    index.ts         Main scanner entry point
    analyze.ts       CSS + component + a11y analysis
    analyze-css.ts   CSS architecture detection (css-tree AST)
    analyze-accessibility.ts  Accessibility audit
    capture-motion.ts    JS-driven animation capture
    capture-scroll-interactions.ts  Scroll-state mapping
    extract-interactions.ts  Interactive behavior catalog
    elements.ts      DOM element extraction
    animations.ts    CSS animation extraction
    cookies.ts       Cookie consent dismissal
    lazy-content.ts  Lazy content triggering
    crawl.ts         Multi-page crawling
    validate.ts      Pixel-level validation (pixelmatch)

  transform/       Post-processing
    distill-motion.ts     Motion data compression
    classify-patterns.ts  Display pattern classification
    copy-assets.ts        Asset pipeline

  export/          Output generation
    adapters/
      reader.ts           Unified data reader for all adapters
      tailwind.ts         Tailwind config generator
      shadcn.ts           shadcn/ui theme generator
      css-variables.ts    CSS custom properties generator
      design-md.ts        DESIGN.md generator (Stitch-compatible)
      component-codegen.ts  React component generator
      vue-codegen.ts      Vue 3 component generator
      svelte-codegen.ts   Svelte component generator
      component-differ.ts "Make Mine Match" CSS differ
      codegen-shared.ts   Shared codegen utilities
      utils.ts            Color conversion, naming helpers
    export.ts         CLI dispatcher for all adapters
    generate-component.ts  Component extraction + generation
    generate-project.ts    Full Next.js project generator
    match-component.ts     CSS matching CLI

  mcp/             MCP server tools
    tools.ts         Tool definitions (JSON Schema)
    schemas.ts       Zod input schemas
    helpers.ts       Response formatting utilities
    handlers/        One file per tool (18 handlers)

  cli/             Entry points
    orchestrate.ts     Pipeline orchestration
    mcp-server.ts      MCP stdio server
    interactive-cli.ts REPL interface

  brand/           Brand management
    brand.ts           Brand config, color/font mapping
    extract-brand.ts   Brand detection from project
    scan-project.ts    Project component scanning

  extras/          Optional features
    performance.ts     Performance analysis
    accessibility.ts   Full a11y audit
    cross-browser.ts   Cross-browser testing
    github-action.ts   GitHub Action entry point
```

## Data Flow

| Stage | Reads | Produces |
|-------|-------|----------|
| Scanner | URL (live page) | `scan-result.json`, `screenshots/`, `assets/` |
| Analyzer | `scan-result.json` | `analysis-result.json` |
| Motion Capture | URL (live page) | `motion-capture.json` |
| Interactions | URL (live page) | `interactions.json` |
| Scroll Mapper | `motion-capture.json`, URL | `scroll-interactions.json` |
| Distiller | `motion-capture.json` | `motion-distilled.json` |
| Patterns | `scan-result.json`, all above | `display-patterns.json` |
| Assets | `scan-result.json` | `assets/` copied, manifest |
| Export | `scan-result.json` or `design-system.json` | `export/tailwind/`, `export/shadcn/`, etc. |

## Adding a New Export Adapter

1. Create `src/export/adapters/your-adapter.ts`
2. Follow the pattern:

```typescript
export interface YourOptions {
  outputDir: string;
  // adapter-specific options
}

export function generateYourFormat(data: DesignData, opts: YourOptions): string {
  // Build output string
  // Write to disk
  // Return file path
}
```

3. Add to `src/export/export.ts` dispatcher
4. Add MCP handler in `src/mcp/handlers/`
5. Add tool definition in `src/mcp/tools.ts`
6. Add tests in `tests/export/adapters/`

## Key Design Decisions

- **Options objects everywhere** — never positional args, always `fn(data, opts)`
- **Typed errors** — `PipelineError` hierarchy, not raw `throw new Error()`
- **Structured logging** — `log(step, level, message)`, not `console.log`
- **No base classes for adapters** — interface-based, each adapter is independent
- **Playwright lifecycle managed by core** — `withBrowser()` guarantees cleanup
- **Zod schemas for all MCP inputs** — validated at handler entry, not in business logic
