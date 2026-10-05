import { gradientSvg } from "@openpost/dither/paint";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { useNativeTheme } from "@/theme";

/** Static material uses the same two-pixel Bayer cells as web and native actions. */
function DitherTexture({ color, radius = 0 }: { color: string; radius?: number }) {
  const [height, setHeight] = useState(0);
  const xml = useMemo(() => {
    if (!height) return "";
    const strip = gradientSvg({
      length: height,
      ink: color,
      kind: "button",
      direction: "up",
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}"><defs><pattern id="material" width="8" height="${height}" patternUnits="userSpaceOnUse">${strip}</pattern></defs><rect width="100%" height="${height}" fill="url(#material)"/></svg>`;
  }, [color, height]);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      onLayout={(event) => setHeight(Math.ceil(event.nativeEvent.layout.height))}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden", opacity: 0.08 }]}
    >
      {xml ? <SvgXml xml={xml} width="100%" height={height} /> : null}
    </View>
  );
}

/** Reserve this material for capture, writing, or a single chart, not every content row. */
export function DitherPanel({ style, children, ...props }: React.ComponentProps<typeof View>) {
  const { colors, shape, spacing } = useNativeTheme().manifest;
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.outlineVariant,
          borderRadius: shape.large,
          borderWidth: StyleSheet.hairlineWidth,
          padding: spacing.medium,
          gap: spacing.medium,
        },
        style,
      ]}
    >
      <DitherTexture color={colors.primary} radius={shape.large} />
      {children}
    </View>
  );
}
