import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, memo, type ComponentRef } from "react";
import { PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { docKind, fileName } from "../shared/docs";
import { DocDrawer } from "./doc-drawer";
import { docIcon } from "./doc-icon";
import type { DocFindResult } from "./docx-find";
import {
  forgetDocsWorkspace,
  rememberDocsWorkspace,
  subscribeDocReveal,
  takeDocReveal,
} from "./doc-reveal";
import { FileTree } from "./file-tree";
import { DocPreview } from "./preview";
import { DEFAULT_DOCS_PANEL_STATE, docsPanelStateSchema, type DocsPanelState } from "./state";

const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 560;
const MIN_PREVIEW_WIDTH = 180;

const MemoFileTree = memo(FileTree);

interface DocFindState {
  path: string | null;
  query: string;
  active: number;
  count: number;
  limited: boolean;
  pending: boolean;
  error: boolean;
}

const EMPTY_DOC_FIND: DocFindState = {
  path: null,
  query: "",
  active: 0,
  count: 0,
  limited: false,
  pending: false,
  error: false,
};

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
  const findAvailable =
    Platform.OS === "web" && active
      ? docKind(active) === "markdown" || docKind(active) === "docx"
      : false;
  const [find, setFind] = useState<DocFindState>(EMPTY_DOC_FIND);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [treeMounted, setTreeMounted] = useState(state.showTree);

  const update = (patch: Partial<DocsPanelState>) => setState({ ...state, ...patch });

  const resetFind = () => setFind(EMPTY_DOC_FIND);
  const findQuery = useDebouncedFindQuery(active, find.query);
  const findActive = find.count > 0 ? find.active % find.count : 0;

  const changeFindQuery = (value: string) => {
    setFind({ ...EMPTY_DOC_FIND, path: active, query: value });
  };

  const reportFind = useCallback(
    (result: DocFindResult) => {
      setFind((previous) => {
        // A late result from the document that was open before this one must not replace the
        // current document's search state.
        if (previous.path !== active || previous.query !== result.query) return previous;
        if (
          previous.count === result.count &&
          previous.limited === result.limited &&
          previous.pending === result.pending &&
          previous.error === result.error
        ) {
          return previous;
        }
        const nextActive =
          result.count > 0 && previous.active < result.count ? previous.active : 0;
        return { ...previous, ...result, active: nextActive };
      });
    },
    [active],
  );

  const stepFind = (delta: number) => {
    setFind((previous) => {
      if (previous.path !== active || previous.count === 0) return previous;
      return {
        ...previous,
        active: (previous.active + delta + previous.count) % previous.count,
      };
    });
  };

  const [contentWidth, setContentWidth] = useState(0);
  const contentWidthRef = useRef(0);
  const updateRef = useRef(update);
  const compactRef = useRef(layout.compact);
  const treeWidthRef = useRef(state.treeWidth);
  const dragStartRef = useRef(state.treeWidth);
  const dragWidthRef = useRef<number | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const openDocRef = useRef<(path: string) => void>(() => {});
  const stateRef = useRef(state);
  updateRef.current = update;
  compactRef.current = layout.compact;
  stateRef.current = state;

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
    if (path !== active) resetFind();
    setDrawerOpen(false);
    const tabs = state.tabs.includes(path)
      ? state.tabs
      : [...state.tabs, path].slice(-24);
    update({ tabs, active: path, source: false });
  };

  const closeDoc = (path: string) => {
    if (state.active === path) resetFind();
    const index = state.tabs.indexOf(path);
    const tabs = state.tabs.filter((item) => item !== path);
    const nextActive =
      state.active === path ? (tabs[index] ?? tabs[index - 1] ?? null) : state.active;
    if (tabs.length === 0) setDrawerOpen(false);
    update({ tabs, active: nextActive });
  };

  const selectDoc = (path: string) => {
    if (path !== active) resetFind();
    update({ active: path });
    setDrawerOpen(false);
  };

  const closeOtherDocs = () => {
    update({ tabs: active ? [active] : [], active });
    setDrawerOpen(false);
  };

  const closeAllDocs = () => {
    resetFind();
    update({ tabs: [], active: null });
    setDrawerOpen(false);
  };

  openDocRef.current = openDoc;
  const openTreeDoc = useCallback((path: string) => {
    openDocRef.current(path);
  }, []);

  useEffect(() => {
    if (state.showTree) setTreeMounted(true);
  }, [state.showTree]);

  // The client-level link interceptor sends chat document links here. Keeping the queue in the
  // panel scopes a reveal to its workspace and lets the panel open the tab once it is mounted.
  useEffect(() => {
    if (!root) return;
    rememberDocsWorkspace(workspaceId, root);
    const pending = takeDocReveal(workspaceId);
    if (pending) openDocRef.current(pending.path);
    const unsubscribe = subscribeDocReveal((reveal) => {
      if (reveal.workspaceId !== workspaceId) return;
      const next = takeDocReveal(workspaceId);
      if (next) openDocRef.current(next.path);
    });
    return () => {
      unsubscribe();
      forgetDocsWorkspace(workspaceId);
    };
  }, [workspaceId, root]);

  const toggleFolder = useCallback((path: string) => {
    const expanded = stateRef.current.expanded;
    updateRef.current({
      expanded: expanded.includes(path)
        ? expanded.filter((item) => item !== path)
        : [...expanded, path],
    });
  }, []);

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
    <View
      nativeID="docs-sidebar-panel"
      style={{ flex: 1, minWidth: 0, backgroundColor: theme.colors.surface0 }}
    >
      <DocTabs
        tabs={state.tabs}
        active={active}
        theme={theme}
        onSelect={selectDoc}
        onClose={closeDoc}
        onOpenDrawer={() => setDrawerOpen((open) => !open)}
        drawerOpen={drawerOpen}
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
            onPress={() => {
              setTreeMounted(true);
              update({ showTree: true });
            }}
          />
        )}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ flex: 1, minWidth: 0, color: theme.colors.foregroundMuted, fontSize: 12 }}
          >
            {workspace.name}
          </Text>
          {findAvailable ? (
            <DocFindField
              theme={theme}
              compact={layout.compact}
              query={find.query}
              active={findActive}
              count={find.count}
              limited={find.limited}
              pending={find.pending}
              error={find.error}
              onChangeQuery={changeFindQuery}
              onPrevious={() => stepFind(-1)}
              onNext={() => stepFind(1)}
            />
          ) : null}
        </View>
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
        {treeMounted ? (
          <View
            style={{
              width: layout.compact ? "100%" : treeWidth,
              flex: layout.compact ? 1 : undefined,
              minHeight: 0,
              backgroundColor: theme.colors.surface1,
              display: state.showTree ? "flex" : "none",
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
            <MemoFileTree
              root={root}
              hostId={host.id}
              active={active}
              expanded={state.expanded}
              theme={theme}
              onToggle={toggleFolder}
              onOpen={openTreeDoc}
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
              findQuery={findQuery}
              findActive={findActive}
              onFindResult={reportFind}
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
      {drawerOpen ? (
        <DocDrawer
          tabs={state.tabs}
          active={active}
          theme={theme}
          compact={layout.compact}
          onClose={() => setDrawerOpen(false)}
          onSelect={selectDoc}
          onCloseDoc={closeDoc}
          onCloseOthers={closeOtherDocs}
          onCloseAll={closeAllDocs}
        />
      ) : null}
    </View>
  );
}

function DocTabs({
  tabs,
  active,
  theme,
  onSelect,
  onClose,
  onOpenDrawer,
  drawerOpen,
}: {
  tabs: readonly string[];
  active: string | null;
  theme: PluginTheme;
  onSelect(path: string): void;
  onClose(path: string): void;
  onOpenDrawer(): void;
  drawerOpen: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, { x: number; width: number }>());

  const revealActive = () => {
    if (!active) return;
    const position = positions.current.get(active);
    if (!position) return;
    scroll.current?.scrollTo({ x: Math.max(0, position.x - 12), animated: true });
  };

  useEffect(() => {
    revealActive();
  }, [active, tabs]);

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
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1, minWidth: 0 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {tabs.map((path) => {
          const selected = active === path;
          return (
            <View
              key={path}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                positions.current.set(path, { x, width });
                if (path === active) revealActive();
              }}
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
                  name={docIcon(path)}
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
      {tabs.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`全部打开的文档，${tabs.length} 个`}
          onPress={onOpenDrawer}
          style={({ pressed }) => ({
            height: 36,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            borderLeftWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: drawerOpen
              ? theme.colors.surface2
              : pressed
                ? theme.colors.surface1
                : "transparent",
          })}
        >
          <Icon name="List" size={13} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {`全部 ${tabs.length}`}
          </Text>
        </Pressable>
      ) : null}
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

/**
 * The search field is kept in the document toolbar instead of relying on Ctrl/Cmd+F, because
 * Paseo handles that shortcut before panel content sees it. Debouncing is keyed by document so a
 * new tab never receives the previous document's query.
 */
function useDebouncedFindQuery(path: string | null, query: string): string {
  const [debounced, setDebounced] = useState({ path, query });
  useEffect(() => {
    if (query.length === 0) {
      setDebounced({ path, query });
      return;
    }
    const timer = setTimeout(() => setDebounced({ path, query }), 150);
    return () => clearTimeout(timer);
  }, [path, query]);
  return debounced.path === path ? debounced.query : "";
}

function DocFindField({
  theme,
  compact,
  query,
  active,
  count,
  limited,
  pending,
  error,
  onChangeQuery,
  onPrevious,
  onNext,
}: {
  theme: PluginTheme;
  compact: boolean;
  query: string;
  active: number;
  count: number;
  limited: boolean;
  pending: boolean;
  error: boolean;
  onChangeQuery(value: string): void;
  onPrevious(): void;
  onNext(): void;
}) {
  const status = pending
    ? "…"
    : error
      ? "查找失败"
      : query.trim()
        ? `${count > 0 ? active + 1 : 0} / ${count}${limited ? "+" : ""}`
        : "";
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const focusInput = () => {
    // Keep typing and Enter-to-next available after clicking one of the field buttons.
    input.current?.focus();
  };
  return (
    <View
      style={{
        height: 26,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        flexGrow: 0,
        flexShrink: 1,
        flexBasis: compact ? 160 : 300,
        maxWidth: 420,
        minWidth: 120,
        paddingLeft: 6,
        paddingRight: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <Icon name="Search" size={12} color={theme.colors.foregroundMuted} />
      <TextInput
        ref={input}
        value={query}
        onChangeText={onChangeQuery}
        placeholder="在文档中查找"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="在文档中查找"
        maxLength={200}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        returnKeyType="search"
        onSubmitEditing={onNext}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Escape") onChangeQuery("");
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: 24,
          paddingHorizontal: 4,
          paddingVertical: 0,
          color: theme.colors.foreground,
          fontSize: 12,
          backgroundColor: "transparent",
        }}
      />
      {status ? (
        <Text
          numberOfLines={1}
          style={{
            minWidth: 34,
            color: theme.colors.foregroundMuted,
            fontSize: 10,
            textAlign: "right",
          }}
        >
          {status}
        </Text>
      ) : null}
      <FindStepButton
        theme={theme}
        icon="ChevronUp"
        label="上一个匹配"
        disabled={count === 0}
        onPress={() => {
          onPrevious();
          focusInput();
        }}
      />
      <FindStepButton
        theme={theme}
        icon="ChevronDown"
        label="下一个匹配"
        disabled={count === 0}
        onPress={() => {
          onNext();
          focusInput();
        }}
      />
      {query.length > 0 ? (
        <FindStepButton
          theme={theme}
          icon="X"
          label="清除查找"
          onPress={() => {
            onChangeQuery("");
            focusInput();
          }}
        />
      ) : null}
    </View>
  );
}

function FindStepButton({
  theme,
  icon,
  label,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 18,
        height: 22,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        opacity: disabled ? 0.35 : 1,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={11} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}
