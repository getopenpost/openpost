import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image, type ImageContentFit } from "expo-image";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { STATUS_LABEL } from "@/lib/format";
import { pressHaptic } from "@/lib/haptics";
import { ThemeIcon } from "@/components/theme-icon";
import {
  actionPresentation,
  buttonRadius,
  cardPresentation,
  emptyStatePresentation,
  inputPresentation,
  loadingStatePresentation,
  NATIVE_CONTROL_METRICS,
  sidebarDecorationWidth,
  themeAssetFor,
  type NativeActionIntent,
  type NativeColorRoles,
  type NativeIconRole,
  type NativeThemeAssetSlot,
  useNativeTheme,
  withAlpha,
} from "@/theme";

export type AppColors = NativeColorRoles;

export function useColors(): AppColors {
  return useNativeTheme().manifest.colors;
}

export function Screen({
  children,
  style,
  safeTop = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  safeTop?: boolean;
}) {
  const theme = useNativeTheme();
  const colors = theme.manifest.colors;
  const { width: viewportWidth } = useWindowDimensions();
  const edges: Edge[] = safeTop ? ["top", "left", "right"] : ["left", "right"];
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeAsset slot="background-texture" contentFit="cover" style={StyleSheet.absoluteFill} />
      <ThemeAsset
        slot="sidebar-decoration"
        style={[
          styles.sidebarDecoration,
          { width: sidebarDecorationWidth(theme.manifest, viewportWidth) },
        ]}
      />
      <ThemeAsset
        slot="header-decoration"
        style={[styles.headerDecoration, { height: theme.manifest.shell.headerHeight }]}
      />
      <View
        style={[styles.screenContent, { maxWidth: theme.manifest.shell.contentMaxWidth }, style]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

export function Card({ children, style, ...props }: React.ComponentProps<typeof View>) {
  const theme = useNativeTheme();
  const { spacing } = theme.manifest;
  const presentation = cardPresentation(theme.manifest);
  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          ...presentation,
          paddingHorizontal: spacing.large,
          paddingVertical: spacing.medium,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ label }: { label: string }) {
  const theme = useNativeTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        theme.manifest.typography.labelLarge,
        {
          color: theme.manifest.colors.onSurfaceVariant,
          marginBottom: theme.manifest.spacing.small,
          marginHorizontal: theme.manifest.spacing.extraSmall,
        },
      ]}
    >
      {label}
    </Text>
  );
}

export function PageTitle({
  accessibilityRole = "header",
  style,
  ...props
}: React.ComponentProps<typeof Text>) {
  const theme = useNativeTheme();
  return (
    <Text
      {...props}
      accessibilityRole={accessibilityRole}
      style={[
        theme.manifest.typography.headlineLarge,
        { color: theme.manifest.colors.onSurface },
        style,
      ]}
    />
  );
}

export function ContentTitle({
  accessibilityRole = "header",
  style,
  ...props
}: React.ComponentProps<typeof Text>) {
  const theme = useNativeTheme();
  return (
    <Text
      {...props}
      accessibilityRole={accessibilityRole}
      style={[
        theme.manifest.typography.titleMedium,
        { color: theme.manifest.colors.onSurface },
        style,
      ]}
    />
  );
}

