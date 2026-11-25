import { useEffect, useState } from "react";
import { createDocumentUrl, releaseDocumentUrl } from "./web";

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

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
