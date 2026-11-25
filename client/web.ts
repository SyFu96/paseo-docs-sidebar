import { Platform } from "react-native";

// The plugin typechecks without the DOM library, so declare only what this module uses.
declare const Blob: {
  new (parts: readonly Uint8Array[], options: { type: string }): unknown;
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

export function releaseDocumentUrl(url: string): void {
  if (Platform.OS !== "web") return;
  if (typeof URL !== "undefined") URL.revokeObjectURL(url);
}
