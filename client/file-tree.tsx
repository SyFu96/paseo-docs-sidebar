import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  docKind,
  listDirectoryRpc,
  searchFilesRpc,
  type FileEntry,
} from "../shared/docs";
import { useDebouncedValue } from "./hooks";

const ROW_HEIGHT = 28;
const INDENT = 14;

interface FileTreeProps {
  root: string;
  hostId: string;
  active: string | null;
  expanded: readonly string[];
  theme: PluginTheme;
  onToggle(path: string): void;
  onOpen(path: string): void;
}

export function FileTree({ root, hostId, active, expanded, theme, onToggle, onOpen }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const query = useDebouncedValue(filter.trim(), 200);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="筛选文件"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={{
            height: 28,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            color: theme.colors.foreground,
            fontSize: 12,
          }}
        />
      </View>
      {query.length > 0 ? (
        <SearchResults
          root={root}
          hostId={hostId}
          query={query}
          active={active}
          theme={theme}
          onOpen={onOpen}
        />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
          <DirectoryChildren
            root={root}
            hostId={hostId}
            dirPath=""
            depth={0}
            active={active}
            expanded={expanded}
            theme={theme}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        </ScrollView>
      )}
    </View>
  );
}

interface DirectoryChildrenProps {
  root: string;
  hostId: string;
  dirPath: string;
  depth: number;
  active: string | null;
  expanded: readonly string[];
  theme: PluginTheme;
  onToggle(path: string): void;
  onOpen(path: string): void;
}

function DirectoryChildren({
  root,
  hostId,
  dirPath,
  depth,
  active,
  expanded,
  theme,
  onToggle,
  onOpen,
}: DirectoryChildrenProps) {
  const listDirectory = useRpc(listDirectoryRpc);
  const listing = useQuery({
    queryKey: ["docs", "list", hostId, root, dirPath],
    queryFn: () => listDirectory({ root, path: dirPath }),
    staleTime: 10_000,
  });
  if (listing.isPending) {
    return <MutedRow depth={depth} theme={theme} label="加载中…" />;
  }
  if (listing.isError) {
    return <MutedRow depth={depth} theme={theme} label="读取失败" />;
  }
  return (
    <>
      {listing.data.entries.map((entry) =>
        entry.kind === "directory" ? (
          <View key={entry.path}>
            <TreeRow
              depth={depth}
              theme={theme}
              icon={expanded.includes(entry.path) ? "ChevronDown" : "ChevronRight"}
              folder
              label={entry.name}
              active={false}
              onPress={() => onToggle(entry.path)}
            />
            {expanded.includes(entry.path) ? (
              <DirectoryChildren
                root={root}
                hostId={hostId}
                dirPath={entry.path}
                depth={depth + 1}
                active={active}
                expanded={expanded}
                theme={theme}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </View>
        ) : (
          <FileRow
            key={entry.path}
            depth={depth}
            theme={theme}
            entry={entry}
            active={active === entry.path}
            onPress={() => onOpen(entry.path)}
          />
        ),
      )}
    </>
  );
}

function SearchResults({
  root,
  hostId,
  query,
  active,
  theme,
  onOpen,
}: {
  root: string;
  hostId: string;
  query: string;
  active: string | null;
  theme: PluginTheme;
  onOpen(path: string): void;
}) {
  const searchFiles = useRpc(searchFilesRpc);
  const results = useQuery({
    queryKey: ["docs", "search", hostId, root, query],
    queryFn: () => searchFiles({ root, query, limit: 200 }),
    staleTime: 5_000,
  });
  if (results.isPending) return <MutedRow depth={0} theme={theme} label="搜索中…" />;
  if (results.isError) return <MutedRow depth={0} theme={theme} label="搜索失败" />;
  if (results.data.entries.length === 0) {
    return <MutedRow depth={0} theme={theme} label="没有匹配的文件" />;
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
      {results.data.entries.map((entry) => (
        <FileRow
          key={entry.path}
          depth={0}
          theme={theme}
          entry={{ ...entry, name: entry.path }}
          active={active === entry.path}
          onPress={() => onOpen(entry.path)}
        />
      ))}
    </ScrollView>
  );
}

function FileRow({
  depth,
  theme,
  entry,
  active,
  onPress,
}: {
  depth: number;
  theme: PluginTheme;
  entry: FileEntry;
  active: boolean;
  onPress(): void;
}) {
  return (
    <TreeRow
      depth={depth}
      theme={theme}
      icon={iconForPath(entry.path)}
      label={entry.name}
      active={active}
      onPress={onPress}
    />
  );
}

function TreeRow({
  depth,
  theme,
  icon,
  label,
  active,
  folder,
  onPress,
}: {
  depth: number;
  theme: PluginTheme;
  icon: string;
  label: string;
  active: boolean;
  folder?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingLeft: 10 + depth * INDENT,
        paddingRight: 8,
        backgroundColor: active
          ? theme.colors.surface2
          : pressed
            ? theme.colors.surface1
            : "transparent",
      })}
    >
      <Icon name={icon} size={13} color={theme.colors.foregroundMuted} />
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          lineHeight: 16,
          color: active ? theme.colors.foreground : folder ? theme.colors.foreground : theme.colors.foregroundMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MutedRow({ depth, theme, label }: { depth: number; theme: PluginTheme; label: string }) {
  return (
    <View style={{ height: ROW_HEIGHT, justifyContent: "center", paddingLeft: 10 + depth * INDENT }}>
      <Text style={{ fontSize: 12, lineHeight: 16, color: theme.colors.foregroundMuted }}>{label}</Text>
    </View>
  );
}

function iconForPath(path: string): string {
  switch (docKind(path)) {
    case "markdown":
      return "FileText";
    case "html":
      return "FileCode";
    case "pdf":
      return "FileType";
    case "image":
      return "Image";
    case "binary":
      return "File";
    default:
      return "FileCode";
  }
}
