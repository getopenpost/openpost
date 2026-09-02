import { Redirect, router, Stack } from "expo-router";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BodyText, Card, IconButton, Screen, SectionHeader } from "@/components/ui";
import { ThemeIcon } from "@/components/theme-icon";
import {
  getToken,
  getWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} from "@/lib/api/token-store";
import { errorHaptic, selectionHaptic } from "@/lib/haptics";
import { getServer, subscribeServer } from "@/lib/server";
import {
  getThemePreference,
  saveThemePreference,
  subscribeThemePreference,
  type NativeThemeChoice,
  type NativeThemePreference,
  useNativeTheme,
  useNativeThemeSettings,
} from "@/theme";

const APPEARANCE_OPTIONS: readonly {
  value: NativeThemePreference;
  label: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "Use device setting",
    description: "Matches your phone.",
  },
  { value: "light", label: "Light", description: "Always use light mode." },
  { value: "dark", label: "Dark", description: "Always use dark mode." },
];

export default function AppearanceScreen() {
  const theme = useNativeTheme();
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference);
  const settings = useNativeThemeSettings();
  const insets = useSafeAreaInsets();
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const workspaceId = useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);
  const [preferencePending, setPreferencePending] = useState<NativeThemePreference | null>(null);
  const [assignmentPending, setAssignmentPending] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const { colors, shape, spacing, typography } = theme.manifest;

  async function chooseAppearance(value: NativeThemePreference) {
    if (value === preference || preferencePending) return;
    setPreferenceError(null);
    setPreferencePending(value);
    try {
      await saveThemePreference(value);
      void selectionHaptic();
    } catch {
      setPreferenceError("Could not save your appearance. Try again.");
      void errorHaptic();
    } finally {
      setPreferencePending(null);
    }
  }

  async function chooseTheme(choice: NativeThemeChoice) {
    if (!settings || settings.locked || !settings.canManageWorkspace || assignmentPending) return;
    if (choice.key === settings.selectedKey) return;
    setAssignmentError(null);
    setAssignmentPending(choice.key);
    try {
      await settings.assign(choice.reference);
      void selectionHaptic();
    } catch {
      setAssignmentError("Could not change this workspace theme. Try again.");
      void errorHaptic();
    } finally {
      setAssignmentPending(null);
    }
  }

  const currentThemeNote = useMemo(() => {
    if (theme.source.kind === "contract") {
      return theme.source.resolutionSource === "fallback"
        ? "Workshop replaced a workspace theme that could not be applied safely."
        : "Applied to this workspace";
    }
    if (theme.source.reason === "contract-unavailable") {
      return "Workshop is shown until this workspace theme is ready.";
    }
    if (theme.source.reason === "resources-unavailable") {
      return "Workshop is shown while this theme finishes loading.";
    }
    return "Workshop replaced a theme that could not be applied safely.";
  }, [theme.source]);

  if (!server || !token || !workspaceId) return <Redirect href="/" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          {
            gap: spacing.small,
            paddingBottom: spacing.medium,
            paddingHorizontal: spacing.large,
            paddingTop: spacing.medium,
          },
        ]}
      >
        <IconButton label="Back" role="back" onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <Text style={[typography.titleLarge, { color: colors.onSurface }]}>Appearance</Text>
          <BodyText>Choose how OpenPost looks on this device.</BodyText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          {
            gap: spacing.extraLarge,
            paddingBottom: Math.max(48, insets.bottom + spacing.large),
            paddingHorizontal: spacing.large,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        <ThemePreview />

        <View>
          <SectionHeader label="Color scheme" />
          <Card style={styles.optionList}>
            {APPEARANCE_OPTIONS.map((option, index) => {
              const selected = preference === option.value;
              const pending = preferencePending === option.value;
              return (
                <Pressable
                  accessibilityLabel={`${option.label}. ${option.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected,
                    busy: pending,
                    disabled: Boolean(preferencePending),
                  }}
                  disabled={Boolean(preferencePending)}
                  key={option.value}
                  onPress={() => void chooseAppearance(option.value)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    { minHeight: Math.max(52, spacing.doubleExtraLarge) },
                    index > 0 && {
                      borderTopColor: colors.outlineVariant,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                    pressed && { backgroundColor: colors.surfaceContainer },
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>
                      {option.label}
                    </Text>
                    <BodyText>{option.description}</BodyText>
                  </View>
                  {pending ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : selected ? (
                    <View
                      style={[
                        styles.check,
                        {
                          backgroundColor: colors.primary,
                          borderRadius: shape.full,
                        },
                      ]}
                    >
                      <ThemeIcon role="check" size={18} tintColor={colors.onPrimary} />
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: colors.outline,
                          borderRadius: shape.full,
                        },
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </Card>
          {preferenceError ? (
            <BodyText
              accessibilityRole="alert"
              style={{ color: colors.error, marginTop: spacing.small }}
            >
              {preferenceError}
            </BodyText>
          ) : null}
        </View>

        <View>
          <SectionHeader label="Workspace theme" />
          <Card
            style={{
              gap: spacing.medium,
              paddingVertical: spacing.large,
            }}
          >
            <View style={[styles.themeSummary, { gap: spacing.medium }]}>
              <ThemeSwatches colors={[colors.primary, colors.surfaceContainer, colors.onSurface]} />
              <View style={styles.optionCopy}>
                <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
                  {theme.displayName}
                </Text>
                <BodyText>{currentThemeNote}</BodyText>
              </View>
            </View>
            {settings?.locked ? (
              <View
                style={[
                  styles.notice,
                  {
                    backgroundColor: colors.surfaceContainer,
                    borderRadius: shape.small,
                  },
                ]}
              >
                <ThemeIcon role="workspace" size={20} tintColor={colors.onSurfaceVariant} />
                <BodyText style={styles.noticeCopy}>
                  Your organization uses one theme in every workspace.
                </BodyText>
              </View>
            ) : settings && !settings.canManageWorkspace ? (
              <BodyText>Ask a workspace admin to choose a different published theme.</BodyText>
            ) : null}
            <BodyText>Create and edit themes in OpenPost on the web.</BodyText>
          </Card>
        </View>

        {settings && settings.canManageWorkspace && !settings.locked && settings.choices.length ? (
          <View>
            <SectionHeader label="Choose a theme" />
            <Card style={styles.optionList}>
              {settings.choices.map((choice, index) => (
                <ThemeChoiceRow
                  choice={choice}
                  index={index}
                  key={choice.key}
                  loading={assignmentPending === choice.key}
                  pending={assignmentPending !== null}
                  onPress={() => void chooseTheme(choice)}
                  selected={settings.selectedKey === choice.key}
                />
              ))}
            </Card>
            {settings.inherited ? (
              <BodyText
                style={{
                  marginHorizontal: spacing.extraSmall,
                  marginTop: spacing.small,
                }}
              >
                This workspace follows the organization default.
              </BodyText>
            ) : null}
            {assignmentError ? (
              <BodyText
                accessibilityRole="alert"
                style={{ color: colors.error, marginTop: spacing.small }}
              >
                {assignmentError}
              </BodyText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ThemePreview() {
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
  return (
    <View
      accessible
      accessibilityLabel={`${theme.displayName} theme preview in ${theme.effectiveScheme} mode`}
      style={[
        styles.preview,
        {
          backgroundColor: colors.background,
          borderColor: colors.outlineVariant,
          borderRadius: shape.large,
          padding: spacing.large,
        },
      ]}
    >
      <View style={styles.previewChrome}>
        <View style={[styles.previewMark, { backgroundColor: colors.primary }]} />
        <View style={[styles.previewLine, { backgroundColor: colors.onSurface }]} />
        <View style={styles.previewDots}>
          <View style={[styles.previewDot, { backgroundColor: colors.outlineVariant }]} />
          <View style={[styles.previewDot, { backgroundColor: colors.outlineVariant }]} />
        </View>
      </View>
      <View style={[styles.previewBody, { gap: spacing.small }]}>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
          A clear place to work
        </Text>
        <View style={[styles.previewText, { backgroundColor: colors.onSurfaceVariant }]} />
        <View style={[styles.previewTextShort, { backgroundColor: colors.outline }]} />
        <View
          style={[
            styles.previewAction,
            { backgroundColor: colors.primary, borderRadius: shape.medium },
          ]}
        />
      </View>
    </View>
  );
}

function ThemeChoiceRow({
  choice,
  index,
  loading,
  onPress,
  pending,
  selected,
}: {
  choice: NativeThemeChoice;
  index: number;
  loading: boolean;
  onPress: () => void;
  pending: boolean;
  selected: boolean;
}) {
  const theme = useNativeTheme();
  const { colors, shape, typography } = theme.manifest;
  const supportsCurrentScheme = choice.supportedSchemes.includes(theme.effectiveScheme);
  const swatches = choice.swatches ?? [colors.primary, colors.surfaceContainer, colors.onSurface];
  return (
    <Pressable
      accessibilityLabel={`${choice.name}. ${choice.description ?? "Published workspace theme"}`}
      accessibilityRole="radio"
      accessibilityState={{
        checked: selected,
        busy: loading,
        disabled: !supportsCurrentScheme || pending,
      }}
      disabled={!supportsCurrentScheme || pending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        index > 0 && {
          borderTopColor: colors.outlineVariant,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.surfaceContainer },
        !supportsCurrentScheme && { opacity: 0.5 },
      ]}
    >
      <ThemeSwatches colors={swatches} />
      <View style={styles.optionCopy}>
        <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>{choice.name}</Text>
        <BodyText>
          {supportsCurrentScheme
            ? (choice.description ?? "Ready for this workspace")
            : `Does not include ${theme.effectiveScheme} mode`}
        </BodyText>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : selected ? (
        <View style={[styles.check, { backgroundColor: colors.primary, borderRadius: shape.full }]}>
          <ThemeIcon role="check" size={18} tintColor={colors.onPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ThemeSwatches({ colors }: { colors: readonly [string, string, string] }) {
  const theme = useNativeTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.swatches,
        {
          borderColor: theme.manifest.colors.outlineVariant,
          borderRadius: theme.manifest.shape.small,
        },
      ]}
    >
      {colors.map((color, index) => (
        <View key={`${color}-${index}`} style={[styles.swatch, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  check: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
  },
  headerCopy: {
    flex: 1,
  },
  notice: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeCopy: {
    flex: 1,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
  optionList: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 18,
    minHeight: 188,
    overflow: "hidden",
  },
  previewAction: {
    alignSelf: "flex-start",
    height: 36,
    marginTop: 8,
    width: 104,
  },
  previewBody: {
    flex: 1,
    justifyContent: "center",
  },
  previewChrome: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  previewDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  previewDots: {
    flexDirection: "row",
    gap: 5,
  },
  previewLine: {
    borderRadius: 3,
    height: 6,
    opacity: 0.75,
    width: 54,
  },
  previewMark: {
    borderRadius: 4,
    height: 14,
    width: 14,
  },
  previewText: {
    borderRadius: 3,
    height: 7,
    opacity: 0.5,
    width: "82%",
  },
  previewTextShort: {
    borderRadius: 3,
    height: 7,
    opacity: 0.55,
    width: "58%",
  },
  radio: {
    borderWidth: 2,
    height: 26,
    width: 26,
  },
  swatch: {
    flex: 1,
  },
  swatches: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 42,
    overflow: "hidden",
    width: 54,
  },
  themeSummary: {
    alignItems: "center",
    flexDirection: "row",
  },
});
