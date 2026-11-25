import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_COUNT = 80;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const EMU_PER_PIXEL = 9525;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

interface ZipEntry {
  name: string;
  flags: number;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface StyleInfo {
  name: string;
  outline: number | null;
}

type NumberingMap = Map<string, Map<number, string>>;

interface ParserContext {
  data: Buffer;
  entries: Map<string, ZipEntry>;
  relationships: Map<string, string>;
  styles: Map<string, StyleInfo>;
  numbering: NumberingMap;
}

interface Tag {
  prefix: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Map<string, string>;
}

interface CellMeta {
  colspan: number;
  vMerge: string | null;
}

export interface DocxConversion {
  html: string;
  warnings: string[];
}

export function convertDocx(data: Buffer): DocxConversion {
  const entries = readZipEntries(data);
  const documentEntry = entries.get("word/document.xml");
  if (!documentEntry) throw new Error("不是有效的 Word 文档");
  if (documentEntry.uncompressedSize > MAX_DOCUMENT_XML_BYTES) {
    throw new Error("Word 文档内容过大，无法预览");
  }
  const documentXml = readZipEntry(data, documentEntry, MAX_DOCUMENT_XML_BYTES);
  if (!documentXml) throw new Error("无法读取 Word 文档内容");

  const parser = new DocumentParser({
    data,
    entries,
    relationships: parseRelationships(
      readOptionalXml(data, entries, "word/_rels/document.xml.rels"),
    ),
    styles: parseStyles(readOptionalXml(data, entries, "word/styles.xml")),
    numbering: parseNumbering(readOptionalXml(data, entries, "word/numbering.xml")),
  });
  const body = parser.parse(documentXml.toString("utf8"));
  if (body.length > MAX_HTML_BYTES) throw new Error("Word 文档内容过大，无法预览");
  return { html: buildHtml(body), warnings: parser.warnings };
}

function findEocd(data: Buffer): number {
  if (data.length < 22) throw new Error("不是有效的 Word 文档");
  const start = Math.max(0, data.length - 22 - 0xffff);
  for (let offset = data.length - 22; offset >= start; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("不是有效的 Word 文档");
}

function readZipEntries(data: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(data);
  const count = data.readUInt16LE(eocd + 10);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("暂不支持 ZIP64 格式的 Word 文档");
  }

  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("Word 文档目录损坏");
    }
    const flags = data.readUInt16LE(offset + 8);
    const compression = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("暂不支持 ZIP64 格式的 Word 文档");
    }
    const nameStart = offset + 46;
    const name = data.toString("utf8", nameStart, nameStart + nameLength);
    if (name && !name.endsWith("/")) {
      entries.set(name, {
        name,
        flags,
        compression,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(data: Buffer, entry: ZipEntry, limit: number): Buffer | null {
  if (entry.uncompressedSize > limit) return null;
  if ((entry.flags & 0x1) !== 0) throw new Error("加密的 Word 文档无法预览");
  const local = entry.localHeaderOffset;
  if (local + 30 > data.length || data.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error("Word 文档结构损坏");
  }
  const nameLength = data.readUInt16LE(local + 26);
  const extraLength = data.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > data.length) throw new Error("Word 文档结构损坏");
  const compressed = data.subarray(start, end);

  if (entry.compression === 0) {
    return compressed.length > limit ? null : Buffer.from(compressed);
  }
  if (entry.compression === 8) {
    try {
      const output = inflateRawSync(compressed, { maxOutputLength: limit });
      return output.length > limit ? null : output;
    } catch {
      throw new Error("Word 文档内容损坏");
    }
  }
  throw new Error("Word 文档使用了不支持的压缩方式");
}

function readOptionalXml(
  data: Buffer,
  entries: Map<string, ZipEntry>,
  name: string,
): string | null {
  const entry = entries.get(name);
  if (!entry || entry.uncompressedSize > MAX_DOCUMENT_XML_BYTES) return null;
  try {
    const buffer = readZipEntry(data, entry, MAX_DOCUMENT_XML_BYTES);
    return buffer ? buffer.toString("utf8") : null;
  } catch {
    return null;
  }
}

function normalizeZipPath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments: string[] = [];
  for (const part of `${base}/${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

function parseRelationships(xml: string | null): Map<string, string> {
  const relationships = new Map<string, string>();
  if (!xml) return relationships;
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = parseAttributes(match[0]);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (!id || !target || attrs.get("TargetMode") === "External") continue;
    relationships.set(id, normalizeZipPath("word", decodeXmlEntities(target)));
  }
  return relationships;
}

function parseStyles(xml: string | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  for (const match of xml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const block = match[0];
    const opening = /^<w:style\b[^>]*>/.exec(block)?.[0];
    if (!opening) continue;
    const attrs = parseAttributes(opening);
    if (getAttr(attrs, "type") !== "paragraph") continue;
    const styleId = getAttr(attrs, "styleId");
    if (!styleId) continue;
    const name = /<w:name\b[^>]*\bw:val="([^"]*)"/.exec(block)?.[1] ?? "";
    const outline = /<w:outlineLvl\b[^>]*\bw:val="(\d+)"/.exec(block)?.[1];
    styles.set(styleId, {
      name: decodeXmlEntities(name),
      outline: outline === undefined ? null : Number(outline),
    });
  }
  return styles;
}

function parseNumbering(xml: string | null): NumberingMap {
  const abstract = new Map<string, Map<number, string>>();
  if (xml) {
    for (const match of xml.matchAll(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g)) {
      const block = match[0];
      const id = /<w:abstractNum\b[^>]*\bw:abstractNumId="([^"]*)"/.exec(block)?.[1];
      if (!id) continue;
      const levels = new Map<number, string>();
      for (const levelMatch of block.matchAll(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/g)) {
        const levelBlock = levelMatch[0];
        const level = Number(
          /<w:lvl\b[^>]*\bw:ilvl="(\d+)"/.exec(levelBlock)?.[1] ?? "0",
        );
        const format = /<w:numFmt\b[^>]*\bw:val="([^"]*)"/.exec(levelBlock)?.[1] ?? "bullet";
        levels.set(level, format);
      }
      abstract.set(id, levels);
    }
  }

  const numbering = new Map<string, Map<number, string>>();
  if (xml) {
    for (const match of xml.matchAll(/<w:num\b[^>]*>[\s\S]*?<\/w:num>/g)) {
      const block = match[0];
      const numId = /<w:num\b[^>]*\bw:numId="([^"]*)"/.exec(block)?.[1];
      const abstractId = /<w:abstractNumId\b[^>]*\bw:val="([^"]*)"/.exec(block)?.[1];
      if (!numId || !abstractId) continue;
      const levels = abstract.get(abstractId);
      if (levels) numbering.set(numId, levels);
    }
  }
  return numbering;
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs.set(match[1], match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function getAttr(attrs: Map<string, string>, name: string): string | undefined {
  const direct = attrs.get(name);
  if (direct !== undefined) return direct;
  for (const [key, value] of attrs) {
    if (key.endsWith(`:${name}`)) return value;
  }
  return undefined;
}

function parseTag(raw: string): Tag {
  const closing = raw.startsWith("</");
  let body = raw.slice(closing ? 2 : 1, raw.endsWith(">") ? -1 : undefined).trim();
  const selfClosing = body.endsWith("/");
  if (selfClosing) body = body.slice(0, -1).trim();
  const space = body.search(/\s/);
  const rawName = space < 0 ? body : body.slice(0, space);
  const colon = rawName.indexOf(":");
  return {
    prefix: colon >= 0 ? rawName.slice(0, colon) : "",
    name: colon >= 0 ? rawName.slice(colon + 1) : rawName,
    closing,
    selfClosing,
    attrs: parseAttributes(space < 0 ? "" : body.slice(space + 1)),
  };
}

function decodeXmlEntities(value: string): string {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeAlign(value: string | null): string | null {
  if (!value) return null;
  if (value === "both") return "justify";
  return ALIGNMENTS.has(value) ? value : null;
}

function enabled(tag: Tag): boolean {
  const value = getAttr(tag.attrs, "val");
  return value !== "0" && value !== "false" && value !== "off";
}

class DocumentParser {
  readonly warnings: string[] = [];

  private readonly context: ParserContext;
  private readonly buffers: string[][] = [[]];
  private paragraph: string[] = [];
  private run: string[] = [];
  private textBuffer: string[] = [];

  private inParagraph = false;
  private inRun = false;
  private inText = false;
  private inPPr = false;
  private inNumPr = false;
  private inRPr = false;
  private inTableCellProps = false;
  private deleteDepth = 0;

  private paragraphStyleId = "";
  private outlineLevel: number | null = null;
  private numberId: string | null = null;
  private numberLevel = 0;
  private alignment: string | null = null;
  private pageBreakBefore = false;

  private bold = false;
  private italic = false;
  private underline = false;
  private strike = false;
  private superscript = false;
  private subscript = false;

  private listTag: "ul" | "ol" | null = null;
  private pendingExtent: { width: number; height: number } | null = null;
  private cellMeta: CellMeta | null = null;
  private imageBytes = 0;
  private imageCount = 0;

  constructor(context: ParserContext) {
    this.context = context;
  }

  parse(xml: string): string {
    const cleaned = xml
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\?[\s\S]*?\?>/g, "");
    for (const token of cleaned.matchAll(/<[^>]*>|[^<]+/g)) {
      const value = token[0];
      if (!value.startsWith("<")) {
        this.handleText(value);
        continue;
      }
      if (value.startsWith("<!") || value.startsWith("<?")) continue;
      const tag = parseTag(value);
      if (tag.closing) this.close(tag);
      else this.open(tag);
    }
    this.closeList();
    return this.buffers[0].join("");
  }

  private open(tag: Tag): void {
    switch (tag.name) {
      case "p":
        this.startParagraph();
        break;
      case "pPr":
        this.inPPr = true;
        break;
      case "pStyle":
        if (this.inPPr) this.paragraphStyleId = getAttr(tag.attrs, "val") ?? "";
        break;
      case "outlineLvl":
        if (this.inPPr) {
          const value = Number(getAttr(tag.attrs, "val") ?? "");
          this.outlineLevel = Number.isFinite(value) ? value : null;
        }
        break;
      case "numPr":
        if (this.inPPr) this.inNumPr = true;
        break;
      case "ilvl":
        if (this.inNumPr) {
          const value = Number(getAttr(tag.attrs, "val") ?? "");
          this.numberLevel = Number.isFinite(value) ? Math.max(0, Math.min(8, value)) : 0;
        }
        break;
      case "numId":
        if (this.inNumPr) this.numberId = getAttr(tag.attrs, "val") ?? null;
        break;
      case "jc":
        if (this.inPPr) this.alignment = getAttr(tag.attrs, "val") ?? null;
        break;
      case "pageBreakBefore":
        if (this.inPPr) this.pageBreakBefore = true;
        break;
      case "r":
        this.startRun();
        break;
      case "rPr":
        this.inRPr = true;
        break;
      case "b":
        if (this.inRPr) this.bold = enabled(tag);
        break;
      case "i":
        if (this.inRPr) this.italic = enabled(tag);
        break;
      case "u":
        if (this.inRPr) this.underline = getAttr(tag.attrs, "val") !== "none";
        break;
      case "strike":
        if (this.inRPr) this.strike = enabled(tag);
        break;
      case "vertAlign":
        if (this.inRPr) {
          const value = getAttr(tag.attrs, "val");
          this.superscript = value === "superscript";
          this.subscript = value === "subscript";
        }
        break;
      case "t":
        if (tag.prefix === "w" || tag.prefix === "m") {
          this.inText = true;
          this.textBuffer = [];
        }
        break;
      case "tab":
        this.appendText("    ");
        break;
      case "br":
        this.appendRaw(
          getAttr(tag.attrs, "type") === "page"
            ? '<span class="page-break"></span>'
            : "<br>",
        );
        break;
      case "cr":
        this.appendRaw("<br>");
        break;
      case "drawing":
        this.pendingExtent = null;
        break;
      case "extent":
        this.captureExtent(tag);
        break;
      case "blip":
        this.appendImage(getAttr(tag.attrs, "embed"));
        break;
      case "imagedata":
        this.appendImage(getAttr(tag.attrs, "id"));
        break;
      case "tbl":
        this.closeList();
        this.appendRaw("<table>");
        break;
      case "tr":
        this.closeList();
        this.appendRaw("<tr>");
        break;
      case "tc":
        this.closeList();
        this.buffers.push([]);
        this.cellMeta = null;
        break;
      case "tcPr":
        this.inTableCellProps = true;
        break;
      case "gridSpan":
        if (this.inTableCellProps) {
          const value = Number(getAttr(tag.attrs, "val") ?? "");
          this.cellMeta = {
            colspan: Number.isFinite(value) ? Math.max(1, value) : 1,
            vMerge: this.cellMeta?.vMerge ?? null,
          };
        }
        break;
      case "vMerge":
        if (this.inTableCellProps) {
          this.cellMeta = {
            colspan: this.cellMeta?.colspan ?? 1,
            vMerge: getAttr(tag.attrs, "val") ?? "continue",
          };
        }
        break;
      case "del":
        this.deleteDepth += 1;
        break;
      default:
        break;
    }
  }

  private close(tag: Tag): void {
    switch (tag.name) {
      case "p":
        this.finishParagraph();
        break;
      case "pPr":
        this.inPPr = false;
        this.inNumPr = false;
        break;
      case "r":
        this.finishRun();
        break;
      case "rPr":
        this.inRPr = false;
        break;
      case "t":
        if (tag.prefix === "w" || tag.prefix === "m") this.flushText();
        break;
      case "tc":
        this.finishCell();
        break;
      case "tcPr":
        this.inTableCellProps = false;
        break;
      case "tr":
        this.closeList();
        this.appendRaw("</tr>");
        break;
      case "tbl":
        this.closeList();
        this.appendRaw("</table>");
        break;
      case "del":
        this.deleteDepth = Math.max(0, this.deleteDepth - 1);
        break;
      default:
        break;
    }
  }

  private handleText(value: string): void {
    if (this.inText) this.textBuffer.push(value);
  }

  private flushText(): void {
    this.inText = false;
    const raw = this.textBuffer.join("");
    this.textBuffer = [];
    if (this.deleteDepth > 0) return;
    const value = escapeHtml(decodeXmlEntities(raw));
    if (this.inRun) this.run.push(value);
    else this.paragraph.push(value);
  }

  private startParagraph(): void {
    if (this.inParagraph) this.finishParagraph();
    this.inParagraph = true;
    this.paragraph = [];
    this.paragraphStyleId = "";
    this.outlineLevel = null;
    this.numberId = null;
    this.numberLevel = 0;
    this.alignment = null;
    this.pageBreakBefore = false;
  }

  private finishParagraph(): void {
    if (!this.inParagraph) return;
    const inner = this.paragraph.join("");
    const styleId = this.paragraphStyleId;
    const outlineLevel = this.outlineLevel;
    const numberId = this.numberId;
    const numberLevel = this.numberLevel;
    const alignment = normalizeAlign(this.alignment);
    const pageBreakBefore = this.pageBreakBefore;
    this.inParagraph = false;
    this.paragraph = [];

    const heading = this.resolveHeading(styleId, outlineLevel);
    const list = this.resolveList(numberId, numberLevel);
    if (!inner.trim() && !pageBreakBefore) return;
    if (pageBreakBefore) {
      this.closeList();
      this.appendRaw('<span class="page-break"></span>');
    }
    if (list) {
      if (this.listTag !== list.tag) {
        this.closeList();
        this.appendRaw(`<${list.tag}>`);
        this.listTag = list.tag;
      }
      const indent = list.level > 0 ? ` style="margin-left:${list.level * 18}px"` : "";
      this.appendRaw(`<li${indent}>${inner}</li>`);
      return;
    }
    this.closeList();
    const tag = heading.title ? "h1" : heading.subtitle ? "p" : heading.level ? `h${heading.level}` : "p";
    const className = heading.title
      ? ' class="doc-title"'
      : heading.subtitle
        ? ' class="doc-subtitle"'
        : "";
    const style = alignment ? ` style="text-align:${alignment}"` : "";
    this.appendRaw(`<${tag}${className}${style}>${inner}</${tag}>`);
  }

  private resolveHeading(
    styleId: string,
    outlineLevel: number | null,
  ): { level: number; title: boolean; subtitle: boolean } {
    const style = this.context.styles.get(styleId);
    const name = (style?.name ?? "").toLowerCase();
    const id = styleId.toLowerCase();
    if (id === "title" || name === "title") return { level: 1, title: true, subtitle: false };
    if (id === "subtitle" || name === "subtitle") {
      return { level: 0, title: false, subtitle: true };
    }
    const fromId = /^heading\s*([1-6])$/i.exec(styleId);
    const fromName = /^(?:heading|标题)\s*([1-6])$/i.exec(style?.name ?? "");
    if (fromId) return { level: Number(fromId[1]), title: false, subtitle: false };
    if (fromName) return { level: Number(fromName[1]), title: false, subtitle: false };
    const outline = style?.outline ?? outlineLevel;
    if (outline !== null && outline >= 0 && outline < 6) {
      return { level: outline + 1, title: false, subtitle: false };
    }
    return { level: 0, title: false, subtitle: false };
  }

  private resolveList(
    numberId: string | null,
    level: number,
  ): { tag: "ul" | "ol"; level: number } | null {
    if (!numberId || numberId === "0") return null;
    const format = this.context.numbering.get(numberId)?.get(level) ?? "bullet";
    if (format === "none") return null;
    const ordered = /^(decimal|lowerLetter|upperLetter|lowerRoman|upperRoman|ordinal|cardinalText|ordinalText)$/i.test(
      format,
    );
    return { tag: ordered ? "ol" : "ul", level };
  }

  private startRun(): void {
    if (this.inRun) this.finishRun();
    this.inRun = true;
    this.run = [];
    this.bold = false;
    this.italic = false;
    this.underline = false;
    this.strike = false;
    this.superscript = false;
    this.subscript = false;
  }

  private finishRun(): void {
    if (!this.inRun) return;
    let html = this.run.join("");
    this.inRun = false;
    this.run = [];
    if (!html) return;
    if (this.subscript) html = `<sub>${html}</sub>`;
    else if (this.superscript) html = `<sup>${html}</sup>`;
    if (this.strike) html = `<s>${html}</s>`;
    if (this.underline) html = `<u>${html}</u>`;
    if (this.italic) html = `<em>${html}</em>`;
    if (this.bold) html = `<strong>${html}</strong>`;
    this.paragraph.push(html);
  }

  private finishCell(): void {
    this.closeList();
    const content = this.buffers.pop();
    if (!content || this.buffers.length === 0) return;
    const colspan = this.cellMeta && this.cellMeta.colspan > 1 ? ` colspan="${this.cellMeta.colspan}"` : "";
    this.appendRaw(`<td${colspan}>${content.join("")}</td>`);
    this.cellMeta = null;
  }

  private captureExtent(tag: Tag): void {
    const width = Number(getAttr(tag.attrs, "cx") ?? "");
    const height = Number(getAttr(tag.attrs, "cy") ?? "");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.pendingExtent = {
      width: Math.max(1, Math.round(width / EMU_PER_PIXEL)),
      height: Math.max(1, Math.round(height / EMU_PER_PIXEL)),
    };
  }

  private appendImage(id: string | undefined): void {
    if (!id) return;
    const target = this.context.relationships.get(id);
    if (!target) return;
    const extension = target.slice(target.lastIndexOf(".") + 1).toLowerCase();
    const mime = IMAGE_MIME[extension];
    if (!mime) {
      this.warn(`已跳过不支持的图片格式：${extension.toUpperCase() || "未知"}`);
      return;
    }
    if (this.imageCount >= MAX_IMAGE_COUNT) {
      this.warn("图片数量过多，部分图片未显示");
      return;
    }
    const remaining = MAX_IMAGE_BYTES - this.imageBytes;
    if (remaining <= 0) {
      this.warn("图片总大小过大，部分图片未显示");
      return;
    }
    const entry = this.context.entries.get(target);
    if (!entry) return;
    let bytes: Buffer | null = null;
    try {
      bytes = readZipEntry(this.context.data, entry, remaining);
    } catch {
      bytes = null;
    }
    if (!bytes) {
      this.warn("部分图片过大，未显示");
      return;
    }
    this.imageBytes += bytes.length;
    this.imageCount += 1;
    const extent = this.pendingExtent;
    this.pendingExtent = null;
    const style = extent
      ? ` style="width:${extent.width}px;max-width:100%;height:auto"`
      : ' style="max-width:100%;height:auto"';
    const html = `<img src="data:${mime};base64,${bytes.toString("base64")}" alt=""${style}>`;
    if (this.inRun) this.run.push(html);
    else this.paragraph.push(html);
  }

  private appendText(value: string): void {
    if (this.inRun) this.run.push(value);
    else this.paragraph.push(value);
  }

  private appendRaw(html: string): void {
    this.buffers[this.buffers.length - 1].push(html);
  }

  private closeList(): void {
    if (!this.listTag) return;
    this.appendRaw(`</${this.listTag}>`);
    this.listTag = null;
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

function buildHtml(body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #1f2328; }
  body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-size: 15px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
  main { box-sizing: border-box; max-width: 900px; margin: 0 auto; padding: 44px 56px 72px; }
  h1, h2, h3, h4, h5, h6 { margin: 26px 0 12px; line-height: 1.35; font-weight: 600; }
  h1 { font-size: 26px; }
  h2 { font-size: 22px; }
  h3 { font-size: 19px; }
  h4 { font-size: 17px; }
  h5 { font-size: 16px; }
  h6 { font-size: 15px; color: #57606a; }
  p { margin: 0 0 11px; }
  ul, ol { margin: 0 0 12px; padding-left: 26px; }
  li { margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 18px; font-size: 14px; }
  td { border: 1px solid #d0d7de; padding: 6px 10px; vertical-align: top; }
  tr:nth-child(even) td { background: #f6f8fa; }
  img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
  strong { font-weight: 600; }
  .doc-title { margin: 0 0 18px; font-size: 30px; font-weight: 700; line-height: 1.3; }
  .doc-subtitle { margin: 0 0 18px; color: #57606a; font-size: 18px; }
  .page-break { display: block; height: 0; margin: 22px 0; border-top: 1px dashed #d0d7de; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
