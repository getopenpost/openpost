import { Pressable, View } from "react-native";
import { NativeText as Text } from "@/components/native-text";
import { useNativeTheme } from "@/theme";

/** Secondary filters stay quiet so filled actions keep the visual weight. */
export function Segments<T extends string>({
  values,
  selected,
  onSelect,
}: {
  values: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { colors, shape, spacing, typography } = useNativeTheme().manifest;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: spacing.small }}>
      {values.map(({ value, label }) => {
        const active = selected === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: active ? colors.primaryContainer : "transparent",
              borderColor: active ? "transparent" : colors.outlineVariant,
              borderRadius: shape.medium,
              borderWidth: 1,
              flex: 1,
              justifyContent: "center",
              minHeight: 48,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={[
                typography.labelLarge,
                { color: active ? colors.onPrimaryContainer : colors.onSurfaceVariant },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
