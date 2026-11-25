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
