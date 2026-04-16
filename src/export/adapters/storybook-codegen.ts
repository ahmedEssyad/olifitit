/**
 * Storybook Story Generator
 *
 * Generates CSF3 format .stories.tsx files for extracted React components,
 * plus Storybook configuration (main.ts + preview.ts) with viewport presets
 * derived from extraction breakpoints.
 */

// ── Story Generator ──────────────────────────────────────────────────────────

export function generateStorybookStory(
  componentName: string,
  sourceUrl: string,
  hasHoverStates: boolean,
  hasAnimations: boolean,
): string {
  const lines: string[] = [];

  lines.push(`import type { Meta, StoryObj } from '@storybook/react';`);
  lines.push(`import { ${componentName} } from './${componentName}';`);
  lines.push('');
  lines.push(`const meta: Meta<typeof ${componentName}> = {`);
  lines.push(`  title: 'Extracted/${componentName}',`);
  lines.push(`  component: ${componentName},`);
  lines.push(`  parameters: {`);
  lines.push(`    layout: 'fullscreen',`);
  lines.push(`    docs: {`);
  lines.push(`      description: {`);
  lines.push(`        component: 'Extracted from ${sourceUrl}',`);
  lines.push(`      },`);
  lines.push(`    },`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default meta;`);
  lines.push(`type Story = StoryObj<typeof ${componentName}>;`);
  lines.push('');

  // Default story
  lines.push(`export const Default: Story = {};`);
  lines.push('');

  // Responsive stories
  lines.push(`export const Mobile: Story = {`);
  lines.push(`  parameters: { viewport: { defaultViewport: 'mobile1' } },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export const Tablet: Story = {`);
  lines.push(`  parameters: { viewport: { defaultViewport: 'tablet' } },`);
  lines.push(`};`);

  // Hover story
  if (hasHoverStates) {
    lines.push('');
    lines.push(`export const WithHover: Story = {`);
    lines.push(`  parameters: {`);
    lines.push(`    pseudo: { hover: true },`);
    lines.push(`  },`);
    lines.push(`};`);
  }

  // Animation story
  if (hasAnimations) {
    lines.push('');
    lines.push(`export const WithAnimations: Story = {`);
    lines.push(`  parameters: {`);
    lines.push(`    chromatic: { pauseAnimationAtEnd: true },`);
    lines.push(`  },`);
    lines.push(`};`);
  }

  lines.push('');
  return lines.join('\n');
}

// ── Storybook Config Generator ───────────────────────────────────────────────

export function generateStorybookConfig(breakpoints: number[]): {
  main: string;
  preview: string;
} {
  // main.ts
  const mainLines: string[] = [];
  mainLines.push(`import type { StorybookConfig } from '@storybook/react-vite';`);
  mainLines.push('');
  mainLines.push(`const config: StorybookConfig = {`);
  mainLines.push(`  stories: ['../components/**/*.stories.@(ts|tsx)'],`);
  mainLines.push(`  framework: {`);
  mainLines.push(`    name: '@storybook/react-vite',`);
  mainLines.push(`    options: {},`);
  mainLines.push(`  },`);
  mainLines.push(`  addons: [`);
  mainLines.push(`    '@storybook/addon-essentials',`);
  mainLines.push(`    '@storybook/addon-viewport',`);
  mainLines.push(`  ],`);
  mainLines.push(`};`);
  mainLines.push('');
  mainLines.push(`export default config;`);
  mainLines.push('');

  // preview.ts — viewport presets from breakpoints
  const previewLines: string[] = [];
  previewLines.push(`import type { Preview } from '@storybook/react';`);
  previewLines.push('');
  previewLines.push(`const customViewports = {`);

  const sorted = [...breakpoints].sort((a, b) => a - b);
  for (const bp of sorted) {
    const name = getViewportName(bp);
    previewLines.push(`  '${name}': {`);
    previewLines.push(`    name: '${name} (${bp}px)',`);
    previewLines.push(`    styles: {`);
    previewLines.push(`      width: '${bp}px',`);
    previewLines.push(`      height: '100%',`);
    previewLines.push(`    },`);
    previewLines.push(`  },`);
  }

  previewLines.push(`};`);
  previewLines.push('');
  previewLines.push(`const preview: Preview = {`);
  previewLines.push(`  parameters: {`);
  previewLines.push(`    viewport: {`);
  previewLines.push(`      viewports: customViewports,`);
  previewLines.push(`    },`);
  previewLines.push(`  },`);
  previewLines.push(`};`);
  previewLines.push('');
  previewLines.push(`export default preview;`);
  previewLines.push('');

  return {
    main: mainLines.join('\n'),
    preview: previewLines.join('\n'),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getViewportName(width: number): string {
  if (width <= 320) return 'mobile-xs';
  if (width <= 375) return 'mobile-sm';
  if (width <= 414) return 'mobile-md';
  if (width <= 768) return 'tablet';
  if (width <= 1024) return 'laptop';
  if (width <= 1280) return 'desktop-sm';
  if (width <= 1440) return 'desktop';
  return 'desktop-lg';
}