export function Button({
  title,
  onPress,
  intent = "primary",
  disabled,
  loading = false,
  accessibilityRole = "button",
  accessibilityHint,
  accessibilityState,
  style,
}: {
  title: string;
  onPress: () => void;
  intent?: NativeActionIntent;
  disabled?: boolean;
  loading?: boolean;
  accessibilityRole?: React.ComponentProps<typeof Pressable>["accessibilityRole"];
  accessibilityHint?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>["accessibilityState"];
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useNativeTheme();
  const presentation = actionPresentation(theme.manifest, intent);
  const inactive = disabled || loading;
  const hasDepth = presentation.depth > 0;
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...accessibilityState,
        disabled: inactive,
        busy: loading,
      }}
      disabled={inactive}
      onPressIn={() => void pressHaptic()}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? presentation.pressedContainer : presentation.container,
          borderColor: presentation.border,
          borderBottomColor: hasDepth ? presentation.depthColor : presentation.border,
          borderBottomWidth: hasDepth
            ? Math.max(presentation.borderWidth, pressed ? 0 : presentation.depth)
            : presentation.borderWidth,
          borderRadius: buttonRadius(theme.manifest),
          borderWidth: presentation.borderWidth,
          opacity: inactive ? presentation.disabledOpacity : 1,
          paddingHorizontal: theme.manifest.spacing.large,
          transform: pressed && hasDepth ? [{ translateY: presentation.depth }] : undefined,
        },
        style,
      ]}
    >
      {({ pressed }) => {
        const contentColor = pressed ? presentation.pressedContent : presentation.content;
        return loading ? (
          <ActivityIndicator color={contentColor} />
        ) : (
          <Text
            style={[
              theme.manifest.typography.labelLarge,
              {
                color: contentColor,
                textDecorationLine: presentation.underline ? "underline" : "none",
              },
            ]}
          >
            {title}
          </Text>
        );
      }}
    </Pressable>
  );
}

export function TextField({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  const theme = useNativeTheme();
  const { colors, typography } = theme.manifest;
  const presentation = inputPresentation(theme.manifest);
  return (
    <TextInput
      placeholderTextColor={colors.onSurfaceVariant}
      {...props}
      style={[
        styles.textField,
        typography.bodyLarge,
        {
          ...presentation,
          color: colors.onSurface,
          paddingHorizontal: theme.manifest.spacing.medium,
        },
        style,
      ]}
    />
  );
}

export function ThemeAsset({
  contentFit = "contain",
  slot,
  style,
}: {
  contentFit?: ImageContentFit;
  slot: NativeThemeAssetSlot;
  style?: StyleProp<ImageStyle>;
}) {
  const asset = themeAssetFor(useNativeTheme(), slot);
  if (!asset) return null;
  const isIllustration = slot === "empty-state-illustration" || slot === "loading-illustration";
  return (
    <Image
      accessibilityLabel={isIllustration ? asset.alt : undefined}
      accessibilityRole={isIllustration && asset.alt ? "image" : undefined}
      accessible={isIllustration && Boolean(asset.alt)}
      contentFit={contentFit}
      pointerEvents="none"
      source={{ uri: asset.uri }}
      style={style}
    />
  );
}

export function LoadingState({ label }: { label?: string }) {
  const theme = useNativeTheme();
  const illustration = themeAssetFor(theme, "loading-illustration");
  const presentation = loadingStatePresentation(theme.manifest);
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    opacity.stopAnimation();
    opacity.setValue(1);
    if (presentation.kind === "spinner" || reduceMotion || presentation.animationDuration === 0) {
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: presentation.animationDuration,
          toValue: 0.42,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: presentation.animationDuration,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, presentation.animationDuration, presentation.kind, reduceMotion]);

  return (
    <View
      accessible
      accessibilityLabel={label ?? "Loading"}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[
        styles.state,
        {
          gap: theme.manifest.spacing.medium,
          padding: theme.manifest.spacing.large,
        },
      ]}
    >
      {illustration ? (
        <ThemeAsset slot="loading-illustration" style={styles.stateIllustration} />
      ) : null}
      {presentation.kind === "spinner" ? (
        <ActivityIndicator color={theme.manifest.colors.primary} />
      ) : presentation.kind === "pulse" ? (
        <Animated.View
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.loadingPulse,
            {
              backgroundColor: theme.manifest.colors.primaryContainer,
              borderRadius: theme.manifest.shape.full,
              opacity,
            },
          ]}
        />
      ) : (
        <Animated.View
          importantForAccessibility="no-hide-descendants"
          style={[styles.loadingSkeleton, { gap: theme.manifest.spacing.small, opacity }]}
        >
          <View
            style={[
              styles.skeletonLine,
              {
                backgroundColor: theme.manifest.colors.surfaceContainerHigh,
                borderRadius: theme.manifest.shape.small,
              },
            ]}
          />
          <View
            style={[
              styles.skeletonBlock,
              {
                backgroundColor: theme.manifest.colors.surfaceContainerHigh,
                borderRadius: theme.manifest.shape.medium,
              },
            ]}
          />
        </Animated.View>
      )}
      {label ? <BodyText>{label}</BodyText> : null}
    </View>
  );
}

