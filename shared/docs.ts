import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** A path as the panel stores and displays it: relative to the workspace, forward slashes. */
export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative(),
});

export type FileEntry = z.infer<typeof fileEntrySchema>;

export const listDirectoryRpc = defineRpc({
  name: "docs.list_directory",
  input: z.object({ root: z.string().min(1), path: z.string() }),
  output: z.object({ entries: z.array(fileEntrySchema) }),
});

export const searchFilesRpc = defineRpc({
  name: "docs.search_files",
  input: z.object({
    root: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: z.object({ entries: z.array(fileEntrySchema) }),
});

export const readTextRpc = defineRpc({
  name: "docs.read_text",
  input: z.object({ root: z.string().min(1), path: z.string().min(1) }),
  output: z.object({ text: z.string(), truncated: z.boolean() }),
});

export const readBytesRpc = defineRpc({
  name: "docs.read_bytes",
  input: z.object({ root: z.string().min(1), path: z.string().min(1) }),
  // A top-level Uint8Array crosses the plugin RPC boundary as binary.
  output: z.instanceof(Uint8Array),
});

export const readDocxRpc = defineRpc({
  name: "docs.read_docx",
  input: z.object({ root: z.string().min(1), path: z.string().min(1) }),
  output: z.object({
    // Converted document HTML, ready for DocumentFrame.
    html: z.string(),
    warnings: z.array(z.string()),
  }),
});

export type DocKind = "markdown" | "html" | "pdf" | "docx" | "image" | "text" | "binary";

const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const HTML = new Set(["html", "htm", "xhtml"]);
const DOCX = new Set(["docx", "docm"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "ico"]);
const BINARY = new Set([
  "zip",
  "gz",
  "tar",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "doc",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

export function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? path : path.slice(index + 1);
}

export function fileExtension(path: string): string {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export function docKind(path: string): DocKind {
  const extension = fileExtension(path);
  if (MARKDOWN.has(extension)) return "markdown";
  if (HTML.has(extension)) return "html";
  if (DOCX.has(extension)) return "docx";
  if (extension === "pdf") return "pdf";
  if (IMAGE.has(extension)) return "image";
  if (BINARY.has(extension)) return "binary";
  return "text";
}

export function isTextKind(path: string): boolean {
  const kind = docKind(path);
  return kind === "markdown" || kind === "html" || kind === "text";
}

export function mimeType(path: string): string {
  switch (fileExtension(path)) {
    case "html":
    case "htm":
    case "xhtml":
      return "text/html";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "docm":
      return "application/vnd.ms-word.document.macroEnabled.12";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "json":
      return "application/json";
    case "md":
    case "markdown":
    case "mdx":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

/** A relative path joined with a child name, always with forward slashes. */
export function joinRelative(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

const LINK_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolves a link written inside `fromPath` to a workspace-relative path.
 * Returns null for external links, anchors, and paths that escape the workspace.
 */
export function resolveDocLink(fromPath: string, href: string): string | null {
  let value = href.trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return null;
  if (LINK_SCHEME.test(value)) return null;

  const hash = value.indexOf("#");
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf("?");
  if (query >= 0) value = value.slice(0, query);
  if (!value) return null;

  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw text when the link is not valid percent-encoding.
  }
  value = value.replace(/\\/g, "/");
  if (value.startsWith("//") || value.endsWith("/")) return null;

  const segments = value.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length > 0 ? segments.join("/") : null;
}
