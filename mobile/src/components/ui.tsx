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
import { useColorScheme } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { STATUS_LABEL, statusColor } from "@/lib/format";
import { pressHaptic } from "@/lib/haptics";

export const LIGHT_COLORS = {
  dark: false,
  bg: "#faf8f5",
  card: "#ffffff",
  text: "#302b28",
  textSecondary: "#716862",
  separator: "#e4ded8",
  tint: "#b74c05",
  onTint: "#ffffff",
  tintSoft: "#f7e9de",
  buttonDepth: "#7e3300",
  danger: "#b3261e",
  inputBg: "#f3efeb",
  success: "#376b51",
} as const;

export const DARK_COLORS = {
  dark: true,
  bg: "#171412",
  card: "#211d1a",
  text: "#f3efeb",
  textSecondary: "#aea39c",
  separator: "#3a332f",
  tint: "#e9823a",
  onTint: "#21140c",
  tintSoft: "#3b281d",
  buttonDepth: "#8f3a00",
  danger: "#ffb4ab",
  inputBg: "#2a2521",
  success: "#8fcfac",
} as const;

export type AppColors = typeof LIGHT_COLORS | typeof DARK_COLORS;

export function useColors(): AppColors {
  const scheme = useColorScheme();
  return scheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
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
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style, ...props }: React.ComponentProps<typeof View>) {
  const colors = useColors();
  return (
    <View
      {...props}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.separator }, style]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ label }: { label: string }) {
  const colors = useColors();
  return (
    <Text
      style={[
        styles.sectionHeader,
        {
          color: colors.textSecondary,
        },
      ]}
    >
      {label}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = "filled",
  disabled,
  loading = false,
  accessibilityRole = "button",
  accessibilityHint,
  accessibilityState,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "filled" | "focal" | "tinted" | "plain" | "destructive";
  disabled?: boolean;
  loading?: boolean;
  accessibilityRole?: React.ComponentProps<typeof Pressable>["accessibilityRole"];
  accessibilityHint?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>["accessibilityState"];
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const isPrimary = variant === "filled" || variant === "focal";
  const background = isPrimary
    ? colors.tint
    : variant === "destructive"
      ? "transparent"
      : variant === "tinted"
        ? colors.tintSoft
        : "transparent";
  const color = isPrimary ? colors.onTint : variant === "destructive" ? colors.danger : colors.tint;
  const inactive = disabled || loading;
  const hasDepth = variant === "focal";
  const hasBorder = hasDepth || variant === "tinted";
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: inactive, busy: loading }}
      disabled={inactive}
      onPressIn={() => void pressHaptic()}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: isPrimary
            ? colors.tint
            : variant === "tinted"
              ? `${colors.tint}66`
              : "transparent",
          borderBottomColor: hasDepth ? colors.buttonDepth : undefined,
          borderBottomWidth: hasDepth ? (pressed ? 1 : 2) : undefined,
          borderWidth: hasBorder ? (hasDepth ? 1 : StyleSheet.hairlineWidth) : 0,
          opacity: inactive ? 0.45 : pressed && !hasDepth ? 0.68 : 1,
          transform: pressed && hasDepth ? [{ translateY: 2 }] : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonText, { color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextField({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  const colors = useColors();
  return (
    <TextInput
      placeholderTextColor={colors.textSecondary}
      {...props}
      style={[
        styles.textField,
        {
          backgroundColor: colors.inputBg,
          borderColor: colors.separator,
          color: colors.text,
        },
        style,
      ]}
    />
  );
}

export function IconButton({
  label,
  name,
  onPress,
  color,
}: {
  label: string;
  name: SymbolViewProps["name"];
  onPress: () => void;
  color?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPressIn={() => void pressHaptic()}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && {
          backgroundColor: colors.tintSoft,
        },
      ]}
    >
      <SymbolView name={name} size={24} tintColor={color ?? colors.text} />
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const color = statusColor(status, colors.dark);
  return (
    <View style={[styles.badge, { backgroundColor: `${color}26` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

export function BodyText({ children, style, ...props }: React.ComponentProps<typeof Text>) {
  const colors = useColors();
  return (
    <Text style={[{ color: colors.textSecondary, fontSize: 14 }, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    marginHorizontal: 4,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  textField: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
