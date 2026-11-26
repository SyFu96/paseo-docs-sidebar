import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { fileName } from "../shared/docs";
import { docIcon } from "./doc-icon";
import { interceptEscapeKey } from "./web";

interface DocDrawerProps {
  tabs: readonly string[];
  active: string | null;
  theme: PluginTheme;
  compact: boolean;
  onClose(): void;
  onSelect(path: string): void;
  onCloseDoc(path: string): void;
  onCloseOthers(): void;
  onCloseAll(): void;
}

/** A searchable list of every open document, drawn over the preview. */
export function DocDrawer({
  tabs,
  active,
  theme,
  compact,
  onClose,
  onSelect,
  onCloseDoc,
  onCloseOthers,
  onCloseAll,
}: DocDrawerProps) {
  const [query, setQuery] = useState("");
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (Platform.OS === "web") search.current?.focus();
    return interceptEscapeKey(() => closeRef.current());
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? tabs.filter((path) => path.toLowerCase().includes(needle))
    : tabs;

  return (
    <View
      style={{
        position: "absolute",
        top: 36,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭文档列表"
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.22)",
        }}
      />
      <View
        accessibilityViewIsModal
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: compact ? "100%" : 360,
          maxWidth: "100%",
          backgroundColor: theme.colors.surface0,
          borderLeftWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View
          style={{
            height: 40,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Icon name="List" size={14} color={theme.colors.foregroundMuted} />
          <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
            打开的文档
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {tabs.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭文档列表"
            onPress={onClose}
            style={({ pressed }) => ({
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 5,
              backgroundColor: pressed ? theme.colors.surface2 : "transparent",
            })}
          >
            <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>

        <View style={{ padding: 10 }}>
          <TextInput
            ref={search}
            value={query}
            onChangeText={setQuery}
            placeholder="筛选文档"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="筛选文档"
            autoCapitalize="none"
            autoCorrect={false}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === "Escape") onClose();
            }}
            style={{
              height: 30,
              paddingHorizontal: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              color: theme.colors.foreground,
              fontSize: 12,
            }}
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {visible.length === 0 ? (
            <View style={{ paddingHorizontal: 14, paddingVertical: 18, gap: 4 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {tabs.length === 0 ? "没有打开的文档" : "没有匹配的文档"}
              </Text>
              {tabs.length === 0 ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  从左侧文件树选择文件
                </Text>
              ) : null}
            </View>
          ) : (
            visible.map((path) => {
              const selected = path === active;
              const slash = path.lastIndexOf("/");
              const directory = slash > 0 ? path.slice(0, slash) : "";
              return (
                <Pressable
                  key={path}
                  accessibilityRole="button"
                  accessibilityLabel={`打开 ${fileName(path)}`}
                  onPress={() => onSelect(path)}
                  style={({ pressed }) => ({
                    minHeight: 42,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingLeft: 12,
                    paddingRight: 6,
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: selected
                      ? theme.colors.surface2
                      : pressed
                        ? theme.colors.surface1
                        : "transparent",
                    borderLeftWidth: 2,
                    borderLeftColor: selected
                      ? (theme.colors.accent ?? theme.colors.foreground)
                      : "transparent",
                  })}
                >
                  <Icon
                    name={docIcon(path)}
                    size={13}
                    color={
                      selected ? theme.colors.foreground : theme.colors.foregroundMuted
                    }
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={2}
                      ellipsizeMode="middle"
                      style={{
                        color: selected
                          ? theme.colors.foreground
                          : theme.colors.foregroundMuted,
                        fontSize: 12,
                        lineHeight: 16,
                      }}
                    >
                      {fileName(path)}
                    </Text>
                    {directory ? (
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={{
                          color: theme.colors.foregroundMuted,
                          fontSize: 10,
                          lineHeight: 14,
                        }}
                      >
                        {directory}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`关闭 ${fileName(path)}`}
                    onPress={(event) => {
                      event.stopPropagation();
                      onCloseDoc(path);
                    }}
                    style={({ pressed }) => ({
                      width: 22,
                      height: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 5,
                      backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                    })}
                  >
                    <Icon name="X" size={11} color={theme.colors.foregroundMuted} />
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 10,
            borderTopWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <DrawerAction
            theme={theme}
            label="关闭其他"
            disabled={tabs.length <= 1}
            onPress={onCloseOthers}
          />
          <DrawerAction
            theme={theme}
            label="关闭全部"
            disabled={tabs.length === 0}
            onPress={onCloseAll}
          />
        </View>
      </View>
    </View>
  );
}

function DrawerAction({
  theme,
  label,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1,
      })}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
