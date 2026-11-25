import { Platform } from "react-native";

// The plugin typechecks without the DOM library, so declare only what this module uses.
declare const Blob: {
  new (parts: readonly (Uint8Array | string)[], options: { type: string }): unknown;
};
declare const URL: {
  createObjectURL(blob: unknown): string;
  revokeObjectURL(url: string): void;
};

/** A local blob URL for DocumentFrame and images. Desktop web only; null elsewhere. */
export function createDocumentUrl(bytes: Uint8Array, mimeType: string): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof Blob === "undefined" || typeof URL === "undefined") return null;
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** A local blob URL for converted document HTML. Desktop web only; null elsewhere. */
export function createHtmlUrl(html: string): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof Blob === "undefined" || typeof URL === "undefined") return null;
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

export function releaseDocumentUrl(url: string): void {
  if (Platform.OS !== "web") return;
  if (typeof URL !== "undefined") URL.revokeObjectURL(url);
}

// Minimal DOM shapes: the plugin typechecks without the DOM library.
interface WebTarget {
  closest?(selector: string): WebTarget | null;
  getAttribute?(name: string): string | null;
  parentElement?: WebTarget | null;
}

interface WebClickEvent {
  target: unknown;
  button?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface WebNode {
  addEventListener(type: string, listener: (event: WebClickEvent) => void, capture?: boolean): void;
  removeEventListener(
    type: string,
    listener: (event: WebClickEvent) => void,
    capture?: boolean,
  ): void;
}

/**
 * Intercepts clicks on links inside a rendered Markdown container. `handle` receives the raw
 * href and returns true when the panel took the click. Desktop web only.
 */
export function interceptLinkClicks(
  node: unknown,
  handle: (href: string) => boolean,
): (() => void) | undefined {
  if (Platform.OS !== "web") return undefined;
  const element = node as WebNode | null;
  if (!element || typeof element.addEventListener !== "function") return undefined;

  const onClick = (event: WebClickEvent) => {
    if (event.button !== undefined && event.button !== 0) return;
    let target = event.target as WebTarget | null;
    while (target && typeof target.closest !== "function") {
      target = target.parentElement ?? null;
    }
    const anchor = target?.closest?.("a[href]") ?? null;
    const href = anchor?.getAttribute?.("href");
    if (!href || !handle(href)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener("click", onClick, true);
  return () => element.removeEventListener("click", onClick, true);
}

// Minimal DOM shapes for the MathML injector.
interface WebMathSegment {
  placeholder: string;
  mathml: string;
  display: boolean;
}

interface WebDomNode {
  nodeType: number;
  nodeValue?: string | null;
  parentNode?: WebDomContainer | null;
  parentElement?: WebDomContainer | null;
}

interface WebDomContainer extends WebDomNode {
  tagName?: string;
  insertBefore(newChild: WebDomNode, reference: WebDomNode): WebDomNode;
  removeChild(child: WebDomNode): WebDomNode;
}

interface WebDomElement extends WebDomContainer {
  innerHTML: string;
  setAttribute(name: string, value: string): void;
}

interface WebDomDocument {
  createElement(tag: string): WebDomElement;
  createTextNode(text: string): WebDomNode;
  createTreeWalker(root: WebDomNode, whatToShow: number): { nextNode(): WebDomNode | null };
}

interface WebDomObserver {
  observe(target: WebDomNode, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}

declare const document: WebDomDocument | undefined;
declare const MutationObserver: { new (callback: () => void): WebDomObserver } | undefined;

const SHOW_TEXT = 4;

/**
 * Replaces MathML placeholders inside the rendered Markdown with real MathML elements. Paseo's
 * plugin Markdown has no latexMath option and strips raw HTML, so this runs after rendering.
 */
export function injectMath(
  node: unknown,
  formulas: readonly WebMathSegment[],
): (() => void) | undefined {
  if (Platform.OS !== "web" || formulas.length === 0) return undefined;
  if (typeof document === "undefined") return undefined;
  const dom = document;
  const root = node as WebDomContainer | null;
  if (!root || typeof root.insertBefore !== "function") return undefined;

  const byPlaceholder = new Map(formulas.map((formula) => [formula.placeholder, formula]));
  const Observer = typeof MutationObserver === "undefined" ? null : MutationObserver;
  let observer: WebDomObserver | null = null;
  let applying = false;

  const insideCode = (textNode: WebDomNode): boolean => {
    let parent = textNode.parentElement ?? null;
    while (parent) {
      const tag = parent.tagName?.toUpperCase();
      if (tag === "CODE" || tag === "PRE") return true;
      parent = parent.parentElement ?? null;
    }
    return false;
  };

  const replacePlaceholders = (textNode: WebDomNode) => {
    if (insideCode(textNode)) return;
    const parent = textNode.parentNode;
    if (!parent) return;
    const value = textNode.nodeValue ?? "";
    const pattern = /\uE000(\d+)\uE001/g;
    let last = 0;
    let replaced = false;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      const formula = byPlaceholder.get(match[0]);
      if (!formula) continue;
      if (!/^<math\b/i.test(formula.mathml) || /<script|on[a-z]+\s*=/i.test(formula.mathml)) {
        continue;
      }
      if (match.index > last) {
        parent.insertBefore(dom.createTextNode(value.slice(last, match.index)), textNode);
      }
      const wrapper = dom.createElement("span");
      wrapper.setAttribute("data-paseo-math", formula.display ? "display" : "inline");
      wrapper.setAttribute(
        "style",
        formula.display
          ? "display:block;text-align:center;margin:14px 0;"
          : "display:inline-block;vertical-align:middle;font-size:1.05em;",
      );
      wrapper.innerHTML = formula.mathml;
      parent.insertBefore(wrapper, textNode);
      last = match.index + match[0].length;
      replaced = true;
    }
    if (!replaced) return;
    if (last < value.length) {
      parent.insertBefore(dom.createTextNode(value.slice(last)), textNode);
    }
    parent.removeChild(textNode);
  };

  const apply = () => {
    if (applying) return;
    applying = true;
    observer?.disconnect();
    const walker = dom.createTreeWalker(root, SHOW_TEXT);
    const targets: WebDomNode[] = [];
    let current = walker.nextNode();
    while (current) {
      const value = current.nodeValue;
      if (value && value.includes("\uE000")) targets.push(current);
      current = walker.nextNode();
    }
    for (const target of targets) replacePlaceholders(target);
    observer?.observe(root, { childList: true, subtree: true });
    applying = false;
  };

  if (Observer) observer = new Observer(apply);
  apply();
  return () => observer?.disconnect();
}
