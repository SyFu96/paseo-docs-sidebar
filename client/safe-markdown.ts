import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { sanitizeMarkdownRpc } from "../shared/docs";
import { textKey } from "./text-key";

export interface SafeMarkdown {
  text: string;
  pending: boolean;
  error: boolean;
  blocked: number;
}

/**
 * Rewrites parsed remote image destinations on the daemon before Markdown reaches the host
 * renderer. Parsing, rather than scanning lines, covers reference definitions whose URL is on the
 * next line and images inside GFM tables.
 */
export function useSafeMarkdown(input: {
  hostId: string;
  root: string;
  path: string;
  text: string;
  enabled: boolean;
}): SafeMarkdown {
  const sanitize = useRpc(sanitizeMarkdownRpc);
  const enabled = input.enabled && input.text.length > 0;
  const version = useMemo(() => textKey(input.text), [input.text]);
  const query = useQuery({
    queryKey: ["docs", "safe-markdown", input.hostId, input.root, input.path, version],
    queryFn: () => sanitize({ text: input.text }),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) {
    return { text: input.text, pending: false, error: false, blocked: 0 };
  }
  if (query.data) {
    return {
      text: query.data.text,
      pending: false,
      error: false,
      blocked: query.data.blocked,
    };
  }
  return {
    text: input.text,
    pending: query.isPending,
    error: query.isError,
    blocked: 0,
  };
}
