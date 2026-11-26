import { DomUtils, parseDocument } from "htmlparser2";
import { Element, Text, type AnyNode } from "domhandler";

const MAX_MATCHES = 2000;

const FIND_STYLE = `
mark.docs-find { background: #fff3a3; color: #1f2328; padding: 0; scroll-margin-top: 16px; }
mark.docs-find:target { background: #ffb347; color: #1f2328; }
`;

export interface DocxFindResult {
  html: string;
  count: number;
  limited: boolean;
}

/** Wraps text matches in the converted DOCX HTML so the frame can highlight and scroll to them. */
export function findDocxText(html: string, query: string): DocxFindResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return { html, count: 0, limited: false };

  const document = parseDocument(html, { decodeEntities: true });
  const textNodes: Text[] = [];
  let limited = false;

  const visit = (node: AnyNode, skip: boolean) => {
    if (node.type === "text") {
      if (!skip) textNodes.push(node);
      return;
    }
    const tag = node.type === "tag" ? node.name.toLowerCase() : "";
    const nextSkip = skip || tag === "style" || tag === "script" || tag === "noscript";
    if ("children" in node) {
      for (const child of node.children) visit(child, nextSkip);
    }
  };
  document.children.forEach((child) => visit(child, false));

  let count = 0;
  for (const textNode of textNodes) {
    const value = textNode.data;
    const lower = value.toLowerCase();
    let from = 0;
    let index = lower.indexOf(needle, from);
    if (index < 0) continue;
    if (count >= MAX_MATCHES) {
      limited = true;
      break;
    }

    const replacement: AnyNode[] = [];
    let last = 0;
    while (index >= 0) {
      if (count >= MAX_MATCHES) {
        limited = true;
        break;
      }
      if (index > last) replacement.push(new Text(value.slice(last, index)));
      replacement.push(
        new Element(
          "mark",
          { class: "docs-find", id: `match-${count}` },
          [new Text(value.slice(index, index + needle.length))],
        ),
      );
      count += 1;
      last = index + needle.length;
      from = last;
      index = lower.indexOf(needle, from);
    }
    if (last < value.length) replacement.push(new Text(value.slice(last)));

    const parent = textNode.parent;
    if (!parent) continue;
    const position = parent.children.indexOf(textNode);
    if (position >= 0) parent.children.splice(position, 1, ...replacement);
  }

  if (count > 0) {
    const style = new Element("style", {}, [new Text(FIND_STYLE)]);
    const head = DomUtils.getElementsByTagName("head", document.children, true)[0];
    if (head) head.children.push(style);
    else document.children.unshift(new Element("head", {}, [style]));
  }

  return { html: DomUtils.getOuterHTML(document), count, limited };
}
