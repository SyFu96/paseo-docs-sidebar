import { Platform } from "react-native";
import {
  cleanDocHref,
  isAbsoluteDocPath,
  isSupportedRevealPath,
  workspaceRelativePath,
} from "./doc-reveal-path";

export interface DocRevealTarget {
  workspaceId: string;
  path: string;
}

export interface DocReveal extends DocRevealTarget {
  nonce: number;
  requestedAt: number;
}

interface DocsWorkspace {
  workspaceId: string;
  directory: string;
}

const mounted = new Map<string, string>();
let active: DocsWorkspace | null = null;
let pending: DocReveal | null = null;
let nonce = 0;
const listeners = new Set<(reveal: DocReveal) => void>();

/** The Docs panel announces the workspace it belongs to while it is mounted. */
export function rememberDocsWorkspace(workspaceId: string, directory: string): void {
  if (!workspaceId || !directory) return;
  mounted.set(workspaceId, directory);
  active = { workspaceId, directory };
}

export function forgetDocsWorkspace(workspaceId: string): void {
  mounted.delete(workspaceId);
  if (active?.workspaceId !== workspaceId) return;
  active = null;
  // Map iteration follows insertion order, so the last entry is the most recently mounted panel.
  for (const [id, directory] of mounted) active = { workspaceId: id, directory };
}

/**
 * Resolves a link from agent output to a workspace-relative document path. Absolute paths are
 * matched against known workspace roots; relative paths use the workspace in the current route or
 * the mounted Docs panel. Returns null when the link should keep Paseo's normal behavior.
 */
export function resolveDocReveal(
  href: string,
  routeWorkspaceId: string | null,
  getRoot: (workspaceId: string) => string | null,
): DocRevealTarget | null {
  if (Platform.OS !== "web") return null;
  const cleaned = cleanDocHref(href);
  if (!cleaned) return null;

  const candidates = new Map<string, string>(mounted);
  let routeRoot: string | null = null;
  if (routeWorkspaceId) {
    try {
      routeRoot = getRoot(routeWorkspaceId);
    } catch {
      routeRoot = null;
    }
    if (routeRoot) candidates.set(routeWorkspaceId, routeRoot);
  }
  if (active && !candidates.has(active.workspaceId)) {
    candidates.set(active.workspaceId, active.directory);
  }

  if (isAbsoluteDocPath(cleaned)) {
    for (const [workspaceId, directory] of candidates) {
      const relative = workspaceRelativePath(cleaned, directory);
      if (relative && isSupportedRevealPath(relative)) {
        return { workspaceId, path: relative };
      }
    }
    return null;
  }

  const workspaceId = routeWorkspaceId ?? active?.workspaceId ?? null;
  if (!workspaceId) return null;
  const directory = candidates.get(workspaceId);
  if (!directory) return null;
  const relative = workspaceRelativePath(cleaned, directory);
  if (!relative || !isSupportedRevealPath(relative)) return null;
  return { workspaceId, path: relative };
}

/** Queues a file for the Docs panel and wakes a mounted panel immediately. */
export function requestDocReveal(workspaceId: string, path: string): void {
  const reveal: DocReveal = {
    workspaceId,
    path,
    nonce: (nonce += 1),
    requestedAt: Date.now(),
  };
  pending = reveal;
  for (const listener of [...listeners]) listener(reveal);
}

/**
 * Takes a queued reveal for one panel. Requests expire so a panel opened much later does not jump
 * to a document the user asked for in another context.
 */
export function takeDocReveal(workspaceId: string): DocReveal | null {
  if (!pending || pending.workspaceId !== workspaceId) return null;
  if (Date.now() - pending.requestedAt > 15_000) {
    pending = null;
    return null;
  }
  const reveal = pending;
  pending = null;
  return reveal;
}

export function subscribeDocReveal(listener: (reveal: DocReveal) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
