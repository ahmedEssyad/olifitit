// ═══════════════════════════════════════════════════════════════════════════════
// Scroll-Interaction Mapper (scripts/capture-scroll-interactions.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface InteractiveElementAtScroll {
  selector: string;
  tag: string;
  text: string;
  visible: boolean;
  clickable: boolean;
  href?: string;
  hoverChanges: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ScrollState {
  scrollY: number;
  label: string;
  interactiveElements: InteractiveElementAtScroll[];
  newSinceLastState: string[];
  removedSinceLastState: string[];
}

export interface AnimationInteractionLink {
  animation: string;
  element: string;
  scrollRange: [number, number];
  produces: { selector: string; interaction: string; text?: string }[];
  removes: { selector: string; interaction: string; text?: string }[];
}

export interface ScrollInteractionResult {
  url: string;
  timestamp: string;
  viewport: number;
  pageHeight: number;
  scrollStates: ScrollState[];
  animationInteractionLinks: AnimationInteractionLink[];
  summary: {
    keyScrollPositions: number;
    totalInteractiveElements: number;
    elementsAppeared: number;
    elementsDisappeared: number;
    animationsWithInteractionChanges: number;
  };
}
