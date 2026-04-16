# Liftit — Design System Extractor

Lift any site's design. Paste a URL, get the code.

Multi-agent system that extracts design systems from live websites, exports them as framework-ready config files, generates working React components, and diffs against your existing code to tell you exactly what to change.

## Architecture

```
URL → Scanner → [Analyzer + Motion + Interactions] (parallel) → Scroll-Interactions → Distiller → Patterns → Assets → Synthesizer → Validator
       (Playwright)   (Playwright × 3, concurrent)               (Playwright)          (Node.js)   (Node.js)  (Node.js) (Claude AI)   (Playwright)

Extraction Output → Export Adapters    → tailwind.config.ts / design-tokens.css / shadcn theme
                  → Component Generator → ComponentName.tsx + ComponentName.module.css
                  → Component Matcher   → style diff report + patched CSS file
```

### Pipeline Scripts

- **Utilities** (`scripts/utils.ts`): Shared foundation — `withBrowser` (guaranteed cleanup), `withRetry` (exponential backoff), `safeReadJSON` (structured errors), `PipelineError`, structured logger
- **Scanner** (`scripts/scan.ts`): Extracts complete DOM, computed styles, screenshots at 8 breakpoints, fonts, images, colors, typography, spacing, animations, interaction states, API calls (XHR/fetch), login wall detection. Supports multi-page crawling, auth, cookie consent dismissal, lazy content loading. Responsive snapshots use diff-based storage vs 1440px reference.
- **Analyzer** (`scripts/analyze.ts`): CSS architecture (via css-tree AST), multi-layered component detection (role-based → structural → style clustering → regex) with CMS-driven content flagging, responsive patterns, forms, accessibility
- **Motion Capture** (`scripts/capture-motion.ts`): JS-driven animation capture at 3 representative viewports (375, 768, 1440). Deduplicates frames during capture — only records when styles change. Scroll-triggered transforms, hover transitions, Web Animations API, intersection observer triggers
- **Interaction Extractor** (`scripts/extract-interactions.ts`): Catalogs all interactive behaviors — navigation, toggles/accordions, modals, dropdowns, forms (with API/client-side classification), scroll behaviors
- **Scroll-Interaction Mapper** (`scripts/capture-scroll-interactions.ts`): At key scroll positions (derived from motion capture trigger points), identifies visible interactive elements, captures their hover states, and diffs between positions to discover animations that produce/remove interactive elements (e.g., navbar collapse reveals dot navigation, project card fly-in creates hoverable links)
- **Motion Distiller** (`scripts/distill-motion.ts`): Compresses raw motion data (66MB+) into compact animation spec (~22KB). Classifies animations as entrance, scroll-linked, hover, focus, continuous, or parallax. Incorporates scroll-interaction data to annotate animations with what they produce/remove.
- **Pattern Classifier** (`scripts/classify-patterns.ts`): Display pattern intelligence — reads all extraction data and classifies section types (hero, pricing, testimonials, case-studies, etc.), layout strategies (grid, carousel, timeline, split, bento), content patterns (card-grid, accordion, tabs, pricing-table), animation intent (entrance-reveal, staggered, parallax-depth), responsive strategies, and information hierarchy. Uses heuristic classifiers with optional Claude API refinement for ambiguous cases.
- **Asset Pipeline** (`scripts/copy-assets.ts`): Copies fonts/images/SVGs into rebuild project, generates @font-face CSS, produces asset manifest
- **Synthesizer** (`scripts/orchestrate.ts` via Claude API): Automatically reads all extraction data, calls Claude API, produces `design-system.json` + `design-system.md`
- **Validator** (`scripts/validate.ts`): Pixel-level comparison of rebuild vs original screenshots (pixelmatch), DOM verification, style comparison, interaction state checking. Reports failed comparisons explicitly with error tracking
- **Orchestrator** (`scripts/orchestrate.ts`): Runs pipeline steps in-process (no subprocesses). Steps 2-4 run in parallel via `Promise.allSettled`. Step 6 calls Claude API directly for synthesis. Structured step results with timing

### Export Adapters (`scripts/adapters/`)

- **Reader** (`reader.ts`): Reads `design-system.json` (primary) or `scan-result.json` (fallback), normalizes into common shape for all adapters
- **Tailwind** (`tailwind.ts`): Generates `tailwind.config.ts` — colors (hex), font families (classified by type), fontSize tuples (with lineHeight + letterSpacing), spacing, border-radius, shadows, screens, zIndex
- **CSS Variables** (`css-variables.ts`): Generates `design-tokens.css` — `:root` block with all tokens as named CSS custom properties. Supports optional prefix.
- **shadcn/ui** (`shadcn.ts`): Generates `globals.css` (HSL variables, light + dark mode mapped to shadcn semantic slots) + `tailwind.config.ts` (shadcn color structure, animated radius, fonts, shadows)
- **Component Code Generator** (`component-codegen.ts`): Takes extraction output → produces working React `.tsx` + CSS Module `.module.css`. Filters browser default styles, generates semantic class names, handles hover states (CSS `:hover` for simple, framer-motion for complex), responsive media queries.
- **Component Differ** (`component-differ.ts`): "Make Mine Match" engine. Parses user's CSS module via css-tree AST, matches classes to extracted elements (4-tier scoring: manual → name similarity → style overlap → structural), diffs properties (CHANGE/ADD/REMOVE), generates patched CSS file.
- **Utilities** (`utils.ts`): Color conversion (rgb→hex, rgb→hsl), spacing/radius naming, font classification

### Rebuild

- **Rebuilder** (`/rebuild` command): Takes design system output and generates a complete Next.js project in `rebuild/`

