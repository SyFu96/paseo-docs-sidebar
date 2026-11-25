import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  listDirectory,
  readBinaryFile,
  readDocxFile,
  readTextFile,
  searchFiles,
} from "./server/docs";
import { renderMathInMarkdown } from "./server/math";
import {
  listDirectoryRpc,
  readBytesRpc,
  readDocxRpc,
  readTextRpc,
  renderMathRpc,
  searchFilesRpc,
} from "./shared/docs";

export default function contribute(server: PluginServerContext) {
  server.handle(listDirectoryRpc, listDirectory);
  server.handle(searchFilesRpc, searchFiles);
  server.handle(readTextRpc, readTextFile);
  server.handle(readBytesRpc, readBinaryFile);
  server.handle(readDocxRpc, readDocxFile);
  server.handle(renderMathRpc, ({ text }) => renderMathInMarkdown(text));
  return () => {};
}
