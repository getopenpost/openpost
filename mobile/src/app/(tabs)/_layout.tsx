import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";

export default function TabLayout() {
  const colors = useColors();
  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="drafts">
        <NativeTabs.Trigger.Label>Drafts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.badge.checkmark" md="upcoming" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
