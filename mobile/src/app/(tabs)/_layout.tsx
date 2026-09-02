import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
import { useNativeTheme } from "@/theme";
import { resolveNativeThemeNavigationIcon } from "@/theme/native-tab-icons";

export default function TabLayout() {
  const colors = useColors();
  const theme = useNativeTheme();
  const drafts = resolveNativeThemeNavigationIcon(theme.manifest, "drafts");
  const calendar = resolveNativeThemeNavigationIcon(theme.manifest, "calendar");
  const queue = resolveNativeThemeNavigationIcon(theme.manifest, "queue");
  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
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
    </NativeTabs>
  );
}
