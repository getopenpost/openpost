import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
import { resolveNativeThemeSymbol, useNativeTheme } from "@/theme";

export default function TabLayout() {
  const colors = useColors();
  const theme = useNativeTheme();
  const drafts = resolveNativeThemeSymbol(theme.manifest, "drafts");
  const calendar = resolveNativeThemeSymbol(theme.manifest, "calendar");
  const queue = resolveNativeThemeSymbol(theme.manifest, "queue");
  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="drafts">
        <NativeTabs.Trigger.Label>Drafts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={drafts.name.ios!} md={drafts.name.android!} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={calendar.name.ios!} md={calendar.name.android!} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={queue.name.ios!} md={queue.name.android!} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
