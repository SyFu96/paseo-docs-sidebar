import { promises as fs } from "node:fs";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import {
  joinRelative,
  listDirectoryRpc,
  readBytesRpc,
  readDocxRpc,
  readTextRpc,
  searchFilesRpc,
  type FileEntry,
} from "../shared/docs";
import { convertDocx } from "./docx";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 30 * 1024 * 1024;
const MAX_SEARCH_ENTRIES = 20_000;
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".expo", ".venv", "__pycache__"]);
const SEARCH_SKIP_DIRECTORIES = new Set([...SKIP_DIRECTORIES, "dist", "build", ".next", "coverage"]);

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
  const file = await resolveRealInside(workspaceRoot, relative);
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
  const file = await resolveRealInside(workspaceRoot, relative);
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
  const file = await resolveRealInside(workspaceRoot, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("不是文件");
  if (stat.size > MAX_BINARY_BYTES) throw new Error("文件过大，无法预览");
  const data = await fs.readFile(file);
  return convertDocx(data);
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
