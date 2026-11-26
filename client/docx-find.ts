import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { findDocxRpc } from "../shared/docs";

export interface DocFindResult {
  query: string;
  count: number;
  limited: boolean;
  pending: boolean;
  error: boolean;
}

export interface DocxFind {
  html: string | undefined;
  count: number;
  limited: boolean;
  pending: boolean;
  error: boolean;
}

/**
 * Asks the daemon to wrap Word preview matches in marks. The preview frame is sandboxed, so the
 * parent cannot search or highlight its DOM directly.
 */
export function useDocxFind(input: {
  hostId: string;
  root: string;
  path: string;
  query: string;
  enabled: boolean;
}): DocxFind {
  const findDocx = useRpc(findDocxRpc);
  const query = input.query.trim();
  const enabled = input.enabled && query.length > 0;
  const result = useQuery({
    queryKey: ["docs", "find-docx", input.hostId, input.root, input.path, query],
    queryFn: async () => ({
      ...(await findDocx({ root: input.root, path: input.path, query })),
      // Keep the path with the response: placeholder data can outlive a document switch.
      path: input.path,
    }),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const data = result.data?.path === input.path ? result.data : undefined;

  return {
    html: data?.html,
    count: data?.count ?? 0,
    limited: data?.limited ?? false,
    pending: enabled && (result.isPending || result.isPlaceholderData || !data),
    error: enabled && result.isError,
  };
}
