import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { renderMathRpc } from "../shared/docs";

export interface RenderedMath {
  text: string;
  formulas: readonly { placeholder: string; mathml: string; display: boolean }[];
  pending: boolean;
  warnings: readonly string[];
}

/**
 * Desktop only: converts TeX math to MathML placeholders on the daemon. Other clients keep the
 * original Markdown, because they render text without a DOM and cannot host MathML.
 */
export function useRenderedMath(input: {
  hostId: string;
  root: string;
  path: string;
  text: string;
  enabled: boolean;
}): RenderedMath {
  const renderMath = useRpc(renderMathRpc);
  const hasMath = /\$|\\\(|\\\[/.test(input.text);
  const enabled = input.enabled && Platform.OS === "web" && hasMath;
  const query = useQuery({
    queryKey: ["docs", "math", input.hostId, input.root, input.path],
    queryFn: () => renderMath({ text: input.text }),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) {
    return { text: input.text, formulas: [], pending: false, warnings: [] };
  }
  if (query.data) {
    return {
      text: query.data.text,
      formulas: query.data.formulas,
      pending: false,
      warnings: query.data.warnings,
    };
  }
  return {
    text: input.text,
    formulas: [],
    pending: query.isPending,
    warnings: query.isError ? ["公式渲染失败，已显示原文"] : [],
  };
}
