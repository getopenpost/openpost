import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
import { navigationPresentation, useNativeTheme } from "@/theme";
import { resolveNativeThemeNavigationIcon } from "@/theme/native-tab-icons";

export default function TabLayout() {
  const colors = useColors();
  const theme = useNativeTheme();
  const drafts = resolveNativeThemeNavigationIcon(theme.manifest, "drafts");
  const calendar = resolveNativeThemeNavigationIcon(theme.manifest, "calendar");
  const queue = resolveNativeThemeNavigationIcon(theme.manifest, "queue");
  const projects = resolveNativeThemeNavigationIcon(theme.manifest, "drafts");
  const navigation = navigationPresentation(theme.manifest);
  const label = theme.manifest.typography.labelMedium;

  // Expo's native UIKit and Material tab hosts own their physical height and safe-area inset.
  // NativeTabs exposes no height prop, so the validated requestedHeight remains available to
  // custom navigation renderers instead of being faked with content padding here.
  return (
    <NativeTabs
      backgroundColor={navigation.backgroundColor}
      blurEffect="none"
      disableIndicator={navigation.disableIndicator}
      disableTransparentOnScrollEdge
      iconColor={{ default: navigation.defaultColor, selected: navigation.selectedColor }}
      indicatorColor={navigation.indicatorColor}
      labelStyle={{
        default: {
          color: navigation.defaultColor,
          fontFamily: label.fontFamily,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
        },
        selected: {
          color: navigation.selectedColor,
          fontFamily: label.fontFamily,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
        },
      }}
      labelVisibilityMode="labeled"
      minimizeBehavior="onScrollDown"
      rippleColor={colors.primaryContainer}
      shadowColor={navigation.shadowColor}
      tintColor={navigation.selectedColor}
    >
      <NativeTabs.Trigger name="drafts">
        <NativeTabs.Trigger.Label>Drafts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={drafts} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={calendar} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={queue} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Label>Video</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={projects} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
