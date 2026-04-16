// ═══════════════════════════════════════════════════════════════════════════════
// Motion Distiller (scripts/distill-motion.ts)
// ═══════════════════════════════════════════════════════════════════════════════

import { AnimationInteractionLink } from './scroll-interactions';

export interface DistilledAnimation {
  element: string;
  textPreview: string;
  trigger: 'scroll-into-view' | 'scroll-linked' | 'hover' | 'focus' | 'continuous' | 'parallax';
  from: Record<string, string>;
  to: Record<string, string>;
  intermediateKeyframes?: { offset: number; styles: Record<string, string> }[];
  duration: string;
  easing: string;
  delay?: string;
  triggerPoint?: string;
  scrollRange?: { start: number; end: number };
  parallaxRatio?: number;
  responsive?: Record<string, Partial<DistilledAnimation>>;
}

export interface DistilledMotion {
  url: string;
  timestamp: string;
  summary: {
    totalAnimatedElements: number;
    entrance: number;
    scrollLinked: number;
    hover: number;
    focus: number;
    continuous: number;
    parallax: number;
  };
  animations: DistilledAnimation[];
  cssKeyframes: { name: string; duration: string; iterations: string; keyframes: Record<string, string>[] }[];
  responsiveNotes: string[];
  scrollInteractions?: {
    keyScrollStates: number;
    animationInteractionLinks: AnimationInteractionLink[];
    interactiveElementTransitions: string[];
  };
}
