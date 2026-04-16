// ═══════════════════════════════════════════════════════════════════════════════
// Interaction Extractor (scripts/extract-interactions.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface NavigationData {
  internal: { href: string; text: string; selector: string }[];
  external: { href: string; text: string; selector: string }[];
  anchorLinks: { href: string; text: string; selector: string }[];
}

export interface ToggleData {
  trigger: string;
  target: string;
  type: 'accordion' | 'toggle' | 'details';
  triggerText: string;
}

export interface ModalData {
  trigger: string;
  dialog: string;
  triggerText: string;
}

export interface DropdownData {
  trigger: string;
  menu: string;
  options: string[];
  type: 'native' | 'custom';
}

export interface InteractionFormData {
  selector: string;
  action: string;
  method: string;
  fields: {
    selector: string;
    type: string;
    name: string;
    placeholder: string;
    required: boolean;
    validation: string[];
  }[];
  submitButton: string;
  classification: 'api_endpoint' | 'client_side' | 'page_navigation';
}

export interface ScrollBehavior {
  smoothScroll: boolean;
  stickyElements: { selector: string; top: string }[];
  anchorLinks: { href: string; selector: string }[];
}

export interface InteractionResult {
  url: string;
  timestamp: string;
  navigation: NavigationData;
  toggles: ToggleData[];
  modals: ModalData[];
  dropdowns: DropdownData[];
  forms: InteractionFormData[];
  scrollBehaviors: ScrollBehavior;
}
