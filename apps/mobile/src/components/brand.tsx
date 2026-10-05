import { NativeText as Text } from "@/components/native-text";
import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useColors } from "@/components/ui";

export function Brand({
  compact = false,
  style,
}: {
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const size = compact ? 28 : 48;

  return (
    <View accessible accessibilityLabel="OpenPost" style={[styles.brand, style]}>
      <Image
        source={require("../../assets/images/icon.png")}
        style={{ width: size, height: size, borderRadius: compact ? 10 : 14 }}
        contentFit="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text
        maxFontSizeMultiplier={compact ? 1.5 : undefined}
        style={[styles.wordmark, compact && styles.wordmarkCompact, { color: colors.onSurface }]}
      >
        OpenPost
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  wordmarkCompact: { fontSize: 18, lineHeight: 24 },
  wordmark: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
});
