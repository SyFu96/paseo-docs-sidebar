import { promises as fs } from "node:fs";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import {
  findDocxRpc,
  joinRelative,
  listDirectoryRpc,
  readBytesRpc,
  readDocxRpc,
  readTextRpc,
  resolveDocPathRpc,
  searchFilesRpc,
  type FileEntry,
} from "../shared/docs";
import { convertDocx } from "./docx";
import { findDocxText } from "./docx-find";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 30 * 1024 * 1024;
const MAX_SEARCH_ENTRIES = 20_000;
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".expo", ".venv", "__pycache__"]);
const SEARCH_SKIP_DIRECTORIES = new Set([...SKIP_DIRECTORIES, "dist", "build", ".next", "coverage"]);
const RESOLVE_CACHE_MS = 30_000;
const RESOLVE_CACHE_LIMIT = 100;
const resolveCache = new Map<string, { at: number; path: string | null }>();

function assertRoot(root: string): string {
  if (!path.isAbsolute(root)) throw new Error("工作区路径必须是绝对路径");
  return path.resolve(root);
}

/** Resolves a relative path and refuses anything that escapes the workspace. */
function resolveInside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("路径超出工作区范围");
  }
  return target;
}

/** Resolves symlinks and confirms the real target stays inside the workspace. */
async function resolveRealInside(root: string, relative: string): Promise<string> {
  const target = resolveInside(root, relative);
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("路径超出工作区范围");
  }
  return realTarget;
}

/**
 * Reads accept a unique path-tail match when the exact path is missing. Agent output often names
 * a file relative to a subdirectory; an exact path still wins, and ambiguous or missing tails
 * still throw the original error.
 */
async function resolveReadableFile(root: string, relative: string): Promise<string> {
  try {
    return await resolveRealInside(root, relative);
  } catch (original) {
    const resolved = await resolveDocPath({ root, path: relative, suffix: true }).catch(() => null);
    if (!resolved?.path) throw original;
    try {
      return await resolveRealInside(root, resolved.path);
    } catch {
      throw original;
    }
  }
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export async function listDirectory({
  root,
  path: relative,
}: RpcInput<typeof listDirectoryRpc>): Promise<{ entries: FileEntry[] }> {
  const workspaceRoot = assertRoot(root);
  const directory = await resolveRealInside(workspaceRoot, relative);
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const dirent of dirents) {
    if (SKIP_DIRECTORIES.has(dirent.name)) continue;
    const absolute = path.join(directory, dirent.name);
    // stat follows symlinks; a link outside the workspace still lists, but opening it is refused.
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) continue;
    entries.push({
      name: dirent.name,
      path: joinRelative(relative, dirent.name),
      kind: stat.isDirectory() ? "directory" : "file",
      size: stat.size,
    });
  }
  return { entries: sortEntries(entries) };
}

