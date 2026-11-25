import { useEffect, useState } from "react";
import { createDocumentUrl, createHtmlUrl, releaseDocumentUrl } from "./web";

/** Keeps one blob URL alive for the current document bytes. */
export function useDocumentUrl(bytes: Uint8Array | undefined, mimeType: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const next = createDocumentUrl(bytes, mimeType);
    setUrl(next);
    return () => {
      if (next) releaseDocumentUrl(next);
    };
  }, [bytes, mimeType]);
  return url;
}

/** Keeps one blob URL alive for converted document HTML. */
export function useHtmlUrl(html: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (html === undefined) {
      setUrl(null);
      return;
    }
    const next = createHtmlUrl(html);
    setUrl(next);
    return () => {
      if (next) releaseDocumentUrl(next);
    };
  }, [html]);
  return url;
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
