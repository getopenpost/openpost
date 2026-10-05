import { Platform, Text, useWindowDimensions } from "react-native";

export function NativeText({ style, ...props }: React.ComponentProps<typeof Text>) {
  const { fontScale } = useWindowDimensions();
  // Let iOS choose the line box for Dynamic Type instead of clipping scaled glyphs.
  return (
    <Text
      {...props}
      style={[style, Platform.OS === "ios" && fontScale > 1 && { lineHeight: undefined }]}
    />
  );
}
