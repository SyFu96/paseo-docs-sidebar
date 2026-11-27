import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DocsPanel } from "./client/docs-panel";
import { requestDocReveal, resolveDocReveal } from "./client/doc-reveal";
import { currentWorkspaceIdFromLocation, interceptAgentDocLinks } from "./client/web";
import { resolveDocPathRpc } from "./shared/docs";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "docs",
    title: "文档",
    icon: "BookOpen",
    locations: ["explorer"],
    Component: DocsPanel,
  });

  client.addCommandCenterItem({
    id: "open-docs",
    title: "文档：在右侧打开",
    icon: "BookOpen",
    keywords: ["docs", "markdown", "document", "preview", "文件", "文档", "预览"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("docs", { location: "explorer" });
    },
  });

  client.addCommandCenterItem({
    id: "open-docs-from-agent",
    title: "文档：在右侧打开",
    icon: "BookOpen",
    keywords: ["docs", "markdown", "document", "preview", "文件", "文档", "预览"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("docs", { location: "explorer" });
    },
  });

  const workspaceRoot = (workspaceId: string): string | null => {
    try {
      return client.paseo.workspaces.ref(workspaceId).current()?.workspaceDirectory ?? null;
    } catch {
      return null;
    }
  };

  const openDocs = (workspaceId: string, path: string): boolean => {
    try {
      client.openPanel("docs", { workspaceId, location: "explorer" });
    } catch {
      return false;
    }
    requestDocReveal(workspaceId, path);
    return true;
  };

  // Agent links are often written relative to a subdirectory (for example a bare file name or a
  // path under `outputs/`). Resolve the exact path first, then a unique path-tail match, before
  // opening the document. Missing or ambiguous paths keep the strict error.
  let revealRequest = 0;
  const stopDocLinks = interceptAgentDocLinks((href) => {
    const target = resolveDocReveal(href, currentWorkspaceIdFromLocation(), workspaceRoot);
    if (!target) return false;

    const root = workspaceRoot(target.workspaceId);
    if (!root) return openDocs(target.workspaceId, target.path);

    const request = (revealRequest += 1);
    void client
      .rpc(resolveDocPathRpc, { root, path: target.path, suffix: true })
      .then((resolved) => {
        if (request !== revealRequest) return;
        openDocs(target.workspaceId, resolved.path ?? target.path);
      })
      .catch(() => {
        if (request !== revealRequest) return;
        openDocs(target.workspaceId, target.path);
      });
    return true;
  });

  return () => {
    stopDocLinks?.();
  };
}
