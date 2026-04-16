import { textResponse, validateArgs } from '../helpers';
import { SuggestWorkflowInput } from '../schemas';

interface WorkflowStep {
  tool: string;
  description: string;
  required: boolean;
}

interface Workflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

const WORKFLOWS: Record<string, Workflow> = {
  rebuild: {
    name: 'Rebuild / Clone a Site',
    description: 'Extract everything and generate a complete Next.js project',
    steps: [
      { tool: 'rebuild_site', description: 'Full pipeline: scan + analyze + motion + interactions + synthesis + project generation', required: true },
      { tool: 'validate', description: 'Check rebuild accuracy vs original (mode=rebuild, requires dev server)', required: false },
      { tool: 'export_tokens', description: 'Also export tokens as Tailwind/shadcn configs if needed', required: false },
    ],
  },
  extract: {
    name: 'Extract Design System',
    description: 'Get all design tokens, components, animations, and patterns',
    steps: [
      { tool: 'extract_design_system', description: 'Full extraction: scan + analyze + motion + interactions + patterns', required: true },
      { tool: 'get_display_patterns', description: 'Classify section types, layouts, and content patterns', required: false },
      { tool: 'export_tokens', description: 'Export to Tailwind/shadcn/CSS variables', required: true },
      { tool: 'validate', description: 'Verify extraction consistency (mode=site)', required: false },
    ],
  },
  tokens: {
    name: 'Quick Token Extraction',
    description: 'Get just the design tokens (colors, typography, spacing) without full analysis',
    steps: [
      { tool: 'get_design_tokens', description: 'Fast scan (~5s) for colors, fonts, spacing, shadows', required: true },
      { tool: 'export_tokens', description: 'Export to your preferred format', required: false },
    ],
  },
  component: {
    name: 'Generate a Component',
    description: 'Extract a single component and generate working code',
    steps: [
      { tool: 'generate_component', description: 'Extract + generate .tsx + .module.css (or .vue / .svelte)', required: true },
    ],
  },
  match: {
    name: 'Match Your CSS to a Target',
    description: 'Compare your existing CSS against a target site component and get a diff',
    steps: [
      { tool: 'match_component', description: 'Diff your CSS module against extracted target styles', required: true },
    ],
  },
  adopt: {
    name: 'Adopt a Design into Your Project',
    description: 'Auto-detect your components and restyle them to match a target site',
    steps: [
      { tool: 'adopt_design', description: 'Scan your project, extract target, match components, generate patches', required: true },
      { tool: 'validate', description: 'Validate the result (mode=diff)', required: false },
    ],
  },
  understand: {
    name: 'Understand How a Site Displays Content',
    description: 'Analyze display patterns, layout strategies, and animation intent',
    steps: [
      { tool: 'extract_design_system', description: 'Full extraction to gather all data', required: true },
      { tool: 'get_display_patterns', description: 'Classify sections (hero, pricing, testimonials), layouts (grid, carousel), content patterns, animation intent', required: true },
      { tool: 'describe_extraction', description: 'See what was detected and what to explore further', required: false },
    ],
  },
  interact: {
    name: 'Test Interactive Behaviors',
    description: 'Click, type, hover, scroll on a page and capture state changes',
    steps: [
      { tool: 'interact', description: 'Perform browser actions and capture what changed (DOM, styles, network)', required: true },
    ],
  },
};

/** Match a goal to the best workflow by keyword scoring */
function matchGoal(goal: string): string {
  const lower = goal.toLowerCase();
  const scores: Record<string, number> = {};

  const keywords: Record<string, string[]> = {
    rebuild: ['rebuild', 'clone', 'copy', 'replicate', 'duplicate', 'recreate', 'next.js', 'nextjs', 'project'],
    extract: ['extract', 'design system', 'full', 'everything', 'complete', 'all tokens'],
    tokens: ['token', 'color', 'font', 'spacing', 'quick', 'fast', 'just tokens', 'palette'],
    component: ['component', 'generate', 'single', 'one component', 'header', 'hero', 'footer', 'nav', 'card', 'button'],
    match: ['match', 'diff', 'compare', 'my css', 'make mine', 'existing'],
    adopt: ['adopt', 'restyle', 'my project', 'existing project', 'apply', 'redesign'],
    understand: ['understand', 'how', 'display', 'pattern', 'layout', 'section', 'structure', 'analyze'],
    interact: ['interact', 'click', 'hover', 'type', 'scroll', 'test', 'behavior', 'browser'],
  };

  for (const [workflow, kws] of Object.entries(keywords)) {
    scores[workflow] = kws.filter(kw => lower.includes(kw)).length;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'extract'; // Default to full extraction
}

export async function handleSuggestWorkflow(rawArgs: unknown) {
  const args = validateArgs(SuggestWorkflowInput, rawArgs);

  if (args.goal) {
    const key = matchGoal(args.goal);
    const workflow = WORKFLOWS[key];
    return textResponse({
      matchedWorkflow: key,
      ...workflow,
      allWorkflows: Object.keys(WORKFLOWS),
      tip: 'Run describe_extraction after any workflow to see what data is available and what to do next.',
    });
  }

  // No goal — list all workflows
  const all = Object.entries(WORKFLOWS).map(([key, w]) => ({
    id: key,
    name: w.name,
    description: w.description,
    toolCount: w.steps.length,
    primaryTool: w.steps[0].tool,
  }));

  return textResponse({
    workflows: all,
    tip: 'Pass a goal (e.g., "I want to clone stripe.com") to get the recommended tool sequence.',
  });
}
