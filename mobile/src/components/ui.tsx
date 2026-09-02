import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { STATUS_LABEL } from "@/lib/format";
import { pressHaptic } from "@/lib/haptics";
import { ThemeIcon } from "@/components/theme-icon";
import {
  actionPresentation,
  NATIVE_CONTROL_METRICS,
  type NativeActionIntent,
  type NativeColorRoles,
  type NativeIconRole,
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
  const colors = useColors();
  const edges: Edge[] = safeTop ? ["top", "left", "right"] : ["left", "right"];
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.background }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style, ...props }: React.ComponentProps<typeof View>) {
  const theme = useNativeTheme();
  const { colors, shape, spacing } = theme.manifest;
  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.outlineVariant,
          borderRadius: shape.medium,
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
          borderRadius: theme.manifest.shape.medium,
          borderWidth: presentation.borderWidth,
          opacity: inactive ? presentation.disabledOpacity : 1,
          paddingHorizontal: theme.manifest.spacing.large,
          transform: pressed && hasDepth ? [{ translateY: presentation.depth }] : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={presentation.content} />
      ) : (
        <Text
          style={[
            theme.manifest.typography.labelLarge,
            {
              color: presentation.content,
              textDecorationLine: presentation.underline ? "underline" : "none",
            },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  const theme = useNativeTheme();
  const { colors, shape, typography } = theme.manifest;
  return (
    <TextInput
      placeholderTextColor={colors.onSurfaceVariant}
      {...props}
      style={[
        styles.textField,
        typography.bodyLarge,
        {
          backgroundColor: colors.surfaceContainerHigh,
          borderColor: colors.outline,
          borderRadius: shape.small,
          color: colors.onSurface,
          paddingHorizontal: theme.manifest.spacing.medium,
        },
        style,
      ]}
    />
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
    borderWidth: StyleSheet.hairlineWidth,
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
});