export async function readTextFile({
  root,
  path: relative,
}: RpcInput<typeof readTextRpc>): Promise<{ text: string; truncated: boolean }> {
  const workspaceRoot = assertRoot(root);
  const file = await resolveReadableFile(workspaceRoot, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("不是文件");
  const limit = Math.min(stat.size, MAX_TEXT_BYTES);
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: stat.size > bytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function readBinaryFile({
  root,
  path: relative,
}: RpcInput<typeof readBytesRpc>): Promise<Uint8Array> {
  const workspaceRoot = assertRoot(root);
  const file = await resolveReadableFile(workspaceRoot, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("不是文件");
  if (stat.size > MAX_BINARY_BYTES) throw new Error("文件过大，无法预览");
  const data = await fs.readFile(file);
  return new Uint8Array(data);
}

export async function readDocxFile({
  root,
  path: relative,
}: RpcInput<typeof readDocxRpc>): Promise<{ html: string; warnings: string[] }> {
  const workspaceRoot = assertRoot(root);
  const file = await resolveReadableFile(workspaceRoot, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("不是文件");
  if (stat.size > MAX_BINARY_BYTES) throw new Error("文件过大，无法预览");
  const data = await fs.readFile(file);
  return convertDocx(data);
}

export async function findDocxFile({
  root,
  path: relative,
  query,
}: RpcInput<typeof findDocxRpc>): Promise<{
  html: string;
  count: number;
  limited: boolean;
}> {
  const workspaceRoot = assertRoot(root);
  const file = await resolveReadableFile(workspaceRoot, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("不是文件");
  if (stat.size > MAX_BINARY_BYTES) throw new Error("文件过大，无法预览");
  const data = await fs.readFile(file);
  const converted = convertDocx(data);
  return findDocxText(converted.html, query);
}

export async function searchFiles({
  root,
  query,
  limit,
}: RpcInput<typeof searchFilesRpc>): Promise<{ entries: FileEntry[] }> {
  const workspaceRoot = await fs.realpath(assertRoot(root));
  const needle = query.trim().toLowerCase();
  const found: FileEntry[] = [];
  const queue = [""];
  let visited = 0;
  while (queue.length > 0 && found.length < limit && visited < MAX_SEARCH_ENTRIES) {
    const relative = queue.shift() ?? "";
    const directory = resolveInside(workspaceRoot, relative);
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (visited >= MAX_SEARCH_ENTRIES || found.length >= limit) break;
      visited += 1;
      if (SEARCH_SKIP_DIRECTORIES.has(dirent.name)) continue;
      const child = joinRelative(relative, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (dirent.isFile() && child.toLowerCase().includes(needle)) {
        found.push({ name: dirent.name, path: child, kind: "file", size: 0 });
      }
    }
  }
  return { entries: found.sort((left, right) => left.path.localeCompare(right.path)) };
}

function cacheResolvedPath(key: string, value: string | null): void {
  resolveCache.set(key, { at: Date.now(), path: value });
  if (resolveCache.size > RESOLVE_CACHE_LIMIT) {
    const oldest = resolveCache.keys().next().value;
    if (oldest !== undefined) resolveCache.delete(oldest);
  }
}

async function exactDocPath(workspaceRoot: string, candidate: string): Promise<string | null> {
  try {
    const target = resolveInside(workspaceRoot, candidate);
    const stat = await fs.stat(target);
    if (!stat.isFile()) return null;
    return path.relative(workspaceRoot, target).split(path.sep).join("/") || null;
  } catch {
    return null;
  }
}

/** Finds a unique file whose workspace path ends with the requested tail. */
async function suffixDocPath(
  workspaceRoot: string,
  candidate: string,
): Promise<string | null> {
  const needle = candidate.toLowerCase();
  const queue = [""];
  const matches: string[] = [];
  let head = 0;
  let visited = 0;
  while (head < queue.length && visited < MAX_SEARCH_ENTRIES) {
    const relative = queue[head];
    head += 1;
    const directory = resolveInside(workspaceRoot, relative);
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (visited >= MAX_SEARCH_ENTRIES) break;
      visited += 1;
      if (SEARCH_SKIP_DIRECTORIES.has(dirent.name)) continue;
      const child = joinRelative(relative, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (!dirent.isFile()) continue;
      const lower = child.toLowerCase();
      if (lower === needle || lower.endsWith(`/${needle}`)) {
        matches.push(child);
        // More than one tail match is ambiguous; keep the strict path instead of guessing.
        if (matches.length > 1) return null;
      }
    }
  }
  return matches[0] ?? null;
}

export async function resolveDocPath({
  root,
  path: candidate,
  suffix,
}: RpcInput<typeof resolveDocPathRpc>): Promise<{ path: string | null }> {
  const workspaceRoot = await fs.realpath(assertRoot(root));
  const normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized) return { path: null };

  const key = `${workspaceRoot}\u0000${normalized}\u0000${suffix ? "1" : "0"}`;
  const cached = resolveCache.get(key);
  let resolved: string | null;
  if (cached && Date.now() - cached.at < RESOLVE_CACHE_MS) {
    resolved = cached.path;
  } else {
    const exact = await exactDocPath(workspaceRoot, normalized);
    resolved = exact ?? (suffix ? await suffixDocPath(workspaceRoot, normalized) : null);
    cacheResolvedPath(key, resolved);
  }
  return { path: resolved };
}
