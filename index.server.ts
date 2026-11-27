import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  findDocxFile,
  listDirectory,
  readBinaryFile,
  readDocxFile,
  readTextFile,
  resolveDocPath,
  searchFiles,
} from "./server/docs";
import { renderMathInMarkdown } from "./server/math";
import { sanitizeMarkdownImages } from "./server/markdown-sanitize";
import {
  findDocxRpc,
  listDirectoryRpc,
  readBytesRpc,
  readDocxRpc,
  readTextRpc,
  renderMathRpc,
  resolveDocPathRpc,
  sanitizeMarkdownRpc,
  searchFilesRpc,
} from "./shared/docs";

export default function contribute(server: PluginServerContext) {
  server.handle(listDirectoryRpc, listDirectory);
  server.handle(searchFilesRpc, searchFiles);
  server.handle(readTextRpc, readTextFile);
  server.handle(readBytesRpc, readBinaryFile);
  server.handle(readDocxRpc, readDocxFile);
  server.handle(findDocxRpc, findDocxFile);
  server.handle(resolveDocPathRpc, resolveDocPath);
  server.handle(renderMathRpc, ({ text }) => renderMathInMarkdown(text));
  server.handle(sanitizeMarkdownRpc, ({ text }) => sanitizeMarkdownImages(text));
  return () => {};
}
