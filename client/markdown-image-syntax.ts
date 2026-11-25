const MAX_IMAGES = 40;

const INLINE_IMAGE =
  /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
const REFERENCE_DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Collects relative image destinations from inline images, HTML images, and reference definitions. */
export function extractImageSources(text: string): string[] {
  const sources = new Set<string>();
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const match of line.matchAll(INLINE_IMAGE)) {
      addSource(sources, match[2]);
    }
    for (const match of line.matchAll(HTML_IMAGE)) {
      addSource(sources, match[1] ?? match[2] ?? "");
    }
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) addSource(sources, definition[2]);
  }
  return [...sources].slice(0, MAX_IMAGES);
}

function addSource(sources: Set<string>, raw: string): void {
  const source = normalizeSource(raw);
  if (!source || sources.size >= MAX_IMAGES) return;
  const external = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(source);
  if (external && !/^file:\/\//i.test(source)) return;
  sources.add(source);
}

function normalizeSource(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  return decodeEntities(value);
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

/** Rewrites known image destinations to display URLs, leaving everything else untouched. */
export function rewriteMarkdownImages(
  text: string,
  urls: ReadonlyMap<string, string>,
): string {
  if (urls.size === 0) return text;
  const parts = text.split(/(\r?\n)/);
  let inFence = false;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    let next = line.replace(
      INLINE_IMAGE,
      (match, alt: string, destination: string, title: string | undefined) => {
        const url = urls.get(normalizeSource(destination));
        if (!url) return match;
        return `![${alt}](<${url}>${title ?? ""})`;
      },
    );
    next = next.replace(HTML_IMAGE, (tag, doubleQuoted: string, singleQuoted: string) => {
      const destination = doubleQuoted ?? singleQuoted ?? "";
      const url = urls.get(normalizeSource(destination));
      if (!url) return tag;
      return tag.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i, `src="${url}"`);
    });
    next = next.replace(
      REFERENCE_DEFINITION,
      (match, prefix: string, destination: string, suffix: string) => {
        const url = urls.get(normalizeSource(destination));
        if (!url) return match;
        return `${prefix}<${url}>${suffix}`;
      },
    );
    parts[index] = next;
  }
  return parts.join("");
}
