import katex from "katex";

const MAX_FORMULAS = 300;
const MAX_MATHML_LENGTH = 4 * 1024 * 1024;
const CODE_START = "\uE100";
const CODE_END = "\uE101";
const MATH_START = "\uE000";
const MATH_END = "\uE001";
const ESCAPED_DOLLAR = "\uE200";

export interface RenderedFormula {
  placeholder: string;
  mathml: string;
  display: boolean;
}

export interface MathRenderResult {
  text: string;
  formulas: RenderedFormula[];
  warnings: string[];
}

/**
 * Converts TeX math in Markdown to MathML placeholders. The client replaces each placeholder with
 * the MathML element after rendering, because Paseo's plugin Markdown does not expose latexMath.
 */
export function renderMathInMarkdown(source: string): MathRenderResult {
  if (!/\$|\\\(|\\\[/.test(source)) {
    return { text: source, formulas: [], warnings: [] };
  }

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const code: string[] = [];
  let text = protectCode(source, code);
  text = text.split("\\$").join(ESCAPED_DOLLAR);

  const formulas: RenderedFormula[] = [];
  let mathmlLength = 0;

  const replace = (pattern: RegExp, display: boolean) => {
    text = text.replace(pattern, (match, body: string) => {
      const tex = display ? body.trim() : body;
      if (!tex) return match;
      if (!display && (/^\s/.test(tex) || /\s$/.test(tex) || /^[\d.,]+$/.test(tex))) {
        return match;
      }
      if (formulas.length >= MAX_FORMULAS) {
        warn("公式数量过多，部分公式未渲染");
        return match;
      }
      const mathml = toMathml(tex, display);
      if (!mathml) {
        warn("部分公式无法解析，已保留原文");
        return match;
      }
      if (mathmlLength + mathml.length > MAX_MATHML_LENGTH) {
        warn("公式内容过大，部分公式未渲染");
        return match;
      }
      mathmlLength += mathml.length;
      const placeholder = `${MATH_START}${formulas.length}${MATH_END}`;
      formulas.push({ placeholder, mathml, display });
      return placeholder;
    });
  };

  replace(/\$\$([\s\S]+?)\$\$/g, true);
  replace(/\\\[([\s\S]+?)\\\]/g, true);
  replace(/\$(?!\$)([^\n$]+?)\$(?!\$)/g, false);
  replace(/\\\(([\s\S]+?)\\\)/g, false);

  text = text.split(ESCAPED_DOLLAR).join("\\$");
  text = restoreCode(text, code);
  return { text, formulas, warnings };
}

function toMathml(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    if (html.includes("katex-error")) return null;
    const start = html.indexOf("<math");
    const end = html.indexOf("</math>");
    if (start < 0 || end < 0) return null;
    return html.slice(start, end + "</math>".length);
  } catch {
    return null;
  }
}

/** Replaces fenced code blocks and inline code spans with sentinels before math parsing. */
function protectCode(source: string, store: string[]): string {
  const ranges: { start: number; end: number }[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let open: { start: number; marker: string } | null = null;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (fence && fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length) {
        ranges.push({ start: open.start, end: lineStart + line.length });
        open = null;
      }
    } else if (fence) {
      open = { start: lineStart, marker: fence[1] };
    }
  }
  if (open) ranges.push({ start: open.start, end: source.length });

  const inFence = (index: number) =>
    ranges.some((range) => index >= range.start && index < range.end);
  for (const match of source.matchAll(/(`+)([\s\S]*?)\1/g)) {
    if (!inFence(match.index)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  ranges.sort((left, right) => left.start - right.start);
  let result = source;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    const sentinel = `${CODE_START}${store.length}${CODE_END}`;
    store.push(result.slice(range.start, range.end));
    result = result.slice(0, range.start) + sentinel + result.slice(range.end);
  }
  return result;
}

function restoreCode(text: string, store: string[]): string {
  return text.replace(/\uE100(\d+)\uE101/g, (match, index: string) => store[Number(index)] ?? match);
}