export function EmptyState({ body, title }: { body?: string; title: string }) {
  const theme = useNativeTheme();
  const presentation = emptyStatePresentation(theme.manifest);
  const illustration = themeAssetFor(theme, "empty-state-illustration");
  return (
    <View
      style={[
        styles.state,
        {
          backgroundColor: presentation.framed ? theme.manifest.colors.surface : "transparent",
          borderColor: theme.manifest.colors.outlineVariant,
          borderRadius: theme.manifest.shape.medium,
          borderWidth: presentation.framed ? 1 : 0,
          gap: theme.manifest.spacing.small,
          padding: theme.manifest.spacing.large,
        },
      ]}
    >
      {presentation.illustrated && illustration ? (
        <ThemeAsset slot="empty-state-illustration" style={styles.stateIllustration} />
      ) : presentation.illustrated ? (
        <View
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.emptyStateFallback,
            {
              backgroundColor: theme.manifest.colors.primaryContainer,
              borderRadius: theme.manifest.shape.large,
            },
          ]}
        >
          <ThemeIcon role="drafts" size={36} tintColor={theme.manifest.colors.onPrimaryContainer} />
        </View>
      ) : null}
      <ContentTitle style={styles.stateText}>{title}</ContentTitle>
      {body ? <BodyText style={styles.stateText}>{body}</BodyText> : null}
    </View>
  );
}

export function IconButton({
  label,
  role,
  onPress,
  color,
}: {
  label: string;
  role: NativeIconRole;
  onPress: () => void;
  color?: string;
}) {
  const theme = useNativeTheme();
  const colors = theme.manifest.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPressIn={() => void pressHaptic()}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { borderRadius: theme.manifest.shape.full },
        pressed && { backgroundColor: colors.primaryContainer },
      ]}
    >
      <ThemeIcon role={role} size={24} tintColor={color ?? colors.onSurface} />
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const theme = useNativeTheme();
  const colors = theme.manifest.colors;
  const color = colors.status[status as keyof typeof colors.status] ?? colors.onSurfaceVariant;
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: withAlpha(color, 0.15),
          borderRadius: theme.manifest.shape.full,
        },
      ]}
    >
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[theme.manifest.typography.labelMedium, { color }]}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

export function BodyText({ children, style, ...props }: React.ComponentProps<typeof Text>) {
  const theme = useNativeTheme();
  return (
    <Text
      style={[
        theme.manifest.typography.bodyMedium,
        { color: theme.manifest.colors.onSurfaceVariant },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    shadowOffset: { height: 4, width: 0 },
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: NATIVE_CONTROL_METRICS.buttonMinHeight,
  },
  textField: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: NATIVE_CONTROL_METRICS.textFieldMinHeight,
  },
  iconButton: {
    alignItems: "center",
    height: NATIVE_CONTROL_METRICS.iconButtonSize,
    justifyContent: "center",
    width: NATIVE_CONTROL_METRICS.iconButtonSize,
  },
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  screenContent: {
    alignSelf: "center",
    flex: 1,
    width: "100%",
  },
  sidebarDecoration: {
    bottom: 0,
    left: 0,
    opacity: 0.96,
    position: "absolute",
    top: 0,
    width: "28%",
  },
  headerDecoration: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  state: {
    alignItems: "center",
    justifyContent: "center",
  },
  stateIllustration: {
    aspectRatio: 1.6,
    maxHeight: 180,
    width: "100%",
  },
  stateText: {
    textAlign: "center",
  },
  loadingPulse: {
    height: 48,
    width: 48,
  },
  loadingSkeleton: {
    maxWidth: 360,
    width: "100%",
  },
  skeletonLine: {
    height: 18,
    width: "62%",
  },
  skeletonBlock: {
    height: 72,
    width: "100%",
  },
  emptyStateFallback: {
    alignItems: "center",
    height: 72,
    justifyContent: "center",
    width: 72,
  },
});

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (current) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
