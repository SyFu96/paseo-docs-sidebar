const REVEAL_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "html",
  "htm",
  "xhtml",
  "pdf",
  "docx",
  "docm",
  "txt",
]);

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
const LINE_SUFFIX = /:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/;
const PAREN_LINE_SUFFIX = /\(L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?\)$/i;
const HASH_LINE_SUFFIX = /#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripLineSuffix(value: string): string {
  return value
    .replace(PAREN_LINE_SUFFIX, "")
    .replace(HASH_LINE_SUFFIX, "")
    .replace(LINE_SUFFIX, "");
}

/**
 * Turns a chat link href into a plain local path. Returns null for external links, anchors, and
 * anything that is not a path we can hand to the Docs panel.
 */
export function cleanDocHref(href: string): string | null {
  let value = href.trim();
  if (!value || value.startsWith("#")) return null;
  // Supported document links open at the file; source links keep Paseo's line navigation.
  value = stripLineSuffix(value);

  if (/^file:\/\//i.test(value)) {
    // file:///C:/repo/report.md, file://C:/repo/report.md, and file://server/share/report.md
    const rest = value.replace(/^file:\/\//i, "");
    if (/^[a-z]:\//i.test(rest)) {
      value = rest;
    } else {
      value = rest.startsWith("/") ? rest : `//${rest}`;
      if (value.startsWith("/") && /^\/[a-z]:\//i.test(value)) value = value.slice(1);
    }
  } else if (!WINDOWS_DRIVE.test(value) && EXTERNAL_SCHEME.test(value)) {
    return null;
  }

  value = value.split("?")[0].split("#")[0];
  value = safeDecode(value);
  value = normalizeSlashes(value).trim();
  return value || null;
}

export function isAbsoluteDocPath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE.test(value) || value.startsWith("//");
}

/** Normalizes an absolute path for comparison. Keeps a Windows drive without its leading slash. */
export function normalizeAbsolutePath(value: string): string {
  let path = normalizeSlashes(value).trim();
  if (path.startsWith("//")) {
    path = `//${path.slice(2).replace(/\/+/g, "/")}`;
  } else {
    path = path.replace(/\/+/g, "/");
    if (path.startsWith("/") && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
  }
  return path.replace(/\/+$/, "");
}

function caseInsensitiveFor(root: string): boolean {
  return WINDOWS_DRIVE.test(root) || root.startsWith("//");
}

/**
 * Returns the workspace-relative path for an absolute path inside `root`, the cleaned relative
 * path for a relative one, and null when the path escapes the workspace.
 */
export function workspaceRelativePath(value: string, root: string): string | null {
  let relative = normalizeSlashes(value).trim();
  if (isAbsoluteDocPath(relative)) {
    const normalizedRoot = normalizeAbsolutePath(root);
    const normalizedPath = normalizeAbsolutePath(relative);
    const insensitive = caseInsensitiveFor(normalizedRoot);
    const compareRoot = insensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
    const comparePath = insensitive ? normalizedPath.toLowerCase() : normalizedPath;
    if (comparePath === compareRoot) return null;
    if (!comparePath.startsWith(`${compareRoot}/`)) return null;
    relative = normalizedPath.slice(normalizedRoot.length + 1);
  } else {
    relative = relative.replace(/^\.\//, "");
  }

  const segments: string[] = [];
  for (const segment of relative.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export function isSupportedRevealPath(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  return REVEAL_EXTENSIONS.has(extension);
}
