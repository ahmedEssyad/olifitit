/** MCP tool definitions — 7 focused tools */

const brandProperty = {
  type: 'object',
  description: 'Brand override — swap extracted colors/fonts with your own',
  properties: {
    colors: {
      type: 'object',
      description: 'Color overrides',
      properties: {
        primary: { type: 'string', description: 'Primary brand color (e.g., "#1a73e8")' },
        secondary: { type: 'string', description: 'Secondary brand color' },
        accent: { type: 'string', description: 'Accent color' },
        background: { type: 'string', description: 'Background color' },
        surface: { type: 'string', description: 'Surface/card color' },
        text: { type: 'string', description: 'Text color' },
        textMuted: { type: 'string', description: 'Muted/secondary text color' },
        border: { type: 'string', description: 'Border color' },
      },
    },
    fonts: {
      type: 'object',
      description: 'Font family overrides',
      properties: {
        body: { type: 'string', description: 'Body font family (e.g., "Inter")' },
        heading: { type: 'string', description: 'Heading font family' },
        mono: { type: 'string', description: 'Monospace font family' },
      },
    },
  },
};

export const toolDefinitions = [
  {
    name: 'adopt_design',
    description:
      'Intelligently adopt a target site\'s design into YOUR existing project. Scans your project to discover your components and CSS modules, auto-detects your brand (colors, fonts), extracts matching components from the target site, and generates CSS patches for each matched component — preserving your brand identity. Shows a diff report per component. Use apply=true to write changes (originals backed up as .bak). This is the smart tool — it knows what you have and only changes what needs to change.',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_url: { type: 'string', description: 'URL of the site whose design you want to adopt' },
        project_dir: { type: 'string', description: 'Path to your existing project — components and brand are auto-detected' },
        brand: brandProperty,
        apply: { type: 'boolean', description: 'Write patched CSS files to disk (default: false — preview only). Originals backed up as .bak files.' },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only process specific components (by name or type, e.g., ["header", "hero"]). Omit to process all.',
        },
      },
      required: ['target_url', 'project_dir'],
    },
  },
  {
    name: 'rebuild_site',
    description:
      'Extract a complete design system from a URL and generate a runnable Next.js project. Runs the full pipeline: scan → analyze + motion + interactions (parallel) → distill → assets → AI synthesis → project generation → validation. Returns a project in rebuild/ with components, styles, animations, and design tokens. This is the main tool — use it when the user wants to rebuild or clone a site.',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the website to extract and rebuild' },
        output_dir: { type: 'string', description: 'Directory for extraction output. Default: ./output' },
        rebuild_dir: { type: 'string', description: 'Target directory for the Next.js project. Default: ./rebuild' },
        crawl: { type: 'boolean', description: 'Enable multi-page crawling (up to 20 pages)' },
        auth_cookie: { type: 'string', description: 'Authentication cookie (format: "name=value")' },
        auth_header: { type: 'string', description: 'Authentication header (format: "Key: Value")' },
        skip_extraction: { type: 'boolean', description: 'Skip extraction — use existing data in output_dir to regenerate the project' },
        brand: brandProperty,
      },
      required: ['url'],
    },
  },
  {
    name: 'generate_component',
    description:
      'Extract a single component from a URL and generate a working component file. Supports React (.tsx + .module.css), Vue 3 (.vue with scoped styles), and Svelte (.svelte). Includes exact computed styles, hover states, responsive behavior, and animations. Use component names like "header", "nav", "hero", "footer", "card", "button", "pricing", "faq", or any CSS selector.',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the website' },
        component: { type: 'string', description: 'Component name (header, nav, hero, footer, card, pricing, etc.) or CSS selector' },
        name: { type: 'string', description: 'Custom component name (e.g., "StripeNav"). Auto-derived if omitted.' },
        framework: { type: 'string', enum: ['react', 'vue', 'svelte'], description: 'Target framework (default: react)' },
        brand: brandProperty,
      },
      required: ['url', 'component'],
    },
  },
  {
    name: 'export_tokens',
    description:
      'Export design tokens from previously extracted data to a framework config file. Formats: tailwind (tailwind.config.ts), css-variables (design-tokens.css with :root), shadcn (globals.css + tailwind.config.ts), w3c (W3C Design Tokens JSON), style-dictionary (Amazon Style Dictionary JSON), design-md (Stitch-compatible DESIGN.md for AI agents), or all. Requires a prior extraction (design-system.json or scan-result.json must exist).',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        format: {
          type: 'string',
          enum: ['tailwind', 'css-variables', 'shadcn', 'w3c', 'style-dictionary', 'design-md', 'all'],
          description: 'Export format',
        },
        input_dir: { type: 'string', description: 'Directory containing design-system.json or scan-result.json (default: ./output)' },
        output_dir: { type: 'string', description: 'Directory to write config files (default: <input_dir>/export)' },
        prefix: { type: 'string', description: 'CSS variable prefix for css-variables format (e.g., "ds" → --ds-color-primary)' },
        brand: brandProperty,
      },
      required: ['format'],
    },
  },
  {
    name: 'export_design_md',
    description:
      'Generate a Stitch-compatible DESIGN.md from extracted data — the format AI coding agents (Cursor, Claude, Copilot) read to produce on-brand UI. Includes 10 sections: visual theme, color palette, typography, component stylings, layout, elevation, do\'s & don\'ts, responsive behavior, agent prompt guide, and full animation specs with scroll triggers and from/to values. Requires a prior extraction.',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        input_dir: { type: 'string', description: 'Directory containing extraction data (default: ./output)' },
        output_dir: { type: 'string', description: 'Directory to write DESIGN.md (default: <input_dir>/export)' },
        brand: brandProperty,
      },
    },
  },
  {
    name: 'get_design_tokens',
    description:
      'Quick extraction of design tokens from a URL — colors, typography, spacing, border-radius, shadows, and CSS custom properties. Takes ~5 seconds. Use this when you only need tokens, not a full rebuild.',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the website' },
      },
      required: ['url'],
    },
  },
  {
    name: 'validate',
    description:
      'Validate a rebuild or check for site drift. Modes: "rebuild" (pixel-level comparison of rebuild vs original, requires dev server running), "site" (compare live site against stored scan data), "diff" (incremental validation with severity-ranked corrections list).',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the website' },
        output_dir: { type: 'string', description: 'Directory containing scan-result.json and screenshots/' },
        mode: { type: 'string', enum: ['rebuild', 'site', 'diff'], description: 'Validation mode (default: site)' },
        rebuild_url: { type: 'string', description: 'URL of rebuild dev server (default: http://localhost:3000). Only used in rebuild/diff modes.' },
      },
      required: ['url', 'output_dir'],
    },
  },
  {
    name: 'match_component',
    description:
      'Compare your existing CSS module against a target component from a URL. Shows exactly what properties to change, add, or remove to make your component match the target. Returns a style diff report and a patched CSS file.',
    readOnly: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the target website' },
        component: { type: 'string', description: 'Component name (header, nav, hero, footer, etc.) or CSS selector' },
        css_content: { type: 'string', description: 'Your existing CSS module content (full CSS text)' },
        class_map: { type: 'string', description: 'Manual class mapping if auto-matching fails (format: "yourClass=targetLabel,...")' },
      },
      required: ['url', 'component', 'css_content'],
    },
  },
  {
    name: 'get_site_features',
    description:
      'Extract or retrieve the feature specification of a website. Returns site type, detected features (auth, navigation, forms, commerce, media), user flows, third-party integrations, and content strategy. Uses AI (Claude API) to synthesize raw extraction data into a structured feature manifest. Requires a prior extraction (scan-result.json must exist).',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        output_dir: { type: 'string', description: 'Directory containing extraction data (default: ./output)' },
        refresh: { type: 'boolean', description: 'Re-extract even if site-features.json already exists' },
      },
      required: [],
    },
  },
  {
    name: 'get_performance_report',
    description:
      'Analyze website performance using Lighthouse. Returns Core Web Vitals (LCP, CLS, INP, FCP, TTFB), resource breakdown (sizes, render-blocking, unused bytes), animation performance (compositor-only vs layout-triggering), image optimization opportunities, font loading analysis, and ranked actionable recommendations. Can use cached data from a prior extraction or run a fresh Lighthouse audit.',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to analyze (runs fresh Lighthouse audit)' },
        output_dir: { type: 'string', description: 'Directory with existing performance-report.json (skips re-analysis)' },
      },
      required: [],
    },
  },
  {
    name: 'describe_extraction',
    description:
      'Check what has been extracted and what tools to run next. Returns extraction state (scanned, analyzed, synthesized, exported, etc.), detected components, token summary, pattern summary, validation scores, and recommended next steps. Use this to orient yourself before deciding what to do, or after running a tool to see what changed.',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        output_dir: { type: 'string', description: 'Directory containing extraction data (default: ./output)' },
      },
      required: [],
    },
  },
  {
    name: 'suggest_workflow',
    description:
      'Get the recommended tool sequence for a given goal. Pass a natural language goal (e.g., "clone stripe.com", "extract tokens", "restyle my project") and get back the optimal workflow with tool names and descriptions. Call with no goal to list all available workflows.',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        goal: { type: 'string', description: 'What you want to accomplish (e.g., "rebuild stripe.com", "extract design tokens", "match my CSS to a target")' },
      },
      required: [],
    },
  },
  {
    name: 'get_display_patterns',
    description:
      'Get classified display patterns from previously extracted data. Returns section types (hero, pricing, testimonials, etc.), layout strategies (grid, carousel, timeline, etc.), content patterns (card-grid, accordion, tabs, etc.), animation intent (entrance-reveal, staggered, parallax, etc.), responsive strategies, and information hierarchy. Requires a prior extraction (scan-result.json must exist).',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        output_dir: { type: 'string', description: 'Directory containing extraction data (default: ./output)' },
        refresh: { type: 'boolean', description: 'Re-classify even if display-patterns.json already exists' },
      },
      required: [],
    },
  },
  {
    name: 'interact',
    description:
      'Perform browser interactions on a URL and capture state changes. Execute clicks, typing, hovers, scrolls — returns what changed (new elements, style diffs, DOM mutations, console errors, network requests) after each action.',
    readOnly: true,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL of the page' },
        actions: {
          type: 'array',
          description: 'Sequence of actions to perform',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'type', 'hover', 'scroll', 'wait', 'select', 'focus', 'screenshot'],
                description: 'Action type',
              },
              selector: { type: 'string', description: 'CSS selector for the target element' },
              value: { type: 'string', description: 'Text to type or option to select' },
              position: {
                type: 'object',
                description: 'Scroll target',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  selector: { type: 'string' },
                },
              },
              duration: { type: 'number', description: 'Wait duration in ms (for "wait")' },
            },
            required: ['type'],
          },
        },
        capture: {
          type: 'string',
          enum: ['screenshot', 'styles', 'both', 'diff'],
          description: 'What to capture after each action (default: diff)',
        },
      },
      required: ['url', 'actions'],
    },
  },
];
