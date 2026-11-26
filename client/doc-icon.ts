import { docKind } from "../shared/docs";

/** Lucide icon name for a workspace document. Shared by tabs and the document drawer. */
export function docIcon(path: string): string {
  switch (docKind(path)) {
    case "markdown":
      return "FileText";
    case "html":
      return "FileCode";
    case "pdf":
      return "FileType";
    case "docx":
      return "FileText";
    case "image":
      return "Image";
    default:
      return "FileCode";
  }
}
