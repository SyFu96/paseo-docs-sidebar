import { useRpc } from "@getpaseo/plugin/client";
import { DocumentFrame, Loading, Markdown } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { docKind, mimeType, readBytesRpc, readTextRpc } from "../shared/docs";
import { useDocumentUrl } from "./hooks";

interface DocPreviewProps {
  root: string;
  hostId: string;
  path: string;
  sourceMode: boolean;
  theme: PluginTheme;
  compact: boolean;
}

export function DocPreview({ root, hostId, path, sourceMode, theme, compact }: DocPreviewProps) {
  const kind = docKind(path);
  const readText = useRpc(readTextRpc);
  const readBytes = useRpc(readBytesRpc);
  const wantsText = kind === "markdown" || kind === "text" || (kind === "html" && sourceMode);
  const wantsBytes = kind === "pdf" || kind === "image" || (kind === "html" && !sourceMode);

  const textQuery = useQuery({
    queryKey: ["docs", "text", hostId, root, path],
    queryFn: () => readText({ root, path }),
    enabled: wantsText,
    staleTime: 2_000,
  });
  const bytesQuery = useQuery({
    queryKey: ["docs", "bytes", hostId, root, path],
    queryFn: () => readBytes({ root, path }),
    enabled: wantsBytes,
    staleTime: 2_000,
  });
  const documentUrl = useDocumentUrl(bytesQuery.data, mimeType(path));

  if (kind === "binary") {
    return <Notice theme={theme} text="该文件类型不支持预览" />;
  }

  if (wantsText) {
    if (textQuery.isPending) return <Centered><Loading /></Centered>;
    if (textQuery.isError) return <Notice theme={theme} text="读取文件失败" />;
    const { text, truncated } = textQuery.data;
    if (kind === "markdown" && !sourceMode) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.colors.surface2 }}
          contentContainerStyle={{ padding: compact ? 10 : 24 }}
        >
          {truncated ? <Notice theme={theme} text="文件过大，仅显示前 2 MB" /> : null}
          <View
            style={{
              width: "100%",
              maxWidth: 860,
              alignSelf: "center",
              backgroundColor: theme.colors.surface0,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: compact ? 18 : 44,
              paddingVertical: compact ? 18 : 40,
            }}
          >
            <Markdown>{text}</Markdown>
          </View>
        </ScrollView>
      );
    }
    return <SourceView text={text} theme={theme} compact={compact} truncated={truncated} />;
  }

  if (bytesQuery.isPending) return <Centered><Loading /></Centered>;
  if (bytesQuery.isError) return <Notice theme={theme} text="读取文件失败" />;

  if (kind === "html" || kind === "pdf") {
    if (!documentUrl) {
      return <Notice theme={theme} text="当前客户端不支持该预览，请在桌面端打开" />;
    }
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <DocumentFrame url={documentUrl} />
      </View>
    );
  }

  if (!documentUrl) {
    return <Notice theme={theme} text="当前客户端不支持图片预览" />;
  }
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: theme.colors.surface2 }}>
      <Image
        source={{ uri: documentUrl }}
        resizeMode="contain"
        style={{ flex: 1, width: "100%" }}
      />
    </View>
  );
}

function SourceView({
  text,
  theme,
  compact,
  truncated,
}: {
  text: string;
  theme: PluginTheme;
  compact: boolean;
  truncated: boolean;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: compact ? 12 : 20 }}
    >
      {truncated ? <Notice theme={theme} text="文件过大，仅显示前 2 MB" /> : null}
      <Text
        selectable
        style={{
          color: theme.colors.foreground,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {text}
      </Text>
    </ScrollView>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}

function Notice({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>{text}</Text>
    </View>
  );
}
