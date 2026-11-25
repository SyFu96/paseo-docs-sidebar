import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { docKind, mimeType, readBytesRpc, resolveDocLink } from "../shared/docs";
import { extractImageSources, rewriteMarkdownImages } from "./markdown-image-syntax";
import { createDocumentUrl, releaseDocumentUrl } from "./web";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

interface FetchedImage {
  source: string;
  path: string;
  bytes: Uint8Array | null;
}

export interface MarkdownImages {
  markdown: string;
  pending: boolean;
  failed: number;
}

/** Resolves relative Markdown images to files in the workspace and rewrites them for the host. */
export function useMarkdownImages(input: {
  root: string;
  hostId: string;
  path: string;
  text: string;
  enabled: boolean;
}): MarkdownImages {
  const readBytes = useRpc(readBytesRpc);
  const sources = useMemo(() => extractImageSources(input.text), [input.text]);
  const resolved = useMemo(
    () =>
      sources
        .map((source) => ({ source, path: resolveImagePath(input.root, input.path, source) }))
        .filter(
          (item): item is { source: string; path: string } =>
            item.path !== null && docKind(item.path) === "image",
        ),
    [sources, input.root, input.path],
  );
  const key = resolved.map((item) => item.path).join("|");

  const query = useQuery({
    queryKey: ["docs", "markdown-images", input.hostId, input.root, key],
    queryFn: async () => {
      const results: FetchedImage[] = [];
      let total = 0;
      for (const item of resolved) {
        if (total >= MAX_TOTAL_IMAGE_BYTES) {
          results.push({ ...item, bytes: null });
          continue;
        }
        try {
          const bytes = await readBytes({ root: input.root, path: item.path });
          if (bytes.length > MAX_IMAGE_BYTES || total + bytes.length > MAX_TOTAL_IMAGE_BYTES) {
            results.push({ ...item, bytes: null });
            continue;
          }
          total += bytes.length;
          results.push({ ...item, bytes });
        } catch {
          results.push({ ...item, bytes: null });
        }
      }
      return results;
    },
    enabled: input.enabled && resolved.length > 0,
    staleTime: 60_000,
  });

  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const next = new Map<string, string>();
    const created: string[] = [];
    for (const item of query.data ?? []) {
      if (!item.bytes) continue;
      const mime = mimeType(item.path);
      const blob = createDocumentUrl(item.bytes, mime);
      if (blob) {
        created.push(blob);
        next.set(item.source, blob);
      } else {
        next.set(item.source, createDataUrl(item.bytes, mime));
      }
    }
    setUrls(next);
    return () => {
      for (const url of created) releaseDocumentUrl(url);
    };
  }, [query.data]);

  const markdown = useMemo(() => rewriteMarkdownImages(input.text, urls), [input.text, urls]);
  const failed = query.data?.filter((item) => !item.bytes).length ?? 0;
  return {
    markdown,
    pending: input.enabled && resolved.length > 0 && query.isPending,
    failed,
  };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Resolves relative, workspace-absolute, and file:// images; paths outside the workspace are refused. */
function resolveImagePath(root: string, fromPath: string, source: string): string | null {
  const rootPath = root.replace(/\\/g, "/").replace(/\/+$/, "");
  let absolute = source.replace(/\\/g, "/");
  if (/^file:\/\//i.test(absolute)) {
    try {
      absolute = decodeURIComponent(absolute.replace(/^file:\/\//i, ""));
    } catch {
      absolute = absolute.replace(/^file:\/\//i, "");
    }
    if (/^\/[A-Za-z]:\//.test(absolute)) absolute = absolute.slice(1);
  }
  const rootLower = rootPath.toLowerCase();
  if (/^[A-Za-z]:\//.test(absolute)) {
    return absolute.toLowerCase().startsWith(`${rootLower}/`)
      ? absolute.slice(rootPath.length + 1)
      : null;
  }
  if (rootPath.startsWith("/") && absolute.startsWith(`${rootPath}/`)) {
    return absolute.slice(rootPath.length + 1);
  }
  return resolveDocLink(fromPath, source);
}

/** Data URLs render on clients without blob URL support. */
function createDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${encodeBase64(bytes)}`;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    chunks.push(
      BASE64[(value >> 18) & 63] +
        BASE64[(value >> 12) & 63] +
        BASE64[(value >> 6) & 63] +
        BASE64[value & 63],
    );
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index] << 16;
    chunks.push(BASE64[(value >> 18) & 63] + BASE64[(value >> 12) & 63] + "==");
  } else if (remaining === 2) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
    chunks.push(
      BASE64[(value >> 18) & 63] +
        BASE64[(value >> 12) & 63] +
        BASE64[(value >> 6) & 63] +
        "=",
    );
  }
  return chunks.join("");
}
