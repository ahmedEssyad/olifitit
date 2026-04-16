# Extract Design System from URL

You are the orchestrator for a multi-agent design system extraction pipeline. Given a website URL, you coordinate Scanner, Analyzer, Motion Capture, Interaction Extractor, Synthesizer, and Validator agents to produce a complete, pixel-perfect design system specification.

## Input

The user provides a URL: $ARGUMENTS

## Pipeline

### Step 1: Scanner (Playwright)

Run the scanner to extract all raw site data:

```bash
cd /Users/admin/Desktop/Projects/other/design-system-extractor
npx ts-node scripts/scan.ts "$URL" "./output"
```

Add `--crawl` if the user wants multi-page extraction.
Add `--auth-cookie "name=value"` or `--auth-header "Key: Value"` for authenticated sites.

This captures:
- Complete DOM tree with computed styles for every element
- Screenshots at 8 breakpoints (320, 375, 414, 768, 1024, 1280, 1440, 1920px)
- All fonts, images, SVGs downloaded
- All CSS files (external + inline)
- Color palette, typography map, spacing values
- Interaction states (hover, focus, active)
- Animation keyframes
- Cookie consent auto-dismissed, lazy content auto-triggered

Wait for completion and verify `output/scan-result.json` exists.

### Step 2: Analyzer (Playwright)

Run deep structural analysis:

```bash
npx ts-node scripts/analyze.ts "$URL" "./output"
```

This produces:
- CSS architecture analysis via css-tree AST (methodology, naming, custom properties, @layer, @container)
- Multi-layered component detection (role-based → structural → style clustering → regex)
- Animation/transition patterns
- Responsive patterns across breakpoints
- Form patterns and validation
- Accessibility audit

Wait for completion and verify `output/analysis-result.json` exists.

### Step 2.5: Motion Capture (Playwright)

Capture JS-driven animations:

```bash
npx ts-node scripts/capture-motion.ts "$URL" "./output"
```

This captures scroll-triggered transforms, hover transitions, Web Animations API data, and intersection observer triggers. Optional — if it fails, continue the pipeline.

### Step 2.7: Interaction Extraction (Playwright)

Catalog all interactive behaviors:

```bash
npx ts-node scripts/extract-interactions.ts "$URL" "./output"
```

This produces `output/interactions.json` with navigation links, toggles/accordions, modals, dropdowns, forms, and scroll behaviors.

### Step 2.8: Asset Pipeline

Copy assets into rebuild project:

```bash
npx ts-node scripts/copy-assets.ts "./output" "./rebuild"
```

This copies fonts, images, SVGs into `rebuild/public/` and generates `@font-face` CSS.

### Step 3: Synthesizer (AI)

This is YOUR job. Read the scan and analysis results, then synthesize:

1. Read `output/scan-result.json` — focus on: colorPalette, typographyMap, spacingValues, animations, cssRaw, interactiveElements, and sample the domTree for structural understanding.

2. Read `output/analysis-result.json` — focus on: cssArchitecture, components (note confidence levels), animationPatterns, responsivePatterns, accessibility.

3. Read `output/motion-capture.json` and `output/motion-patterns.json` — for JS-driven animation keyframes, scroll trigger points, hover transitions.

4. Read `output/interactions.json` — for toggles, modals, dropdowns, forms, scroll behaviors.

5. Look at `output/screenshots/full-page-1440.png` to understand the visual design.

6. Produce `output/design-system.json` with complete structured tokens, components, interactions, layout system, animations, and rebuild instructions. Every value must be EXACT.

7. Produce `output/design-system.md` — a comprehensive 500+ line document with exact CSS for every component, interaction specs, and rebuild instructions.

### Step 4: Validator (Playwright)

Run site consistency check:

```bash
npx ts-node scripts/validate.ts "$URL" "./output" --site
```

Read `output/validation-report.json` and report the accuracy score.

### Step 5: Report

Summarize:
- Total elements extracted
- Colors, fonts, spacing values captured
- Components identified (grouped by confidence level)
- Interactions cataloged
- Screenshot match percentages per breakpoint
- Overall accuracy score
- Any gaps or issues found
- List of output files with sizes

### Step 6: Rebuild Validation Loop (after rebuild)

After the rebuild is generated, validate it:

```bash
npx ts-node scripts/validate.ts "$URL" "./output" --rebuild --rebuild-url http://localhost:3000
```

If score < 95%, run diff mode:
```bash
npx ts-node scripts/validate.ts "$URL" "./output" --diff --rebuild-url http://localhost:3000
```

Read `corrections-needed.json`, fix the rebuild, and re-validate until score >= 95%.

## Error Handling

- If Scanner fails: check if URL is accessible, retry once
- If Analyzer fails: check scan-result.json exists, retry once
- If Motion Capture fails: skip and continue (optional step)
- If Interaction Extraction fails: skip and continue (optional step)
- If Validator score < 95%: review discrepancies, note which components need attention
- If any step times out: report where it stopped and what was captured

## Accuracy Requirements

100% accuracy, no matter the cost. Every pixel, every color, every spacing value must be exact.
