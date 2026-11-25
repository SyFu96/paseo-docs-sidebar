import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DocsPanel } from "./client/docs-panel";

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

  return () => {};
}
