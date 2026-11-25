import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { docKind, fileName } from "../shared/docs";
import { FileTree } from "./file-tree";
import { DocPreview } from "./preview";
import { DEFAULT_DOCS_PANEL_STATE, docsPanelStateSchema, type DocsPanelState } from "./state";

const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 560;
const MIN_PREVIEW_WIDTH = 180;

export function DocsPanel({ theme, layout, workspaceId, host, tab }: PluginWorkspacePanelProps) {
  const [state, setState] = useTabState(tab, docsPanelStateSchema, DEFAULT_DOCS_PANEL_STATE);
  const workspace = useWorkspace(workspaceId, (item) => ({
    directory: item.directory,
    name: item.name,
  }));
  const queryClient = useQueryClient();
  const root = workspace?.directory ?? null;
  const active = state.active;
  const sourceAvailable = active
    ? docKind(active) === "markdown" || docKind(active) === "html"
    : false;

  const update = (patch: Partial<DocsPanelState>) => setState({ ...state, ...patch });

  const [contentWidth, setContentWidth] = useState(0);
  const contentWidthRef = useRef(0);
  const updateRef = useRef(update);
  const compactRef = useRef(layout.compact);
  const treeWidthRef = useRef(state.treeWidth);
  const dragStartRef = useRef(state.treeWidth);
  const dragWidthRef = useRef<number | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  updateRef.current = update;
  compactRef.current = layout.compact;

  const maxTreeWidth =
    contentWidth > 0
      ? Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, contentWidth - MIN_PREVIEW_WIDTH))
      : MAX_TREE_WIDTH;
  const treeWidth = Math.min(dragWidth ?? state.treeWidth, maxTreeWidth);
  treeWidthRef.current = treeWidth;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !compactRef.current,
        onMoveShouldSetPanResponder: () => !compactRef.current,
        onPanResponderGrant: () => {
          dragStartRef.current = treeWidthRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const max =
            contentWidthRef.current > 0
              ? Math.max(
                  MIN_TREE_WIDTH,
                  Math.min(MAX_TREE_WIDTH, contentWidthRef.current - MIN_PREVIEW_WIDTH),
                )
              : MAX_TREE_WIDTH;
          const next = Math.max(
            MIN_TREE_WIDTH,
            Math.min(max, dragStartRef.current + gesture.dx),
          );
          dragWidthRef.current = next;
          setDragWidth(next);
        },
        onPanResponderRelease: () => {
          const width = dragWidthRef.current;
          dragWidthRef.current = null;
          setDragWidth(null);
          if (width !== null) updateRef.current({ treeWidth: width });
        },
        onPanResponderTerminate: () => {
          dragWidthRef.current = null;
          setDragWidth(null);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  const openDoc = (path: string) => {
    const tabs = state.tabs.includes(path)
      ? state.tabs
      : [...state.tabs, path].slice(-24);
    update({ tabs, active: path, source: false });
  };

  const closeDoc = (path: string) => {
    const index = state.tabs.indexOf(path);
    const tabs = state.tabs.filter((item) => item !== path);
    const nextActive =
      state.active === path ? (tabs[index] ?? tabs[index - 1] ?? null) : state.active;
    update({ tabs, active: nextActive });
  };

  const toggleFolder = (path: string) => {
    update({
      expanded: state.expanded.includes(path)
        ? state.expanded.filter((item) => item !== path)
        : [...state.expanded, path],
    });
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["docs"] });
  };

  if (!workspace || !root) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>工作区不可用</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: theme.colors.surface0 }}>
      <DocTabs
        tabs={state.tabs}
        active={active}
        theme={theme}
        onSelect={(path) => update({ active: path })}
        onClose={closeDoc}
      />
      <View
        style={{
          height: 34,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        {state.showTree ? null : (
          <IconButton
            theme={theme}
            icon="PanelLeftOpen"
            label="显示文件树"
            onPress={() => update({ showTree: true })}
          />
        )}
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={{ flex: 1, minWidth: 0, color: theme.colors.foregroundMuted, fontSize: 12 }}
        >
          {workspace.name}
        </Text>
        {sourceAvailable ? (
          <IconButton
            theme={theme}
            icon={state.source ? "Eye" : "Code2"}
            label={state.source ? "显示渲染预览" : "显示源码"}
            onPress={() => update({ source: !state.source })}
          />
        ) : null}
        <IconButton theme={theme} icon="RefreshCw" label="刷新" onPress={refresh} />
      </View>
      <View
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          contentWidthRef.current = width;
          setContentWidth(width);
        }}
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: layout.compact ? "column" : "row",
        }}
      >
        {state.showTree ? (
          <View
            style={{
              width: layout.compact ? "100%" : treeWidth,
              flex: layout.compact ? 1 : undefined,
              minHeight: 0,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <View
              style={{
                height: 30,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                borderBottomWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Icon name="FolderOpen" size={13} color={theme.colors.foregroundMuted} />
              <View style={{ flex: 1 }} />
              <IconButton
                theme={theme}
                icon="PanelLeftClose"
                label="收起文件树"
                onPress={() => update({ showTree: false })}
              />
            </View>
            <FileTree
              root={root}
              hostId={host.id}
              active={active}
              expanded={state.expanded}
              theme={theme}
              onToggle={toggleFolder}
              onOpen={openDoc}
            />
          </View>
        ) : null}
        {state.showTree && !layout.compact ? (
          <View
            {...panResponder.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="调整文件树宽度"
            style={{
              width: 8,
              marginHorizontal: -4,
              alignSelf: "stretch",
              alignItems: "center",
              justifyContent: "center",
              // react-native-web supports the CSS resize cursor; RN's type only lists auto/pointer.
              cursor: "col-resize" as "pointer",
              zIndex: 1,
            }}
          >
            <View
              style={{
                width: 1,
                alignSelf: "stretch",
                backgroundColor:
                  dragWidth !== null ? theme.colors.foregroundMuted : theme.colors.border,
              }}
            />
          </View>
        ) : null}
        {layout.compact && state.showTree ? null : active ? (
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <DocPreview
              root={root}
              hostId={host.id}
              path={active}
              sourceMode={state.source}
              theme={theme}
              compact={layout.compact}
              onOpenDoc={openDoc}
            />
          </View>
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Icon name="BookOpen" size={28} color={theme.colors.foregroundMuted} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              从左侧选择文件
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function DocTabs({
  tabs,
  active,
  theme,
  onSelect,
  onClose,
}: {
  tabs: readonly string[];
  active: string | null;
  theme: PluginTheme;
  onSelect(path: string): void;
  onClose(path: string): void;
}) {
  return (
    <View
      style={{
        height: 36,
        flexDirection: "row",
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {tabs.map((path) => {
          const selected = active === path;
          return (
            <View
              key={path}
              style={{
                height: 36,
                flexDirection: "row",
                alignItems: "center",
                borderRightWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: selected ? theme.colors.surface0 : "transparent",
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={path}
                onPress={() => onSelect(path)}
                style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 10 }}
              >
                <Icon
                  name={iconFor(path)}
                  size={12}
                  color={selected ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    maxWidth: 170,
                    color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  {fileName(path)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`关闭 ${fileName(path)}`}
                onPress={() => onClose(path)}
                style={{ width: 24, height: 28, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function IconButton({
  theme,
  icon,
  label,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 26,
        height: 26,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function iconFor(path: string): string {
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
