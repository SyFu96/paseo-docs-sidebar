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

const HTML_PREVIEW_CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; media-src data: blob:;">';

/**
 * A blob URL for an HTML preview with a CSP that blocks network resources. The policy is
 * prepended before any document content (after an optional UTF-8 BOM), so it applies even to
 * malformed documents with content before their head element.
 */
export function createHtmlPreviewUrl(bytes: Uint8Array): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof Blob === "undefined" || typeof URL === "undefined") return null;
  // Re-encoding UTF-16 would corrupt the document; refuse the preview rather than render it
  // without the network block.
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    return createHtmlUrl(`<!doctype html>${HTML_PREVIEW_CSP}<p>HTML preview is unavailable for this file encoding.</p>`);
  }

  const source = stripMetaRefresh(bytes);
  const bom = source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf ? 3 : 0;
  const prefix = asciiBytes(`<!doctype html>${HTML_PREVIEW_CSP}`);
  const combined = new Uint8Array(prefix.length + source.length);
  combined.set(source.subarray(0, bom), 0);
  combined.set(prefix, bom);
  combined.set(source.subarray(bom), bom + prefix.length);
  return URL.createObjectURL(new Blob([combined], { type: "text/html" }));
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Case-insensitive ASCII search; HTML tags in UTF-8 and other ASCII-compatible encodings match. */
function findAscii(bytes: Uint8Array, needle: string, start: number, end: number): number {
  const lower = needle.toLowerCase();
  const limit = Math.min(end, bytes.length) - lower.length;
  for (let index = Math.max(0, start); index <= limit; index += 1) {
    let matches = true;
    for (let offset = 0; offset < lower.length; offset += 1) {
      const byte = bytes[index + offset];
      const value = byte >= 65 && byte <= 90 ? byte + 32 : byte;
      if (value !== lower.charCodeAt(offset)) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}


/** Removes automatic meta refresh navigation; links still require a click. */
function stripMetaRefresh(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  let index = findAscii(bytes, "<meta", 0, bytes.length);
  while (index >= 0) {
    const end = findAscii(bytes, ">", index, bytes.length);
    if (end < 0) break;
    const tag = asciiLower(bytes.subarray(index, end + 1));
    if (tag.includes("http-equiv") && tag.includes("refresh")) {
      chunks.push(bytes.subarray(cursor, index));
      cursor = end + 1;
    }
    index = findAscii(bytes, "<meta", end + 1, bytes.length);
  }
  if (chunks.length === 0) return bytes;
  chunks.push(bytes.subarray(cursor));
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function asciiLower(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    text += String.fromCharCode(byte >= 65 && byte <= 90 ? byte + 32 : byte);
  }
  return text;
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
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
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
  contains?(node: unknown): boolean;
  scrollIntoView?(options?: { block?: string; inline?: string }): void;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  getBoundingClientRect?(): WebRect;
}

interface WebDomElement extends WebDomContainer {
  innerHTML: string;
  setAttribute(name: string, value: string): void;
  appendChild(child: WebDomNode): WebDomNode;
}

interface WebRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  height: number;
}

interface WebRange {
  setStart(node: WebDomNode, offset: number): void;
  setEnd(node: WebDomNode, offset: number): void;
  startContainer: WebDomNode;
  getBoundingClientRect(): WebRect;
}

interface WebHighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}

interface WebDomDocument {
  createElement(tag: string): WebDomElement;
  createTextNode(text: string): WebDomNode;
  createTreeWalker(root: WebDomNode, whatToShow: number): { nextNode(): WebDomNode | null };
  createRange(): WebRange;
  head?: WebDomElement;
  getElementById?(id: string): WebDomElement | null;
  addEventListener(
    type: string,
    listener: (event: WebClickEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: WebClickEvent) => void,
    capture?: boolean,
  ): void;
}

