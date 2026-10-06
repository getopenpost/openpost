import { SvgXml } from "react-native-svg";
import platformMarks from "@/lib/platform-marks.json";
import { ThemeIcon } from "@/components/theme-icon";
import { useNativeTheme } from "@/theme";

const marks: Readonly<Record<string, string>> = platformMarks;

export function PlatformIcon({ platform, size = 22 }: { platform: string; size?: number }) {
  const { colors } = useNativeTheme().manifest;
  const key = platform
    .split(":")[0]
    .toLowerCase()
    .replace(/^twitter$/, "x");
  const xml = marks[key];
  if (!xml) return <ThemeIcon role="account" size={size} />;
  return (
    <SvgXml
      xml={xml}
      width={size}
      height={size}
      color={colors.onSurface}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
