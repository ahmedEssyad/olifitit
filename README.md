# Liftit

[![npm version](https://img.shields.io/npm/v/@ahmedessyad/liftit)](https://www.npmjs.com/package/@ahmedessyad/liftit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/AhmedEssyad/liftit/actions/workflows/ci.yml/badge.svg)](https://github.com/AhmedEssyad/liftit/actions)

Lift any site's design. Paste a URL, get the code.

```bash
npx liftit https://stripe.com
```

Liftit opens a real browser, extracts every computed style, animation, and interaction from a live website, and converts it into code you can use — Tailwind configs, React components, shadcn themes, or CSS variables. Works on any site regardless of framework.

```
URL
 |
 v
Scanner (Playwright) ──> Analyzer ──> Motion Capture ──> Distiller ──> Exporter
 |                        |            |                  |             |
 DOM + styles             Components   Animations         Compact       tailwind.config.ts
 screenshots (8bp)        CSS arch     Hover states       specs         globals.css
 fonts, images            Patterns     Scroll triggers    from/to       DESIGN.md
 interactions             a11y                            durations     Component.tsx
```

## Install

```bash
npm install -g liftit
npx playwright install chromium
```

## What you can do

### Extract a full design system

```bash
liftit https://stripe.com
```

Captures DOM, computed styles, screenshots at 8 breakpoints, fonts, images, animations, hover states, scroll behaviors, and interactive elements. Produces a complete design system spec.

### Generate a React component from any site

```bash
liftit component https://linear.app header
liftit component https://vercel.com hero --name VercelHero
```

Outputs a working `Header.tsx` + `Header.module.css` with exact styles, hover states, responsive breakpoints, and animations. Paste it into your Next.js project.

### Make your component match a target

```bash
liftit match https://linear.app header --file ./src/Navbar.module.css
```

Reads your existing CSS, extracts the target, and tells you exactly what to change:

```
.nav -> root (nav)
  CHANGE  padding: 0px 24px -> 12px 40px
  CHANGE  border-radius: 5px -> 10px
  ADD     backdrop-filter: blur(35px)
```

Writes a patched CSS file ready to replace yours.

### Export to your framework

```bash
liftit export tailwind          # tailwind.config.ts
liftit export shadcn            # globals.css + tailwind.config.ts (light + dark mode)
liftit export css-variables     # design-tokens.css with :root custom properties
liftit export design-md         # DESIGN.md for AI coding agents (Stitch-compatible)
liftit export all               # everything
```

### Generate a DESIGN.md

```bash
liftit https://linear.app
liftit export design-md
```

Produces a [Stitch-compatible](https://github.com/VoltAgent/awesome-design-md) `DESIGN.md` — the format AI coding agents read to generate on-brand UI. Drop it into any project and tell Cursor, Claude, or Copilot to build matching pages.

Unlike hand-curated DESIGN.md files, Liftit's version includes full animation specs (entrance reveals, scroll-linked transitions, hover effects with exact from/to values and scroll trigger points), interaction patterns, and responsive behavior — all from real computed styles.

### Quick token extraction

```bash
liftit tokens https://cal.com
```

Colors, typography, spacing, shadows in ~5 seconds. No full pipeline needed.

### Scan with multi-page crawling

```bash
liftit scan https://stripe.com --crawl
```

Discovers and scans up to 20 internal pages. Supports auth cookies and headers for protected sites.

## Claude Code Integration

```bash
liftit setup
```

One command registers the MCP server with Claude Code. Then talk naturally:

- "Extract the design system from this URL"
- "Generate a React component from Stripe's pricing section"
- "Make my navbar CSS match Linear's header"
- "Give me a Tailwind config from the tokens you extracted"

16 MCP tools available — extraction, component generation, matching, export (including DESIGN.md), validation, and browser interaction.

## How it works

1. **Scan** — Playwright captures the full DOM with 76 computed CSS properties per element, screenshots at 8 viewports, all fonts/images/SVGs, API calls
2. **Analyze** — CSS architecture detection (BEM, Tailwind, Modules), component detection via 4 strategies (semantic roles, structural patterns, style clustering, class names)
3. **Motion Capture** — Scrolls the page recording style changes at every position across 3 viewports. Hovers interactive elements frame by frame. Captures Web Animations API data
4. **Interactions** — Catalogs navigation, toggles, modals, dropdowns, forms, scroll behaviors
5. **Scroll-Interaction Mapping** — Connects animations to interactivity. Discovers which scroll animations produce or remove interactive elements
6. **Distill** — Compresses raw motion data into compact animation specs with from/to values, triggers, durations
7. **Assets** — Copies fonts, images, SVGs into your project with @font-face CSS generation
8. **Synthesize** — AI reads all data and produces structured design system JSON + human-readable spec
9. **Validate** — Pixel-level comparison (pixelmatch, 0.1 threshold) with DOM and interaction verification

Steps 2-4 run in parallel.

## CLI Reference

```
liftit <url> [output-dir]                         Full extraction pipeline
liftit component <url> <name> [--output dir]      Generate React component
liftit match <url> <name> --file <css>            Diff your CSS against target
liftit export <format> [--input dir]              Export tokens
liftit tokens <url>                               Quick token extraction
liftit scan <url> [--crawl]                       Scan only
liftit validate <url> [--rebuild] [--site]        Pixel validation
liftit mcp                                        Start MCP server
liftit setup                                      Register with Claude Code
```

### Flags

```
--crawl                Multi-page crawling (up to 20 pages)
--auth-cookie "k=v"    Auth cookie for protected sites
--auth-header "K: V"   Auth header for protected sites
--output <dir>         Output directory
--input <dir>          Input directory (for export)
--name <Name>          Custom component name
--file <path>          Your CSS file (for match)
--map "a=b,c=d"        Manual class mapping (for match)
--rebuild-url <url>    Dev server URL for validation
```

## Output

```
output/
  design-system.json        Structured tokens + components
  design-system.md          Human-readable rebuild spec
  scan-result.json          Raw DOM and computed styles
  analysis-result.json      Component detection, CSS architecture
  motion-distilled.json     Compact animation specs
  scroll-interactions.json  Animation-to-interaction links
  interactions.json         Interactive behavior catalog
  screenshots/              Reference screenshots (8 breakpoints)
  assets/                   Downloaded fonts, images, SVGs
  export/                   Framework configs (Tailwind, shadcn, CSS vars, DESIGN.md)
  components/               Generated React components
```

## Configuration

Create a `.liftitrc.json` in your project root (or home directory) to override defaults:

```json
{
  "browser": {
    "breakpoints": [375, 768, 1440],
    "viewportHeight": 900
  },
  "scan": {
    "maxElements": 50000,
    "maxPages": 20
  },
  "validation": {
    "pixelmatchThreshold": 0.1
  }
}
```

All settings are optional — only include what you want to override. See `scripts/config.ts` for the full schema.

### Brand Overrides

Create a `.liftit-brand.json` (or pass `--brand <path>`) to swap extracted colors/fonts with your own:

```json
{
  "colors": {
    "primary": "#1a73e8",
    "background": "#ffffff",
    "text": "#1a1a1a"
  },
  "fonts": {
    "body": "Inter",
    "heading": "Inter Display"
  },
  "content": {
    "Acme Corp": "Your Company"
  }
}
```

## Requirements

- Node.js 18+
- Playwright (`npx playwright install chromium`)

## License

MIT
