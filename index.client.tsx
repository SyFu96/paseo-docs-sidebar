import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DocsPanel } from "./client/docs-panel";
import { requestDocReveal, resolveDocReveal } from "./client/doc-reveal";
import { currentWorkspaceIdFromLocation, interceptAgentDocLinks } from "./client/web";

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

  const stopDocLinks = interceptAgentDocLinks((href) => {
    const target = resolveDocReveal(
      href,
      currentWorkspaceIdFromLocation(),
      (workspaceId) => {
        try {
          return client.paseo.workspaces.ref(workspaceId).current()?.workspaceDirectory ?? null;
        } catch {
          return null;
        }
      },
    );
    if (!target) return false;

    try {
      client.openPanel("docs", { workspaceId: target.workspaceId, location: "explorer" });
    } catch {
      return false;
    }
    requestDocReveal(target.workspaceId, target.path);
    return true;
  });

  return () => {
    stopDocLinks?.();
  };
}
