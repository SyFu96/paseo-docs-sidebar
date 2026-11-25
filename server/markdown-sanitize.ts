import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import type { Definition, Nodes } from "mdast";

const REMOTE_IMAGE = /^(?:https?:)?\/\//i;

/** A local placeholder so remote images never reach the network. */
export const BLOCKED_IMAGE_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyODAiIGhlaWdodD0iNDAiPjxyZWN0IHg9IjAuNSIgeT0iMC41IiB3aWR0aD0iMjc5IiBoZWlnaHQ9IjM5IiByeD0iNiIgZmlsbD0iI2Y2ZjhmYSIgc3Ryb2tlPSIjZDBkN2RlIiBzdHJva2UtZGFzaGFycmF5PSI0IDMiLz48dGV4dCB4PSIxNDAiIHk9IjI1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzU3NjA2YSI+UmVtb3RlIGltYWdlIGJsb2NrZWQ8L3RleHQ+PC9zdmc+";

export interface MarkdownSanitizeResult {
  text: string;
  blocked: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Rewrites parsed remote image destinations to a local placeholder. Parsing (rather than scanning
 * lines) covers inline images, image references, definitions whose URL is on the next line, GFM
 * tables, and raw HTML images. Only definitions used by images are rewritten.
 */
export function sanitizeMarkdownImages(source: string): MarkdownSanitizeResult {
  const tree = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  const definitions = new Map<string, Definition>();
  const imageReferences = new Set<string>();
  const edits: Edit[] = [];

  const visit = (node: Nodes) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if (node.type === "imageReference") {
      imageReferences.add(node.identifier);
    }
    if (node.type === "image" && REMOTE_IMAGE.test(node.url)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        edits.push({ start, end, text: blockedImage(node.alt) });
      }
    }
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const raw = source.slice(start, end);
        const replaced = replaceHtmlImages(raw);
        if (replaced !== raw) edits.push({ start, end, text: replaced });
      }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);

  const blockedDefinitions = new Set<string>();
  for (const identifier of imageReferences) {
    const definition = definitions.get(identifier);
    if (!definition || blockedDefinitions.has(identifier) || !REMOTE_IMAGE.test(definition.url)) {
      continue;
    }
    const start = definition.position?.start.offset;
    const end = definition.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    blockedDefinitions.add(identifier);
    edits.push({
      start,
      end,
      text: `[${definition.identifier}]: <${BLOCKED_IMAGE_URL}>`,
    });
  }

  edits.sort((left, right) => right.start - left.start);
  let text = source;
  let cursor = source.length;
  let blocked = 0;
  for (const edit of edits) {
    if (edit.end > cursor) continue;
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    cursor = edit.start;
    blocked += 1;
  }
  return { text, blocked };
}

function blockedImage(alt: string | null | undefined): string {
  const safeAlt = (alt ?? "").replace(/[[\]\\]/g, "\\$&");
  return `![${safeAlt}](<${BLOCKED_IMAGE_URL}>)`;
}

function replaceHtmlImages(raw: string): string {
  return raw.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!src) return tag;
    const value = decodeEntities(src[1] ?? src[2] ?? "");
    if (!REMOTE_IMAGE.test(value)) return tag;
    return tag.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i, `src="${BLOCKED_IMAGE_URL}"`);
  });
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = entity.startsWith("#x")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
    }
  });
}