interface WebDomObserver {
  observe(target: WebDomNode, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}

declare const document: WebDomDocument | undefined;
declare const window: { location: { pathname: string; hash: string } } | undefined;
declare const MutationObserver: { new (callback: () => void): WebDomObserver } | undefined;
declare const CSS: { highlights?: WebHighlightRegistry } | undefined;
declare const Highlight: { new (...ranges: WebRange[]): unknown } | undefined;
declare function getComputedStyle(element: WebDomContainer): { overflowY?: string };

const SHOW_TEXT = 4;
const MAX_FIND_MATCHES = 2000;
const FIND_HIGHLIGHT_CSS = `::highlight(docs-find) { background-color: #fff3a3; color: #1f2328; }
::highlight(docs-find-active) { background-color: #ffb347; color: #1f2328; }`;

export interface TextFindResult {
  count: number;
  limited: boolean;
}

/**
 * Scrolls the active match to the middle of its scroll container. `scrollIntoView` on the text
 * node's parent would jump to the top of a source view that holds the whole file in one node.
 */
function scrollRangeIntoView(range: WebRange): void {
  const rect = range.getBoundingClientRect();
  let node = range.startContainer.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    const scrollable =
      (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
      (node.scrollHeight ?? 0) > (node.clientHeight ?? 0) + 1;
    if (scrollable && node.getBoundingClientRect) {
      const box = node.getBoundingClientRect();
      const offset = rect.top - box.top - (node.clientHeight ?? 0) / 2 + rect.height / 2;
      node.scrollTop = Math.max(0, (node.scrollTop ?? 0) + offset);
      return;
    }
    node = node.parentElement ?? null;
  }
  range.startContainer.parentElement?.scrollIntoView?.({ block: "center", inline: "nearest" });
}

/** Clears the CSS highlight registries used by the in-document find bar. */
export function clearTextFind(): void {
  if (Platform.OS !== "web") return;
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  CSS.highlights.delete("docs-find");
  CSS.highlights.delete("docs-find-active");
}

/**
 * Highlights query matches in a rendered Markdown or source container without mutating its DOM.
 * Returns the number of matches and scrolls the active one into view. Desktop web only.
 */
export function findTextInContainer(
  node: unknown,
  query: string,
  active: number,
): TextFindResult {
  clearTextFind();
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return { count: 0, limited: false };
  }
  const needle = query.trim().toLowerCase();
  const root = node as WebDomContainer | null;
  if (!needle || !root) return { count: 0, limited: false };

  const dom = document;
  let style = dom.getElementById?.("docs-find-style") ?? null;
  if (!style && dom.head) {
    style = dom.createElement("style");
    style.setAttribute("id", "docs-find-style");
    style.innerHTML = FIND_HIGHLIGHT_CSS;
    dom.head.appendChild(style);
  }

  const ranges: WebRange[] = [];
  let limited = false;
  const walker = dom.createTreeWalker(root, SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const parentTag = current.parentElement?.tagName?.toUpperCase();
    if (parentTag !== "SCRIPT" && parentTag !== "STYLE" && parentTag !== "NOSCRIPT") {
      const value = current.nodeValue ?? "";
      const lower = value.toLowerCase();
      let from = 0;
      let index = lower.indexOf(needle, from);
      while (index >= 0) {
        if (ranges.length >= MAX_FIND_MATCHES) {
          limited = true;
          break;
        }
        const range = dom.createRange();
        range.setStart(current, index);
        range.setEnd(current, index + needle.length);
        ranges.push(range);
        from = index + needle.length;
        index = lower.indexOf(needle, from);
      }
    }
    if (limited) break;
    current = walker.nextNode();
  }

  const registry = typeof CSS === "undefined" ? undefined : CSS.highlights;
  const HighlightCtor = typeof Highlight === "undefined" ? undefined : Highlight;
  if (registry && HighlightCtor && ranges.length > 0) {
    registry.set("docs-find", new HighlightCtor(...ranges));
    const activeRange = ranges[Math.max(0, Math.min(active, ranges.length - 1))];
    if (activeRange) registry.set("docs-find-active", new HighlightCtor(activeRange));
  }

  const activeRange = ranges[Math.max(0, Math.min(active, ranges.length - 1))];
  if (activeRange) scrollRangeIntoView(activeRange);
  return { count: ranges.length, limited };
}

/** Reads the workspace ID from Paseo's `/h/:server/workspace/:workspaceId` route. */
export function currentWorkspaceIdFromLocation(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const route = `${window.location.pathname}${window.location.hash}`;
  const match = route.match(/\/workspace\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Closes an overlay with Escape while it is open. Desktop web only. */
export function interceptEscapeKey(handler: () => void): (() => void) | undefined {
  if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
  const dom = document;
  const onKeyDown = (event: WebClickEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
  dom.addEventListener("keydown", onKeyDown, true);
  return () => dom.removeEventListener("keydown", onKeyDown, true);
}

/**
 * Intercepts plain clicks on document links inside agent chat. Paseo's markdown anchors carry the
 * raw href and handle clicks with React, so a capture listener can hand the path to the Docs panel
 * before the host opens the center file tab. Desktop web only; other hosts keep the default.
 *
 * Paseo has no public file-link hook. The chat selector is a compatibility contract: when the host
 * markup changes, this handler finds nothing and the click falls through to Paseo instead of
 * breaking the app.
 */
export function interceptAgentDocLinks(
  handle: (href: string) => boolean,
): (() => void) | undefined {
  if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
  const dom = document;

  const onClick = (event: WebClickEvent) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    let target = event.target as WebTarget | null;
    while (target && typeof target.closest !== "function") {
      target = target.parentElement ?? null;
    }
    if (!target) return;
    if (target.closest?.("#docs-sidebar-panel")) return;
    if (!target.closest?.('[data-testid="agent-chat-scroll"]')) return;

    const anchor = target.closest("a[href]");
    const href = anchor?.getAttribute?.("href");
    if (!href) return;

    let handled = false;
    try {
      handled = handle(href);
    } catch {
      handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  dom.addEventListener("click", onClick, true);
  return () => dom.removeEventListener("click", onClick, true);
}

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