## Commands

- `/extract <url>` — Run the full extraction pipeline on a URL
- `/rebuild` — Generate a Next.js project from extracted design system

## Running Scripts Directly

```bash
# Full pipeline
npx ts-node scripts/orchestrate.ts <url> [output-dir] [options]

# Individual extraction steps
npx ts-node scripts/scan.ts <url> [output-dir] [--crawl] [--auth-cookie "k=v"] [--auth-header "K: V"]
npx ts-node scripts/analyze.ts <url> [output-dir]
npx ts-node scripts/capture-motion.ts <url> [output-dir]
npx ts-node scripts/extract-interactions.ts <url> [output-dir]
npx ts-node scripts/capture-scroll-interactions.ts <url> [output-dir]
npx ts-node scripts/distill-motion.ts [output-dir]
npx ts-node scripts/copy-assets.ts [output-dir] [rebuild-dir]
npx ts-node scripts/validate.ts <url> [output-dir] [--rebuild --rebuild-url URL] [--site] [--diff]

# Export to framework configs
npx ts-node scripts/export.ts <tailwind|css-variables|shadcn|design-md|all> [--input dir] [--output dir] [--prefix str]

# Generate a React component from a URL
npx ts-node scripts/generate-component.ts <url> <component> [--output dir] [--name ComponentName]

# Diff your CSS against a target site's component
npx ts-node scripts/match-component.ts <url> <component> --file <css-file> [--map "a=b,c=d"]
```

## CLI Flags

```
--crawl                Enable multi-page crawling (scan.ts, orchestrate.ts)
--auth-cookie "k=v"    Set auth cookie before scanning
--auth-header "K: V"   Set auth header for requests
--rebuild              Validate rebuild instead of live site (validate.ts, default)
--rebuild-url <url>    URL of running rebuild (default: http://localhost:3000)
--site                 Validate live site against stored scan data
--diff                 Incremental validation — produces corrections-needed.json
--full                 Run complete pipeline including rebuild validation
--step <step>          Run specific step: scan, analyze, motion, interactions, scroll-interactions, distill, assets, synthesize, validate
--input <dir>          Input directory for export adapters (default: ./output)
--output <dir>         Output directory for export/generate/match (default: ./output/export)
--prefix <str>         CSS variable prefix for css-variables export (e.g., "ds" → --ds-color-primary)
--name <Name>          Custom component name for generate-component
--file <path>          Your CSS module file for match-component
--map "a=b,c=d"        Manual class mapping for match-component
```

## MCP Tools (18 tools)

| Tool | What it does |
|------|-------------|
| `extract_design_system` | Full extraction pipeline → design tokens, components, animations |
| `extract_component` | Targeted component scan → styles, hover, responsive, animations |
| `get_design_tokens` | Quick token extraction (~5s) → colors, typography, spacing |
| `generate_component` | Extract + generate working React component (.tsx + .module.css) |
| `match_component` | Diff your CSS against a target → style report + patched file |
| `export_tailwind` | Design tokens → tailwind.config.ts |
| `export_css_variables` | Design tokens → design-tokens.css (:root custom properties) |
| `export_shadcn` | Design tokens → shadcn/ui globals.css + tailwind.config.ts |
| `export_design_md` | Design tokens + animations + patterns → Stitch-compatible DESIGN.md for AI agents |
| `copy_assets` | Copy fonts/images/SVGs + generate @font-face CSS |
| `run_pipeline` | Full orchestrated pipeline (scan → analyze → validate) |
| `validate_rebuild` | Pixel-level rebuild vs original comparison |
| `validate_site` | Site consistency / drift check |
| `validate_diff` | Incremental diff with severity-ranked corrections |
| `get_display_patterns` | Classified section types, layout strategies, content patterns, animation intent |
| `describe_extraction` | Current extraction state, detected components, available next steps |
| `suggest_workflow` | Recommended tool sequence for a given goal |
| `interact` | Browser interactions (click/type/hover/scroll) with state capture |

## Output Directory Structure

```
output/
├── scan-result.json          # Raw extraction (DOM, styles, colors, fonts)
├── analysis-result.json      # Structural analysis (components, patterns)
├── motion-capture.json       # JS-driven animation data (deduplicated)
├── motion-distilled.json     # Compact animation spec (from distiller)
├── scroll-interactions.json  # Scroll-state interaction map (animation → interaction links)
├── interactions.json         # Interactive behavior catalog
├── display-patterns.json     # Section types, layout strategies, content patterns, animation intent
├── dynamic-content.json      # API endpoints, CMS indicators, auth detection
├── design-system.json        # Synthesized design tokens + components
├── design-system.md          # Human-readable rebuild spec
├── validation-report.json    # Site consistency check
├── rebuild-validation-report.json  # Rebuild vs original comparison
├── corrections-needed.json   # Specific fixes needed in rebuild
├── site-map.json             # Page list (crawl mode only)
├── screenshots/              # Reference screenshots at 8 breakpoints
├── assets/                   # Downloaded fonts, images, SVGs
├── diffs/                    # Pixel diff images from validation
├── export/                   # Framework-specific config files
│   ├── tailwind/             # tailwind.config.ts
│   ├── css-variables/        # design-tokens.css
│   └── shadcn/               # globals.css + tailwind.config.ts
├── components/               # Generated React components
│   └── ComponentName/        # .tsx + .module.css
└── pages/                    # Per-page scan data (crawl mode only)
    └── <page-slug>/
        └── scan-result.json
```

## Accuracy Standard

100% accuracy target. All values are exact computed styles — no rounding, no approximation. Screenshot match threshold: 0.1 (pixelmatch).
