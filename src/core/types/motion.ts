// ═══════════════════════════════════════════════════════════════════════════════
// Motion Capture (scripts/capture-motion.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ElementMotionData {
  selector: string;
  tag: string;
  classes: string[];
  textPreview: string;
  scrollKeyframes: ScrollKeyframe[];
  hoverTransition: TransitionCapture | null;
  focusTransition: TransitionCapture | null;
  webAnimations: WebAnimationData[];
  motionAttributes: Record<string, string>;
  initialState: Record<string, string>;
  finalState: Record<string, string>;
  triggerPoint: number | null;
  animationType: string;
  easing?: string;
}

export interface ScrollKeyframe {
  scrollY: number;
  styles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
}

export interface TransitionCapture {
  frames: { time: number; styles: Record<string, string> }[];
  duration: number;
  properties: string[];
  easing: string;
}

export interface WebAnimationData {
  animationName: string;
  duration: number;
  delay: number;
  easing: string;
  iterations: number;
  direction: string;
  fillMode: string;
  keyframes: Record<string, string>[];
}

export interface ViewportMotionData {
  viewportWidth: number;
  pageHeight: number;
  elements: ElementMotionData[];
  globalPatterns: {
    entranceAnimations: { selector: string; type: string; from: Record<string, string>; to: Record<string, string>; triggerScroll: number; duration: string; easing?: string }[];
    scrollLinkedAnimations: { selector: string; property: string; startScroll: number; endScroll: number; startValue: string; endValue: string; easing?: string }[];
    hoverTransitions: { selector: string; properties: string[]; duration: string; easing: string; from: Record<string, string>; to: Record<string, string> }[];
    continuousAnimations: { selector: string; animationName: string; duration: string; iterationCount: string }[];
    parallaxEffects: { selector: string; scrollRatio: number; direction: string }[];
  };
  summary: {
    totalAnimatedElements: number;
    entranceCount: number;
    scrollLinkedCount: number;
    hoverCount: number;
    continuousCount: number;
    parallaxCount: number;
  };
}

export interface MotionCaptureResult {
  url: string;
  timestamp: string;
  viewports: ViewportMotionData[];
  crossViewportDiffs: {
    selector: string;
    property: string;
    differences: { viewport: number; value: string }[];
  }[];
}
